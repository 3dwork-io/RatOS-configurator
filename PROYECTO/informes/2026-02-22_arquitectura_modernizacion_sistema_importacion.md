# Informe de Modernización de Arquitectura de Software: RatOS Configurator
**Fecha:** 22 de Febrero de 2026
**Estado:** Implementado / En Validación
**Autor:** Asistente de Desarrollo (Trae AI)

## 1. Resumen Ejecutivo

Este documento detalla la reingeniería arquitectónica realizada en el núcleo del sistema de configuración de RatOS. El objetivo principal ha sido eliminar la dependencia de herramientas del sistema operativo (como `sed`, `grep`, scripts de Python externos) y transicionar hacia una arquitectura **Typescript-native**, modular y agnóstica de la plataforma (Windows/Linux/macOS).

Las actualizaciones introducen cuatro pilares fundamentales:
1.  **Parsing basado en AST (Abstract Syntax Tree)** para archivos de configuración Klipper.
2.  **Motor de Inferencia Heurística** para detección de hardware.
3.  **Máquinas de Estado Finito (XState)** para el control de flujo de la interfaz de usuario.
4.  **Integración Transaccional con Git** para la integridad de la configuración.

---

## 2. Nueva Arquitectura de Análisis (AST Parser)

### 2.1. El Problema (Legacy)
El sistema anterior dependía de expresiones regulares lineales y llamadas al sistema (`child_process.exec`) invocando `sed` o scripts de Python (`initojson.py`). Esto presentaba varios problemas:
*   **Fragilidad:** Los regex fallaban con comentarios anidados o estructuras complejas.
*   **Destructivo:** Al escribir cambios, se perdían comentarios y el formato original.
*   **Dependencia del OS:** Incompatible nativamente con Windows sin entornos tipo POSIX.

### 2.2. La Solución: `KlipperParser`
Se ha implementado un parser recursivo descendente que genera un Árbol de Sintaxis Abstracta (AST).

*   **Componentes:**
    *   [index.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/klipper-parser/index.ts): Tokenizador y constructor del árbol.
    *   [types.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/klipper-parser/types.ts): Definiciones de tipos (`KlipperFile`, `Section`, `Property`).
    *   [loader.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/klipper-parser/loader.ts): Manejador de directivas `[include]`, con detección de dependencias circulares y resolución de rutas relativa/absoluta.

*   **Ventajas:**
    *   **Preservación de Metadatos:** El AST conserva comentarios y espacios en blanco, permitiendo ediciones no destructivas.
    *   **Jerárquico:** Entiende la estructura de secciones (`[stepper_x]`) y sus propiedades, permitiendo validación semántica.
    *   **Portabilidad:** 100% TypeScript, ejecuta en cualquier entorno Node.js.

---

## 3. Motor de Inferencia de Hardware Vectorial

### 3.1. Detección Inteligente
En lugar de buscar coincidencias exactas de cadenas (frágil ante cambios menores en configs), se implementó un motor de inferencia basado en vectores de características.

*   **Implementación:** [inference.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/klipper-parser/inference.ts)
*   **Funcionamiento:**
    1.  Extrae un vector de características de la configuración del usuario (ej. `step_pin`, `rotation_distance`, `driver_TBL`).
    2.  Compara este vector contra una base de datos de "huellas digitales" (fingerprints) de hardware conocido.
    3.  Calcula un **Índice de Similitud (Jaccard/Coseno normalizado)**.
    4.  Si la confianza supera un umbral (ej. 0.8), identifica el hardware automáticamente.

*   **Base de Datos Dinámica:** [hardware_db.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/klipper-parser/hardware_db.ts) genera las huellas directamente desde las definiciones de código fuente (`src/data/steppers.ts`), garantizando que la base de datos de inferencia nunca se desincronice con las definiciones de la UI.

---

## 4. Control de Flujo Deterministico (XState)

### 4.1. Gestión de Wizards
La lógica de los asistentes de configuración (Wizards) se manejaba anteriormente mediante una serie dispersa de `useState` y condicionales booleanos, lo que hacía propenso a errores y estados imposibles.

### 4.2. Máquina de Estados
Se ha introducido [wizard-machine.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/machines/wizard-machine.ts) utilizando **XState**.

*   **Estructura:**
    *   **Estados Explícitos:** `wifiSetup` -> `printerSelection` -> `mcuPreparation` -> `toolboardPreparation` -> `hardwareSelection` -> `confirm`.
    *   **Guardas (Guards):** Lógica condicional encapsulada (ej. `hasWifi`, `hasToolheads`).
    *   **Acciones:** Efectos secundarios controlados (ej. `resetToolheadIndex`).
*   **Beneficios:**
    *   El flujo es visualizable y determinista.
    *   Es imposible "saltar" a un paso sin cumplir los requisitos previos.
    *   Facilita la persistencia del estado y el "deep linking" (sincronización con URL).

---

## 5. Integración Transaccional con Git

### 5.1. Seguridad en la Configuración
Para evitar corromper la configuración del usuario durante actualizaciones automáticas, se integró un servicio de control de versiones.

*   **Servicio:** [git.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/services/git.ts)
*   **Flujo Transaccional:**
    1.  **Pre-Update:** Se realiza un commit automático antes de aplicar cambios ("Pre-RatOS-Configurator Update").
    2.  **Generación:** Se regeneran los archivos de configuración usando el nuevo sistema AST.
    3.  **Post-Update:** Se realiza un commit final si todo fue exitoso.
*   Esto permite al usuario (y al sistema) revertir cambios automáticamente en caso de error crítico, actuando como un sistema de "Undo" robusto.

---

## 6. Eliminación de Deuda Técnica

Se han eliminado componentes heredados que causaban fricción en el desarrollo y despliegue:
*   **Eliminado:** `src/scripts/initojson.py` (Script Python lento y dependiente de entorno).
*   **Refactorizado:** [metadata.ts](file:///d:/Mi Mundo/Imprision3D/KLIPPER/RatOS-configurator/src/server/helpers/metadata.ts) ahora utiliza `KlipperParser` en lugar de llamadas `exec('sed ...')`.

## 7. Conclusión

La arquitectura actual de RatOS Configurator ha madurado de una colección de scripts utilitarios a una aplicación robusta de ingeniería de software moderna. La adopción de AST y Máquinas de Estado posiciona al proyecto para escalar, soportar más hardware y ofrecer una experiencia de usuario mucho más estable y predecible en cualquier sistema operativo.
