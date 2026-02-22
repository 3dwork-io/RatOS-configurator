# Informe Técnico de Ingeniería: Proyecto RatOS Configurator

**Fecha:** 22 de Febrero de 2026  
**Proyecto:** RatOS Configurator  
**Ubicación:** `d:\Mi Mundo\Imprision3D\KLIPPER\RatOS-configurator`  
**Autor:** Asistente Técnico Senior (Trae IDE)

---

## 1. Introducción y Objetivos

El presente informe técnico tiene como objetivo documentar de manera exhaustiva el estado actual del proyecto `RatOS-configurator`, analizar su arquitectura hardware y software, y establecer una hoja de ruta para la creación de nuevo hardware de impresión 3D. Este documento servirá como base autorizada para equipos de ingeniería, fabricación y soporte técnico.

## 2. Análisis de Arquitectura del Hardware Existente y Propuesta

El proyecto se basa en una arquitectura altamente modular que separa las definiciones de hardware en componentes discretos, permitiendo una configuración flexible de impresoras 3D basadas en Klipper.

### 2.1 Arquitectura Actual
La estructura de configuración (`/configuration`) se organiza jerárquicamente:
- **Printers (`/printers`)**: Define modelos específicos (V-Core 3, V-Minion, Voron V2.4, Prusa MK3S, etc.). Cada impresora define sus dimensiones, límites de velocidad y cinemática base.
- **Boards (`/boards`)**: Abstrae el controlador electrónico (BTT Octopus, Manta M8P, EBB Toolboards). Incluye esquemas de pines, scripts de flasheo y metadatos de conexión.
- **Módulos Componentes**:
    - `hotends/`: Definiciones térmicas y de flujo para hotends (Rapido, Dragon, Mosquito, Revo).
    - `extruders/`: Configuraciones de motor y pasos para extrusores (Orbiter, LGX, Sherpa).
    - `z-probe/`: Estrategias de sondeo (BLTouch, Beacon, Euclid, Inductive).
    - `steppers/`: Perfiles de corriente y driver para motores LDO y otros.
    - `4pin-fans/`: Perfiles de control PWM para ventiladores.

### 2.2 Propuesta de Nuevos Componentes
Para la expansión del ecosistema, se recomienda la integración de:
- **Nuevas Placas Controladoras**: Soporte para placas basadas en RP2040 y STM32H7 para mayor capacidad de procesamiento.
- **Toolheads Integrados**: Definiciones "todo en uno" que agrupen hotend, extrusor, ventiladores y placa de herramienta (toolboard) para simplificar la selección del usuario.
- **Sistemas de Cambio de Herramienta (Toolchangers)**: Ampliación de la lógica de `toolhead` para soportar múltiples cabezales físicos con cinemática de acople.

## 3. Especificaciones Técnicas Completas

### 3.1 Placas Controladoras (Controller Boards)
Las definiciones se encuentran en `configuration/boards/`. Cada placa debe cumplir con el esquema `board-definition.schema.json`.
- **Requisitos**:
    - Mapeo completo de pines GPIO a alias estándar de Klipper.
    - Scripts de compilación (`compile.sh`) y flasheo (`flash.sh`) automatizados.
    - Documentación de cableado (imágenes/diagramas).
    - Soporte para comunicación USB y CAN bus.

### 3.2 Extrusores y Hotends
- **Extrusores**: Deben definir `rotation_distance`, `gear_ratio`, y corriente motor recomendada. Ejemplos actuales: Orbiter 2.0, LGX Lite.
- **Hotends**: Deben especificar termistores, límites de temperatura, potencia de calentador y longitud de retracción recomendada. Ejemplos: Rapido UHF, Revo Six.

### 3.3 Sensores y Sondas (Probes)
- **Sondas Z**: Soporte para inductivas, capacitivas, de contacto (Beacon/Cartographer) y mecánicas (BLTouch, Euclid).
- **Acelerómetros**: Integración de ADXL345/LIS2DW para Input Shaper, conectados vía SPI o I2C en toolboards.

### 3.4 Toolboards (Placas de Cabezal)
- **Especificaciones**: Conexión CAN bus simplificada, gestión de termistores on-board, drivers TMC2209 integrados para el extrusor.

## 4. Documentación de Macros y Scripts

### 4.1 Macros Klipper (`macros.cfg`)
El sistema utiliza macros avanzadas para abstracción de operaciones:
- **`Z_TILT_ADJUST`**: Adaptado para soportar sondas desplegables (stowable probes) y sensores de contacto tipo Beacon.
- **Macros de Inicio (Start Print)**: Lógica condicional para calentamiento, nivelación de cama (Mesh/Tilt) y purga adaptativa.
- **Gestión de Errores**: Macros para manejo seguro de pausas, cancelaciones y fallos de filamento.

### 4.2 Scripts de Sistema (`/scripts`)
- **`generate-devbox-environment.sh`**: Crea un entorno de desarrollo aislado y reproducible utilizando Nix/Devbox, vinculando las configuraciones locales con instancias de Klipper/Moonraker.
- **`post-merge.sh`**: Hooks para asegurar la integridad del repositorio tras actualizaciones.
- **Gestión de Entorno**: Scripts para compilar firmware de MCUs automáticamente.

## 5. Definición de Templates y Estándares

### 5.1 Templates (`configuration/templates`)
Los archivos `.template.cfg` sirven como base para generar el `printer.cfg` final del usuario.
- **Estructura**:
    - Inclusión de archivos base (`base.cfg`).
    - Marcadores de posición para inclusiones dinámicas (boards, hotends).
    - Secciones anulables por el usuario (`[include overrides.cfg]`).

### 5.2 Estándares de Implementación
- **Nomenclatura**: Uso estricto de identificadores en minúsculas y guiones (kebab-case) para archivos y directorios.
- **Modularidad**: Ningún valor "hardcoded" en el archivo principal si puede ser abstraído a un módulo.
- **Validación**: Todo nuevo hardware debe pasar la validación contra los esquemas JSON (`printer-definition.schema.json`, `board-definition.schema.json`).

## 6. Roadmap Técnico

### Fase 1: Consolidación y Limpieza (Q2 2026)
- **Milestone 1.1**: Estandarización de todas las definiciones de placas bajo el esquema v2.0.
- **Milestone 1.2**: Refactorización de macros para eliminar dependencias heredadas.
- **Criterio de Aceptación**: 100% de los tests de integración (`src/__tests__`) pasando.

### Fase 2: Expansión de Hardware (Q3 2026)
- **Milestone 2.1**: Soporte nativo para cinemáticas IDEX y Toolchanger en el configurador UI.
- **Milestone 2.2**: Integración de cámaras y visión por computador (Obico/Crowsnest).

### Fase 3: Ecosistema Inteligente (Q4 2026)
- **Milestone 3.1**: Análisis de resonancia automatizado y sugerencia de correas.
- **Milestone 3.2**: Calibración de flujo asistida por IA/Lidar (si hardware disponible).

## 7. Plan de Pruebas y Validación

### 7.1 Validación de Hardware
- **Prueba de Humo (Smoke Test)**: Verificación eléctrica básica de nuevas placas.
- **Prueba de Carga Térmica**: Ciclos de calentamiento PID en hotends y camas por 24h.
- **Prueba de Estrés de Motores**: Movimientos a alta velocidad y aceleración para verificar pérdida de pasos y temperatura de drivers.

### 7.2 Validación de Software
- **Tests Unitarios**: Ejecución de `npm test` en `src/` para validar lógica de generación de config.
- **Tests de Integración**: Simulación de generación de config para todas las combinaciones posibles de hardware.
- **Validación en Máquina Real**: Flasheo y ejecución de macros estándar en impresora de referencia.

## 8. Estrategia de Implementación

1.  **Desarrollo Local**: Utilizar `devbox` para simular cambios sin afectar hardware físico.
2.  **Canal Beta**: Despliegue de nuevas definiciones a un grupo controlado de usuarios (RatOS Beta).
3.  **Release General**: Publicación en `main` tras validación comunitaria.
4.  **Rollback**: Mantenimiento de versiones anteriores de configuraciones para recuperación rápida.

## 9. Manual de Mantenimiento y Troubleshooting

### Mantenimiento Preventivo
- **Mensual**: Verificación de tensión de correas (usando script de resonancia), limpieza de ventiladores.
- **Trimestral**: Re-ejecución de PID tuning y Input Shaper.

### Troubleshooting Común
- **"MCU unable to connect"**: Verificar cableado USB/CAN, revisar `dmesg` en la Pi, re-flashear firmware con script `flash.sh`.
- **"ADC out of range"**: Termistor desconectado o en corto. Revisar pines en `board-definition.json`.
- **Errores de Homing**: Verificar sensibilidad de Sensorless Homing en `tmc2209.cfg` o estado de endstops físicos.

## 10. Cumplimiento de Normativas y Seguridad

- **Seguridad Térmica**: Klipper incluye protección "Thermal Runaway" obligatoria. Las configuraciones deben tener `min_temp` y `max_temp` definidos correctamente.
- **Seguridad Eléctrica**: Las placas deben tener fusibles accesibles. El cableado de red (AC) debe estar aislado y con tierra física.
- **Certificaciones**: Componentes electrónicos (placas, fuentes) deben contar con marcado CE/FCC.

## 11. Estimación de Recursos

- **Equipo de Ingeniería**:
    - 1 Lead Developer (Arquitectura Software/Firmware).
    - 1 Ingeniero Electrónico (Validación Hardware).
    - 1 Ingeniero QA (Pruebas y Documentación).
- **Infraestructura**:
    - Laboratorio de pruebas con al menos una unidad de cada familia de impresoras (V-Core, V-Minion).
    - Servidor de CI/CD para compilación de firmware.
- **Tiempo Estimado**:
    - Integración de nueva placa: 1 semana.
    - Integración de nueva impresora completa: 4-6 semanas.
    - Ciclo completo de Release (Fase 1-3): 9 meses.

---
**Nota Final**: Este documento es un "documento vivo" y debe actualizarse con cada cambio mayor en la arquitectura del sistema.
