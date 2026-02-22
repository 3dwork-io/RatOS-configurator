# Diseño del Sistema de Importación y Procesamiento Automatizado de Configuraciones Klipper

**Fecha:** 22 de Febrero de 2026
**Proyecto:** RatOS Configurator - Módulo de Importación Inteligente
**Autor:** Asistente Técnico Senior (Trae IDE)

---

## 1. Introducción y Objetivos

El objetivo de este documento es definir la arquitectura técnica para un nuevo subsistema de importación inteligente y mejorar la experiencia de usuario mediante asistentes (wizards) interactivos en `RatOS-configurator`.

El sistema debe ser capaz de:
1.  **Importación**: Leer archivos `.cfg` arbitrarios, resolviendo directivas `[include]`.
2.  **Identificación**: Identificar componentes de hardware (placas, motores, hotends) basándose en parámetros de configuración.
3.  **Generación**: Generar la estructura de archivos modular requerida por RatOS (`printer-definition.json`, `toolhead`, etc.).
4.  **Experiencia de Usuario**: Proporcionar wizards interactivos para diagnósticos complejos (USB) y tareas de calibración críticas.

## 2. Análisis del Estado Actual

### 2.1 Limitaciones del Parser Actual (`initojson.py`)
El script actual `src/scripts/initojson.py` es un parser de configuración básico basado en `ConfigParser` de Python. Tiene limitaciones críticas para la importación general:
-   **Ignora Includes**: La línea 31 (`if line.find('[include') == 0: continue`) descarta explícitamente los archivos incluidos. Esto es fatal para configuraciones modulares donde la definición de pines o macros reside en otros archivos.
-   **Dependencia de Metadatos**: El sistema actual depende de bloques de comentarios JSON específicos (`# { "id": ... }`) que no existen en configuraciones estándar de Klipper.
-   **Estructura Plana**: No construye un árbol de dependencias, lo que dificulta entender la jerarquía de configuración.

### 2.2 Estructura de Datos RatOS
RatOS utiliza una estructura altamente opinionada:
-   `printer-definition.json`: Define la impresora y sus capacidades.
-   `board-definition.json`: Abstrae los pines de la placa.
-   Archivos `.cfg` modulares: Separados por componente (`steppers`, `hotends`, etc.).

Una importación exitosa debe "descomponer" un `printer.cfg` monolítico en estos componentes discretos.

## 3. Arquitectura Propuesta

El sistema se compondrá de cuatro módulos principales:

### 3.1 Módulo de Parsing Recursivo (Advanced Config Parser)
Este módulo reemplazará o extenderá la funcionalidad de `initojson.py`. Se recomienda implementar este parser en TypeScript para integrarse nativamente con el backend de Next.js.

-   **Entrada**: Ruta al archivo raíz (`printer.cfg`).
-   **Proceso**:
    1.  Leer el archivo línea por línea.
    2.  Al encontrar `[include filename.cfg]`, pausar, resolver la ruta (relativa o absoluta), y procesar el archivo hijo recursivamente.
    3.  Almacenar el origen de cada sección (en qué archivo se definió) para permitir la trazabilidad.
    4.  Resolver variables y alias de pines (`[board_pins]`).
-   **Salida**: Un Objeto de Configuración Unificado (UCO) que contiene todas las secciones y claves, con metadatos sobre su archivo de origen.

**Implementación Referencial (TypeScript):**
```typescript
interface ConfigNode {
  sections: Map<string, ConfigSection>;
  includes: ConfigNode[];
  filePath: string;
}

async function parseKlipperConfig(path: string): Promise<ConfigNode> {
  const content = await readFile(path);
  const node: ConfigNode = { sections: new Map(), includes: [], filePath: path };
  
  for (const line of content.split('\n')) {
    if (line.startsWith('[include')) {
      const includePath = resolvePath(path, extractIncludePath(line));
      node.includes.push(await parseKlipperConfig(includePath));
    } else if (isSectionHeader(line)) {
      // Parse section...
    }
  }
  return node;
}
```

### 3.2 Motor de Inferencia de Hardware (Hardware Fingerprinting Engine)
Este motor analizará el UCO para identificar componentes conocidos. Utilizará una base de datos de "firmas".

**Algoritmo de Detección Difusa (Scoring System):**
Se utilizará un sistema de puntuación para la detección:
-   **Coincidencia Exacta (100 pts)**: Ej. `sensor_type` coincide exactamente con la base de datos.
-   **Coincidencia Aproximada (80 pts)**: Ej. `rotation_distance` dentro del 1% de tolerancia.
-   **Coincidencia Estructural (50 pts)**: Ej. tiene sección `[bltouch]`, clasificándolo como sonda mecánica.

**Ejemplo de Algoritmo de Identificación de Extrusor:**
```typescript
function identifyExtruder(section: KlipperSection): string {
  if (match(section.rotation_distance, 4.637) && match(section.gear_ratio, "7.5:1")) {
    return "Orbiter 2.0";
  }
  if (match(section.rotation_distance, 53.494)) {
    return "Bondtech LGX Lite";
  }
  return "Generic/Unknown";
}
```

### 3.3 Generador de Infraestructura (Configuration Synthesizer)
Este módulo tomará los componentes identificados y generará la estructura de carpetas RatOS.
1.  **Crear Perfil de Impresora**: Generar un nuevo directorio en `configuration/printers/imported-printer/`.
2.  **Mapear Pines**: Traducir los pines del `printer.cfg` original a los alias de la placa detectada. Si la placa no se detecta, generar una definición de placa "Custom".
3.  **Generar Archivos**: Crear `printer-definition.json`, `macros.cfg`, y `overrides.cfg`.

### 3.4 Gestión de Reglas UDEV (Device Rule Manager)
Este módulo abordará la necesidad crítica de garantizar rutas de dispositivos estables para Klipper en Linux, especialmente para configuraciones con múltiples placas MCU (USB/CAN).

**Problemática**: Klipper requiere rutas estables (`/dev/serial/by-id/...` o symlinks personalizados) para conectar con las MCUs. Sin reglas udev adecuadas, el orden de los dispositivos puede cambiar entre reinicios, rompiendo la configuración.

**Funcionalidades:**
1.  **Extracción de IDs de Hardware**: Analizar el UCO para extraer `serial` o `canbus_uuid` de las secciones `[mcu]`.
2.  **Generación de Archivos .rules**: Crear archivos `.rules` estandarizados siguiendo el patrón `98-<board-name>.rules`.
    *   **Plantilla Estándar**:
        ```udev
        SUBSYSTEMS=="usb", ATTRS{idProduct}=="<PID>", ATTRS{idVendor}=="<VID>", ATTRS{serial}=="<SERIAL>", ACTION=="add", SYMLINK+="<SYMLINK_NAME>", RUN+="/home/pi/printer_data/config/RatOS/scripts/klipper-mcu-added.sh"
        ```
3.  **Despliegue Automático**: Copiar los archivos generados a `/etc/udev/rules.d/` y recargar las reglas (`udevadm control --reload-rules && udevadm trigger`).
4.  **Mantenimiento**: Verificar periódicamente que las reglas coincidan con el hardware conectado.

### 3.5 Wizard Interactivo de Diagnóstico y Configuración USB
Este módulo proporcionará una interfaz avanzada (CLI/Web) para la gestión de dispositivos USB complejos.

#### 3.5.1 Flujo de Detección e Identificación
1. **Escaneo Automático**: Utilización de `lsusb`, `usb-devices` y exploración de `/sys/bus/usb/devices/` para listar dispositivos conectados con detalles (VID, PID, Fabricante, Serial).
2. **Manejo de Dispositivos No Detectados**:
   - Guía de conexión física.
   - Comandos de rescaneo (`echo 1 > /sys/bus/usb/devices/usbX/authorized`).
   - Entrada manual de IDs con validación de sintaxis.

#### 3.5.2 Análisis Profundo de Dispositivos
El sistema evaluará casuísticas complejas:
- **Dispositivos Compuestos**: Detección de múltiples interfaces (ej. teclado+ratón).
- **Cambio de Modo**: Identificación de dispositivos que cambian ID (bootloader vs application).
- **Seriales Dinámicos/Nulos**: Estrategias de fallback usando path físico USB (con advertencias).
- **USB 2.0 vs 3.0**: Diferenciación por bus y puerto.

#### 3.5.3 Generación Inteligente de Reglas
Generación de archivos `/etc/udev/rules.d/99-custom-device.rules` con:
- **Atributos Múltiples**: Combinación de `idVendor`, `idProduct`, `serial` para máxima especificidad.
- **Acciones Definidas**: `SYMLINK`, `MODE`, `GROUP`, `OWNER`.
- **Validación de Conflictos**: Chequeo contra reglas existentes en `/etc/udev/rules.d/`.
- **Backup y Rollback**: Copia de seguridad automática antes de cambios y opción de deshacer.

#### 3.5.4 Validación y Testing
- **Simulación**: Ejecución de `udevadm test` antes de aplicar.
- **Aplicación Segura**: `udevadm control --reload-rules && udevadm trigger`.
- **Verificación**: Comprobación de permisos y creación de enlaces simbólicos post-aplicación.
- **Logging**: Registro detallado para depuración.

#### 3.5.5 Interfaz de Usuario y Documentación
- **UX Profesional**: Menús interactivos, validación de entradas, resúmenes de confirmación.
- **Ayuda Integrada**: Explicaciones contextuales sobre conceptos de udev y solución de problemas.

## 4. Análisis de Wizards y Mejoras

Como parte de la evolución del configurador, se ha realizado un análisis exhaustivo de los asistentes (wizards) existentes en `src/app/wizard` y `src/components/setup-steps`.

### 4.1 Inventario de Wizards Existentes

| Nombre del Wizard | Ubicación Principal | Propósito | Estado | Dependencias Clave |
| :--- | :--- | :--- | :--- | :--- |
| **Setup Wizard** | `src/app/wizard/wizard.tsx` | Configuración inicial completa de la impresora. | Producción | `VerticalSteps`, `Recoil` |
| **WiFi Setup** | `src/components/setup-steps/wifi-setup.tsx` | Configuración de red inalámbrica. | Producción | `nmcli` (backend) |
| **Printer Selection** | `src/components/setup-steps/printer-selection.tsx` | Selección del modelo base de impresora. | Producción | `PrinterState` |
| **MCU Flashing** | `src/components/setup-steps/mcu/flash.tsx` | Flasheo de firmware para placas controladoras y toolboards. | Producción (Complejo) | `dfu-util`, `sd-card` |
| **Hardware Selection** | `src/components/setup-steps/hardware-selection.tsx` | Selección de componentes (hotend, extrusor, sensores). | Producción | `ToolheadConfiguration` |
| **Kinematics Check** | `src/components/setup-steps/corexy-kinematics.tsx` | Verificación de dirección de motores. | **Deshabilitado/Incompleto** | `Klipper` |

### 4.2 Evaluación de Calidad

**Puntos Fuertes:**
*   **Modularidad UI**: Uso de componentes reutilizables como `VerticalSteps` y `Card` que mantienen una consistencia visual profesional.
*   **Gestión de Estado**: Uso efectivo de `Recoil` para manejar el estado global de la configuración de la impresora y `trpc` para la comunicación con el backend.
*   **Feedback Visual**: Buena implementación de estados de carga (`Spinner`), éxito/error (`Badge`, `InfoMessage`) y validaciones.

**Áreas de Mejora (Debilidades):**
*   **Flujo Rígido (`makeSteps`)**: La secuencia de pasos está "hardcoded" en `src/components/setup-steps/index.tsx`. Añadir pasos condicionales o plugins externos requiere modificar el código fuente principal.
*   **Acoplamiento en MCU Flashing**: El componente `MCUFlashing` gestiona demasiadas responsabilidades (detección, verificación de versión, selección de estrategia de flasheo), lo que lo hace difícil de mantener y testear.
*   **Lógica de Negocio en Componentes**: Parte de la lógica de decisión (ej. qué herramienta flashear) reside dentro de los componentes de UI en lugar de en hooks o servicios dedicados.

### 4.3 Gaps y Oportunidades Identificadas

Basado en el análisis del código y las necesidades típicas de usuarios de Klipper/RatOS:

1.  **Wizard de Calibración Post-Instalación (Faltante)**:
    *   Actualmente no existe un flujo guiado para: Calibración de Z-Offset, PID Tuning de calentadores, y Malla de Nivelación. Estos son pasos críticos que los usuarios deben realizar manualmente o buscando en la documentación.
2.  **Input Shaper / Resonance Testing**:
    *   Existe funcionalidad en la página de análisis (`src/app/analysis`), pero no como un wizard paso a paso que guíe al usuario desde la instalación del acelerómetro hasta la generación de gráficos.
3.  **Diagnóstico USB Avanzado**:
    *   Confirmando la necesidad planteada en la sección 3.5, no existen herramientas en la UI actual para depurar problemas de conexión USB/CAN a bajo nivel.
4.  **Verificación de Motores (Kinematics)**:
    *   El archivo `corexy-kinematics.tsx` existe pero está comentado en el flujo principal. Es vital reactivar y finalizar este wizard para evitar accidentes en el primer movimiento.

### 4.4 Recomendaciones de Mejora

1.  **Refactorización del Orquestador de Pasos**:
    *   Transformar `makeSteps` en un sistema de registro dinámico donde los módulos puedan inyectar pasos.
    *   Implementar una interfaz `WizardStepDefinition` que incluya condiciones de `skip` (saltar paso si ya está configurado).

2.  **Desacoplamiento de MCU Flashing**:
    *   Dividir `MCUFlashing` en sub-componentes especializados: `BoardDetector`, `VersionChecker`, `FlashStrategySelector`.
    *   Mover la lógica de flasheo a un custom hook `useFirmwareFlash`.

3.  **Implementación de "Smart Resume"**:
    *   Permitir que el usuario guarde el progreso del wizard y lo retome más tarde, persistiendo el estado en el backend (no solo en URL/memoria).

### 4.5 Propuesta de Nuevos Wizards (Roadmap)

| Prioridad | Nombre del Wizard | Descripción | Justificación (ROI) |
| :--- | :--- | :--- | :--- |
| **Alta** | **Calibration Suite** | Flujo unificado para Z-Offset, PID y Bed Mesh. | Reducción drástica de tickets de soporte por "primera capa fallida". |
| **Media** | **Input Shaper Assistant** | Guía paso a paso para conectar acelerómetro y ejecutar tests. | Facilita una de las características más complejas de Klipper. |
| **Media** | **Maintenance Mode** | Wizard periódico para tensado de correas y lubricación. | Mejora la longevidad del hardware y calidad de impresión a largo plazo. |

## 5. Procedimientos de Validación y Testing

### 5.1 Validación de Integridad
-   Verificar que no existan definiciones de pines duplicados.
-   Validar que todos los `mcu` definidos sean accesibles.
-   Comprobar que las temperaturas mínimas y máximas están dentro de rangos seguros.

### 5.2 Plan de Pruebas
1.  **Unit Testing**: Pruebas con archivos `.cfg` sintéticos que contienen casos borde (includes circulares, caracteres especiales).
2.  **Integration Testing**: Importación de configuraciones reales de repositorios populares (VoronUsers).
3.  **Hardware Verification**: Validar que la configuración generada arranca Klipper sin errores (`FIRMWARE_RESTART`).
4.  **UDEV Verification**: Conectar dispositivos físicos y verificar que se crean los enlaces simbólicos esperados en `/dev/`.

## 6. Plan de Implementación Escalable

### Fase 1: Cimientos (Semanas 1-2)
-   Implementar el parser recursivo en TypeScript (`src/server/helpers/config-parser.ts`).
-   Crear la interfaz de definición de firmas de hardware.

### Fase 2: Motor de Inferencia (Semanas 3-4)
-   Poblar la base de datos con las definiciones existentes en `configuration/`.
-   Implementar la lógica de identificación de placas y extrusores.

### Fase 3: Generación y UI (Semanas 5-6)
-   Crear el wizard de "Importar Configuración" en el frontend.
-   Implementar la generación de archivos y la persistencia en disco.
-   Implementar el **Device Rule Manager** para la gestión de reglas udev.

---
**Nota**: Para proceder con la implementación detallada, se requiere analizar ejemplos reales de los archivos `printer.cfg` que se desea importar, para calibrar las tolerancias del motor de inferencia.
