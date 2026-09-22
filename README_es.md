# EIDOLON v1.3.1

<p align="center">
  <strong>Destilación de Personalidad, Relaciones Dinámicas L4 y Memoria Biométrica</strong><br>
  <em>«Preservar la expresión. Reconstruir el contexto. Medir la fidelidad. Simular una presencia auténtica.»</em>
</p>

<p align="center">
  <a href="README.md"><strong>🇨🇳 简体中文</strong></a> •
  <a href="README_en.md"><strong>🇺🇸 English</strong></a> •
  <a href="README_zh-TW.md"><strong>🇭🇰/🇹🇼 繁體中文</strong></a> •
  <a href="README_ja.md"><strong>🇯🇵 日本語</strong></a> •
  <a href="README_ko.md"><strong>🇰🇷 한국어</strong></a> •
  <a href="README_ru.md"><strong>🇷🇺 Русский</strong></a> •
  <a href="README_fr.md"><strong>🇫🇷 Français</strong></a> •
  <a href="README_es.md"><strong>🇪🇸 Español</strong></a> •
  <a href="docs/human-simulation-algorithm.md"><strong>📐 Especificación del algoritmo</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.3.1-blue.svg" alt="Release: v1.3.1">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/L4%20State-BSM%20Engine-ff69b4.svg" alt="L4 State: BSM Engine">
  <img src="https://img.shields.io/badge/Tests-234%20Passed-brightgreen.svg" alt="Tests: 234 Passed">
</p>

---

## Contenido

- [1. Redefinición del Proyecto](#1-redefinición-del-proyecto)
- [2. Arquitectura y 7 Capas de Destilación](#2-arquitectura-y-7-capas-de-destilación)
- [3. Índice de Similitud de Destilación (DSI)](#3-índice-de-similitud-de-destilación-dsi)
- [4. Relaciones Dinámicas L4 y Simulación Humana](#4-relaciones-dinámicas-l4-y-simulación-humana)
- [5. Inicio Rápido y Asistente de Configuración](#5-inicio-rápido-y-asistente-de-configuración)
- [6. Referencia de Comandos CLI](#6-referencia-de-comandos-cli)
- [7. Licencia](#7-licencia)

---

## 1. Redefinición del Proyecto

EIDOLON ya no se define como una simple herramienta que "resume chats en un prompt del sistema".

**Definición Oficial V1.2:**
> **«Destilar características lingüísticas, de comportamiento, rítmicas y contextuales computables a partir de conversaciones reales, impulsadas por un motor de emociones y relaciones dinámicas L4, rigurosamente verificadas en pruebas a doble ciego para garantizar la autenticidad y presencia real de un compañero humano.»**

---

## 2. Arquitectura y 7 Capas de Destilación

| Capa | Módulo | Características y Métricas | Archivo Resultante |
| :--- | :--- | :--- | :--- |
| **Layer 1** | Huella Lingüística | Vocabulario, signos de puntuación, longitud de frases | `language_model.json` |
| **Layer 2** | Estilo Condicional | Probabilidad bayesiana $P(\text{estilo} \mid \text{contexto})$ | `style.json` |
| **Layer 3** | Árbol de Decisiones | Estrategias situacionales (humor, empatía, análisis, repreguntas) | `behavior.json` |
| **Layer 4** | Ritmo de Conversación | Latencia de respuesta según longitud del mensaje, envío múltiple | `rhythm.json` |
| **Layer 5** | Recursos y Emojis | Adhesivos, emojis y su matriz de vinculación semántica | `assets.json` |
| **Layer 6** | Modelo del Mundo | Grafo relacional, línea temporal, separación de datos | `world.json` |
| **Layer 7** | Semilla de Memoria | L0 búfer, L1 episódica, L2 semántica, L3 cosmovisión | `memory_seed.json` |

---

## 5. Inicio Rápido y Asistente de Configuración

```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm run build:server
npm start
```

Pasos del asistente:
1. **Paso 0**: Selección de idioma (Inglés predeterminado, Español, Chino, Japonés, Coreano, Ruso, Francés).
2. **Paso 1**: Conexión a la API del modelo y comprobación simple-test.
3. **Paso 2**: Archivo de chat y contexto adicional del mundo.
4. **Paso 3**: Token del bot de Telegram e ID de usuario.
5. **Paso 4**: Inicio del servicio en segundo plano y emparejamiento con `/start`.
6. **Paso 5**: Confirmación de destilación con progreso en Telegram en tiempo real.

---

## 6. Referencia de Comandos CLI

| Comando | Descripción |
| :--- | :--- |
| `eidolon init` | Inicia el asistente interactivo y la base de datos SQLite |
| `eidolon config [show\|set\|test]` | Muestra, edita configuración o prueba la conexión LLM |
| `eidolon distill <file> [options]` | Ejecuta la destilación en 7 capas y la evaluación |
| `eidolon evaluate <persona>` | Evalúa la personalidad y calcula el índice DSI |
| `eidolon validate <path>` | Valida un paquete `.eidolon` según JSON Schemas |
| `eidolon persona [list\|activate\|install\|verify]` | Administra paquetes de personalidad |
| `eidolon memory [status\|compact\|export]` | Consulta, compacta o exporta la memoria |
| `eidolon bot [token\|user\|status]` | Administra el bot de Telegram y usuarios autorizados |
| `eidolon service [start\|stop\|restart\|status]` | Controla el servicio en segundo plano Go |
| `eidolon logs [-n lines]` | Muestra registros de ejecución en vivo |
| `eidolon status` | Muestra el estado integral del sistema |
| `eidolon clear [--mode all\|chat-memory]` | Limpieza en 3 pasos: purga total (all-clear) o solo chats y memoria |

---

## 7. Licencia

Este proyecto está bajo la licencia **GNU General Public License v3.0 (GPL-3.0)**.
