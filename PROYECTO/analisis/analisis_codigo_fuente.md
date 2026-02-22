# Informe Técnico: Análisis de Código Fuente RatOS-configurator

**Fecha:** 2026-02-22
**Estado:** Borrador Inicial
**Objetivo:** Identificar oportunidades de mejora en seguridad, calidad, mantenibilidad y rendimiento del código fuente.

## 1. Resumen Ejecutivo

El análisis del directorio `src` ha revelado varias áreas críticas que requieren atención inmediata, principalmente en torno a la seguridad (uso de `exec`) y la arquitectura (violaciones de SRP en routers). Se han identificado también oportunidades para mejorar la seguridad de tipos en TypeScript y reducir la duplicación de código.

## 2. Hallazgos Críticos (Seguridad)

### 2.1. Inyección de Comandos Potencial en `printer.ts`
*   **Ubicación:** `src/server/routers/printer.ts` (Líneas 524, 552, 598, 648).
*   **Severidad:** **Alta**.
*   **Descripción:** Se utiliza la función `exec` de `child_process` para ejecutar `git diff`. Aunque los nombres de los archivos temporales (`/tmp/...`) se generan de forma segura con `timehash`, la variable `oldPath` (línea 598) se deriva de `oldFile.fileName`. Si un atacante pudiera manipular el nombre del archivo de configuración (aunque sea validado previamente), podría teóricamente inyectar comandos de shell.
*   **Código Afectado:**
    ```typescript
    exec(`git diff ... ${oldPath} ...`, (err, stdout, stderr) => { ... });
    ```
*   **Recomendación:** Reemplazar `exec` con `execFile` para evitar la interpretación del shell, o utilizar una librería de abstracción de Git. Validar estrictamente los nombres de archivo para asegurar que no contengan caracteres de control de shell.

### 2.2. Uso de `any` en TypeScript
*   **Ubicación:** Múltiples archivos, incluyendo:
    *   `src/server/routers/printer.ts` (Línea 57, 791).
    *   `src/server/gcode-processor/GCodeFile.ts` (Línea 44).
    *   `src/server/services/mcu.ts`.
*   **Severidad:** **Media**.
*   **Descripción:** El uso de `any` desactiva las comprobaciones de tipo de TypeScript, lo que puede llevar a errores en tiempo de ejecución difíciles de depurar.
*   **Recomendación:** Reemplazar `any` con tipos específicos o `unknown` con validación (Type Guards).

## 3. Calidad de Código y Arquitectura (Code Smells)

### 3.1. Violación del Principio de Responsabilidad Única (SRP) en `printer.ts`
*   **Ubicación:** `src/server/routers/printer.ts`.
*   **Severidad:** **Media-Alta**.
*   **Descripción:** Este archivo tiene más de 900 líneas y maneja múltiples responsabilidades:
    *   Definición de rutas TRPC.
    *   Lógica de negocio de configuración de impresoras.
    *   Operaciones directas del sistema de archivos (lectura/escritura/copia).
    *   Ejecución de comandos del sistema (`git diff`).
*   **Recomendación:** Refactorizar extrayendo la lógica a servicios dedicados:
    *   `GitService`: Para manejar todas las operaciones de git (diffs).
    *   `ConfigurationService`: Para la lógica de serialización/deserialización (ya parcialmente hecho, pero se puede mejorar).
    *   `FileSystemService`: Para abstracciones de lectura/escritura seguras.

### 3.2. Código Duplicado en `compareSettings`
*   **Ubicación:** `src/server/routers/printer.ts` (Función `compareSettings`).
*   **Severidad:** **Baja**.
*   **Descripción:** La llamada a `exec` para `git diff` se repite 4 veces con lógica de manejo de promesas casi idéntica.
*   **Recomendación:** Crear una función helper privada `generateGitDiff(fileA: string, fileB: string): Promise<string>`.

### 3.3. Componentes de UI Grandes
*   **Ubicación:** `src/components/setup-steps/`.
*   **Severidad:** **Baja**.
*   **Descripción:** Componentes como `hardware-selection.tsx` y `printer-selection.tsx` tienden a acumular mucha lógica de presentación y estado, lo que dificulta su testeo y mantenimiento.
*   **Recomendación:** Aplicar el patrón Container/Presenter o extraer lógica compleja a Custom Hooks (como se hizo con `usePrinterConfiguration`).

## 4. Plan de Acción Priorizado

| Prioridad | Tarea | Esfuerzo Estimado |
| :--- | :--- | :--- |
| **1 (Crítica)** | **Harden `printer.ts`**: Reemplazar `exec` con `execFile` y sanitizar inputs. | Bajo |
| **2 (Alta)** | **Refactor `printer.ts`**: Extraer lógica de Git a `GitService`. | Medio |
| **3 (Media)** | **Type Safety**: Eliminar `any` en `printer.ts` y `GCodeFile.ts`. | Bajo |
| **4 (Baja)** | **Limpieza UI**: Refactorizar componentes grandes en `setup-steps`. | Alto |

## 5. Mejoras Realizadas Recientemente (Contexto)
*   Se corrigió vulnerabilidad similar en `wifi.ts` usando `runSudoScript`.
*   Se unificaron helpers (`util.ts` -> `utils.ts`).
*   Se optimizó el rendimiento de Recoil en `usePrinterConfiguration.tsx`.
*   Se extrajo lógica de `mcu.ts` a un servicio independiente.
*   Se migró `fs-reader.js` a TypeScript.
