# Análisis de Rendimiento y Plan de Optimización (Ultra High Performance)
**Fecha:** 22 de Febrero de 2026
**Objetivo:** Identificar cuellos de botella y proponer mejoras para maximizar el rendimiento en `src`.

## 1. Diagnóstico General
El análisis del código fuente ha revelado que, si bien la arquitectura general es sólida (especialmente el `GCodeProcessor` que utiliza streams), existen puntos críticos de bloqueo en el manejo de archivos de configuración y definiciones de hardware. El uso extensivo de operaciones sincrónicas (`readFileSync`, `existsSync`) en el servidor Node.js es el principal limitante para la escalabilidad y la latencia de respuesta.

## 2. Hallazgos Críticos

### 2.1. Bloqueo del Event Loop (I/O Síncrono)
Se detectaron operaciones de lectura de archivos sincrónicas en rutas críticas de ejecución. Esto detiene todo el procesamiento del servidor mientras se lee el disco, lo cual es inaceptable para "ultra alto rendimiento".

*   **Archivo:** `src/server/helpers/klipper-parser/loader.ts`
    *   **Problema:** `fs.readFileSync` y `fs.existsSync` bloquean el hilo principal durante la resolución recursiva de includes.
    *   **Impacto:** Si una configuración tiene múltiples includes anidados, el tiempo de respuesta se degrada linealmente y bloquea otras peticiones.

*   **Archivo:** `src/server/helpers/metadata.ts`
    *   **Problema:** `parseMetadata` y `parsePinAlias` utilizan `readFileSync`, a pesar de estar envueltos en funciones `async`.
    *   **Impacto:** Falsa asincronía; la función devuelve una promesa, pero su ejecución interna sigue siendo bloqueante.

*   **Archivo:** `src/server/services/mcu.ts`
    *   **Problema:** La función `getBoards` lee todos los archivos de definición de placas (`board-definition.json`) de forma síncrona dentro de un `map`.
    *   **Impacto:** Tiempo de inicio lento y latencia alta al listar placas, ya que se leen decenas de archivos secuencialmente y bloqueando.

### 2.2. Procesamiento Secuencial Ineficiente
*   **Archivo:** `src/server/services/mcu.ts`
    *   **Problema:** Se utiliza `glob` para encontrar archivos, pero luego se iteran y leen uno por uno.
    *   **Mejora:** Node.js permite leer múltiples archivos en paralelo utilizando `Promise.all` y `fs/promises`.

### 2.3. Asignación de Objetos en Parsing
*   **Archivo:** `src/server/helpers/klipper-parser/index.ts`
    *   **Problema:** El uso intensivo de `substring` y `split` genera muchas cadenas intermedias que aumentan la presión sobre el Garbage Collector.
    *   **Mejora:** Para un rendimiento extremo, se podría usar un lexer basado en índices (sin crear substrings hasta el final) o Buffers, aunque para el tamaño típico de archivos de configuración (<100KB), la prioridad debe ser el I/O.

## 3. Plan de Optimización "Ultra High Performance"

### Fase 1: Desbloqueo de I/O (Prioridad Máxima)
Transformar todas las operaciones de lectura de archivos críticas a sus contrapartes asíncronas (`fs/promises`).

1.  **Refactorizar `KlipperLoader`:**
    *   Convertir `load()` a `loadAsync()`.
    *   Implementar `resolveIncludesAsync` para cargar dependencias en paralelo.

2.  **Optimizar `mcu.ts`:**
    *   Reescribir `getBoards` para usar `fs.promises.readFile`.
    *   Utilizar `Promise.all` para leer y parsear todas las definiciones de placas simultáneamente.

3.  **Actualizar `metadata.ts`:**
    *   Reemplazar `readFileSync` con `await fs.readFile`.

### Fase 2: Paralelismo y Caché
Asegurar que las operaciones independientes se ejecuten concurrentemente.

*   **Carga de Includes:** En lugar de esperar a que se cargue un include para procesar el siguiente, iniciar la carga de todos los includes detectados en un archivo simultáneamente.

### Fase 3: Micro-optimizaciones (Opcional)
*   **KlipperParser:** Implementar un modo de "lectura perezosa" (lazy reading) si se detectan archivos inusualmente grandes, aunque no es el caso de uso común.

## 4. Conclusión
La aplicación de estas mejoras transformará el comportamiento del servidor de "secuencial bloqueante" a "paralelo no bloqueante", reduciendo drásticamente la latencia en operaciones de disco y mejorando la capacidad de respuesta general de la aplicación.
