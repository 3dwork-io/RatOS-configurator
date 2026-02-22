# Diseño del Sistema de Importación y Procesamiento Automatizado de Configuraciones Klipper

**Fecha:** 22 de Febrero de 2026
**Proyecto:** RatOS Configurator - Módulo de Importación Inteligente
**Autor:** Asistente Técnico Senior (Trae IDE)
**Estado:** Propuesta Técnica Aprobada

---

## 1. Introducción y Objetivos

El objetivo de este documento es definir la arquitectura técnica para un nuevo subsistema de importación inteligente y mejorar la experiencia de usuario mediante asistentes (wizards) interactivos en `RatOS-configurator`.

El sistema debe ser capaz de:
1.  **Importación**: Leer archivos `.cfg` arbitrarios, resolviendo directivas `[include]`.
2.  **Identificación**: Identificar componentes de hardware (placas, motores, hotends) basándose en parámetros de configuración.
3.  **Generación**: Generar la estructura de archivos modular requerida por RatOS (`printer-definition.json`, `toolhead`, etc.).
4.  **Experiencia de Usuario**: Proporcionar wizards interactivos para diagnósticos complejos (USB) y tareas de calibración críticas.

## 2. Análisis del Estado Actual

### 2.1 Limitaciones del Parser Actual (`initojson.py` y `metadata.ts`)
El sistema actual depende de una cadena de herramientas frágil y costosa en rendimiento:
-   **Dependencia de Python**: `src/server/helpers/metadata.ts` invoca un script externo (`src/scripts/initojson.py`) mediante `exec`, lo que introduce latencia y dependencia del entorno de ejecución del sistema operativo.
-   **Parsing de Metadatos con SED**: La función `parseMetadata` utiliza comandos `sed` de bash para extraer bloques JSON de comentarios. Esto es inseguro y no portátil a entornos no-Unix (aunque RatOS corre en Linux, el configurador podría querer correr en otros entornos para desarrollo).
-   **Estructura Plana**: El script Python aplana la configuración, perdiendo la jerarquía y el origen de los datos (archivos incluidos).

### 2.2 Estructura de Datos RatOS
RatOS utiliza una estructura altamente opinionada definida en `src/zods/`:
-   `printer-definition.json`: Define la impresora y sus capacidades.
-   `board-definition.json`: Abstrae los pines de la placa.
-   Archivos `.cfg` modulares: Separados por componente (`steppers`, `hotends`, etc.).

### 2.3 Limitaciones de los Wizards (`setup-steps`)
El archivo `src/components/setup-steps/index.tsx` utiliza una función `makeSteps` que genera un array estático de pasos.
-   **Linealidad Forzada**: No soporta bifurcaciones complejas (ej. "Si el usuario selecciona una placa con CAN bus, mostrar pasos de configuración CAN, si no, USB").
-   **Estado Efímero**: Si el usuario recarga la página, el progreso se pierde o depende de validaciones globales complejas (`isConfigValid`).

## 3. Arquitectura Propuesta: Enfoque de Próxima Generación

Para superar las limitaciones actuales, se propone una arquitectura basada en **AST (Abstract Syntax Trees)**, **Inferencia Heurística** y **Máquinas de Estado Finitas**.

### 3.1 Módulo de Parsing Recursivo: Motor AST (Advanced Config Parser)
Se eliminará `initojson.py` y el uso de `sed` en favor de un parser nativo en TypeScript.

-   **Ubicación**: `src/server/helpers/klipper-parser/`
-   **Tecnología**: Parser combinatorio o recursivo descendente en TS puro.
-   **Modelo de Datos (AST)**:
    El parser generará un Árbol de Sintaxis Abstracta que representa fielmente la estructura del archivo, preservando comentarios y espacios en blanco.

    ```typescript
    type KlipperNode = 
      | { type: 'Section', name: string, properties: Property[], children: KlipperNode[] }
      | { type: 'Property', key: string, value: string | number | boolean }
      | { type: 'Include', path: string, resolvedNode: KlipperNode } // Recursividad
      | { type: 'Comment', content: string };
    ```

-   **Ventajas**:
    1.  **Edición Quirúrgica**: Permite modificar un valor sin alterar el formato.
    2.  **Eliminación de Procesos Externos**: Se elimina la llamada a Python y Bash, mejorando el rendimiento y la seguridad.

### 3.2 Motor de Inferencia de Hardware: Fingerprinting Heurístico
Los esquemas Zod actuales (`src/zods/hardware.tsx`, `src/zods/motion.tsx`) definen la estructura de datos pero no contienen los valores físicos característicos para identificación.

-   **Nueva Entidad: Base de Datos de Huellas (Hardware Fingerprint DB)**
    Se creará un registro de "firmas" de hardware conocidas.

    ```typescript
    // Ejemplo de firma para un motor
    const KnownMotors = [
      {
        id: 'ldo-42sth48-2504ac',
        fingerprint: {
          rotation_distance: 40,
          microsteps: [16, 32],
          run_current: { min: 1.0, max: 1.6 } // Rango aceptable
        }
      }
    ];
    ```

-   **Algoritmo de Matching**:
    1.  Extraer vector de características del AST parseado.
    2.  Calcular distancia (Euclidiana o Coseno) contra la DB de Huellas.
    3.  **Lógica Difusa**: Si la coincidencia es > 90%, sugerir el componente.

### 3.3 Generación de Infraestructura: Sintetizador Idempotente
El generador debe ser capaz de "reconciliar" el estado deseado con el estado actual.

-   **Validación Zod**: El AST importado se transformará en objetos intermedios validados contra `PrinterConfiguration` y otros esquemas existentes.
-   **Transaccionalidad con Git**: Uso de `src/server/services/git.ts` para crear puntos de restauración antes de aplicar cambios masivos.

### 3.4 Arquitectura de Wizards: Máquinas de Estado (Statecharts)
Reemplazar la lógica de `makeSteps` en `src/components/setup-steps/index.tsx` con **XState**.

-   **Beneficios**:
    *   **Flujos Condicionales**: Lógica de transición explícita.
    *   **Smart Resume**: El estado de la máquina (ej. `state: { calibration: 'pid_tuning' }`) se puede persistir en el backend (`ConfigurationService`).
    *   **Desacoplamiento**: La UI solo renderiza el estado actual, la lógica de transición vive en la máquina.

## 4. Estrategia de Migración

### Fase 1: Reemplazo del Parser (Core)
1.  Implementar `KlipperParser` en TypeScript.
2.  Crear tests que comparen la salida del nuevo parser con la salida de `initojson.py` para asegurar paridad inicial.
3.  Reemplazar `parseMetadata` en `metadata.ts` para usar el nuevo parser en lugar de `sed`.

### Fase 2: Enriquecimiento de Datos
1.  Extender `src/zods/` o crear un nuevo módulo `src/data/hardware-fingerprints.ts` con los vectores característicos de los componentes soportados actualmente.

### Fase 3: UI y Wizards
1.  Implementar la máquina de estados para el wizard de "Hardware Selection".
2.  Migrar `setup-steps/index.tsx` para consumir la máquina de estados en lugar del array estático.

## 5. Procedimientos de Validación

### 5.1 Testing Basado en Propiedades
Utilizar `fast-check` para generar archivos de configuración aleatorios y verificar:
-   **Robustez**: El parser nunca debe lanzar excepciones no controladas.
-   **Idempotencia**: `Parse(Generate(Parse(config))) == Parse(config)`.

---
**Conclusión**: Esta arquitectura elimina la deuda técnica asociada a los scripts heredados de Python/Bash y prepara a RatOS Configurator para un futuro de configuración asistida inteligente y robusta.
