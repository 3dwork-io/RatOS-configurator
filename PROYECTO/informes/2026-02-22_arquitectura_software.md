# Informe de Arquitectura de Software - RatOS Configurator
Fecha: 2026-02-22
Autor: Trae AI (Asistente de Desarrollo)

## 1. Resumen Ejecutivo
Este documento detalla la arquitectura de software actualizada de RatOS Configurator, diseñada para ofrecer una gestión de configuración de Klipper robusta, escalable y de alto rendimiento. La arquitectura ha evolucionado desde un enfoque basado en manipulación de texto plano (regex/sed) hacia un sistema estructurado basado en Árboles de Sintaxis Abstracta (AST), Máquinas de Estado Finito (XState) y Tipado Estricto (TypeScript/Zod).

## 2. Componentes Principales

### 2.1. Sistema de Gestión de Configuración (Core)
El núcleo del sistema es el `KlipperParser` y el `ConfigurationService`.
- **AST Parser**: Reemplazo de `initojson` y `sed` por un parser nativo en TypeScript que construye un AST de la configuración de Klipper. Esto permite lecturas y escrituras no destructivas, preservando comentarios y formato.
- **Zod Schemas**: Todas las estructuras de datos (impresoras, cabezales, hardware) están definidas y validadas mediante Zod, garantizando la integridad de los datos en tiempo de ejecución.
- **GitService**: Integración transaccional con Git para el versionado de configuraciones. Cada cambio se registra como un commit, permitiendo rollbacks y auditoría.

### 2.2. Motor de Inferencia de Hardware
- **Vector-Based Fingerprinting**: Detección automática de hardware mediante comparación vectorial de características. Se extraen "huellas" de los archivos de configuración y se comparan con una base de datos de definiciones conocidas (steppers, drivers, sensores) utilizando algoritmos de similitud (distancia euclidiana/coseno).
- **MCU Detection**: Escaneo paralelo de dispositivos USB/Serial para identificar placas controladoras y toolboards.

### 2.3. Gestión de Flujo de Usuario (Wizards)
- **XState**: Implementación de máquinas de estado para los asistentes de configuración (Wizards). Esto permite flujos de configuración deterministas, manejo de errores robusto y recuperación de estado.
- **TRPC**: Capa de comunicación tipo-segura entre el frontend (React) y el backend (Node.js).

### 2.4. Procesamiento de GCode
- **Stream Processing**: Análisis de archivos GCode mediante streams de Node.js para bajo consumo de memoria, incluso con archivos de cientos de MB.
- **Metadata Extraction**: Extracción eficiente de miniaturas y metadatos de impresión.

## 3. Diagrama de Arquitectura (Conceptual)

```mermaid
graph TD
    Client[React Client] <-->|TRPC| Server[Node.js Server]
    Server -->|Parse/Serialize| AST[AST Engine]
    Server -->|State Machine| XState[Wizard Logic]
    Server -->|Validate| Zod[Zod Schemas]
    Server -->|Version Control| Git[Git Service]
    AST <-->|Read/Write| FS[File System (*.cfg)]
    Git <-->|Commit/Diff| FS
    Server -->|Detect| Hardware[Hardware Inference]
    Hardware -->|Scan| USB[USB/Serial Ports]
```

## 4. Tecnologías Clave
- **Lenguaje**: TypeScript 5.x (Strict Mode)
- **Runtime**: Node.js
- **Framework**: Next.js
- **API**: TRPC
- **Validación**: Zod
- **Estado**: XState, Zustand
- **Parser**: Custom Recursive Descent Parser (Klipper Config Format)

## 5. Patrones de Diseño
- **Repository Pattern**: Abstracción del acceso a datos (archivos de configuración).
- **Service Layer**: Lógica de negocio encapsulada en servicios (`ConfigurationService`, `MCUService`).
- **Dependency Injection**: Inyección de dependencias para facilitar testing y desacoplamiento.
- **Immutable Data Structures**: Preferencia por inmutabilidad para predecibilidad del estado.

## 6. Seguridad y Estabilidad
- **Atomic Writes**: Escrituras en disco atómicas para evitar corrupción de archivos.
- **Error Handling**: Manejo centralizado de errores con tipos de error personalizados.
- **Type Safety**: Cobertura de tipos cercana al 100% para prevenir errores en tiempo de ejecución.

## 7. Conclusión
La nueva arquitectura posiciona a RatOS Configurator como una herramienta profesional, mantenible y extensible, capaz de soportar la creciente complejidad del ecosistema Klipper y las necesidades de los usuarios avanzados.
