# EIDOLON v1.3.1

<p align="center">
  <strong>人格蒸餾、L4 動態關係狀態與生體記憶執行階段</strong><br>
  <em>«留存表達，重構語境，度量擬真，重現真實陪伴。»</em>
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
  <a href="docs/human-simulation-algorithm.md"><strong>📐 演算法規範 (Algorithm Spec)</strong></a>
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

## 目錄

- [1. 專案重新定義](#1-專案重新定義)
- [2. 核心架構與 7 層蒸餾](#2-核心架構與-7-層蒸餾)
- [3. DSI 蒸餾相似度指數](#3-dsi-蒸餾相似度指數)
- [4. L4 動態關係狀態與真人模擬演算法](#4-l4-動態關係狀態與真人模擬演算法)
- [5. 工程與安全加固](#5-工程與安全加固)
- [6. 快速開始與首次部署引導](#6-快速開始與首次部署引導)
- [7. CLI 命令完整索引](#7-cli-命令完整索引)
- [8. 授權協議](#8-授權協議)

---

## 1. 專案重新定義

EIDOLON 不再被定義為「將聊天紀錄總結成系統 Prompt」的簡單提示工程工具。

**V1.2 官方定義：**
> **«從真實歷史對話中蒸餾出可計算的語言風格、行為策略、交互節奏、背景語境與記憶圖譜，在 L4 動態關係與情緒引擎驅動下，透過離線獨立雙盲評測集嚴格驗證風格一致性與事實擬真度，並在線上交互中提供具備生體特徵的高擬真真人陪伴。»**

EIDOLON 由兩個嚴格解耦的閉環組成：

```text
蒸餾閉環 (DISTILLATION LOOP):
歷史聊天資料 ──▶ 多格式匯入清洗 ──▶ 7 層特徵蒸餾 ──▶ 人格執行階段包 (.eidolon)

評測閉環 (EVALUATION LOOP):
獨立雙盲測試集 ──▶ 候選回覆生成 (A/B/C) ──▶ 獨立裁判雙盲評判 ──▶ DSI 綜合評分 ──▶ 失敗反思與最佳化
```

只有雙閉環皆執行並通過品質門禁（Quality Gate，預設 DSI ≥ 0.80）時，人格模型才被視為**蒸餾完成**。

---

## 2. 核心架構與 7 層蒸餾

| 層級 | 模組名稱 | 蒸餾標的與數學特徵 | 匯出成品 |
| :--- | :--- | :--- | :--- |
| **Layer 1** | 統計語言指紋 | 詞彙分布、標點特徵（句末標點脫落率）、破折號/波浪號/省略號指紋、訊息長度機率分布 | `language_model.json` |
| **Layer 2** | 條件風格模型 | 貝氏條件機率 $P(\text{風格特徵} \mid \text{情境})$、情緒觸發強度 | `style.json` |
| **Layer 3** | 階層式行為決策樹 | 情境感知策略（幽默調侃、同理支持、認真分析、適度反問）、話題切換機率 | `behavior.json` |
| **Layer 4** | 動態對話節奏 | 回覆延遲模型（短/中/長訊息時延）、連發訊息機率 $P(\text{連發})$、回覆模式偏好 | `rhythm.json` |
| **Layer 5** | 語境資產綁定 | 靜態/動態貼圖庫、自訂表情包、語意標籤與情境綁定機率矩陣 | `assets.json` |
| **Layer 6** | 語境補充與世界模型 | 人物關係圖譜、歷史大事件時序節點、嚴格區分歷史對話事實與使用者補充設定 | `world.json` |
| **Layer 7** | 分層生體記憶種子 | L0 工作緩衝、L1 情景記憶（帶遺忘曲線）、L2 語意事實（時態演化）、L3 全局世界觀 | `memory_seed.json` |

---

## 3. DSI 蒸餾相似度指數

蒸餾相似度指數（Distillation Similarity Index, DSI）為離線雙盲評測綜合指標：

$$\text{DSI} = w_L \cdot L + w_S \cdot S + w_B \cdot B + w_C \cdot C + w_H \cdot H$$

其中標準權重為：
- $w_L = 0.20$（詞彙擬真度 Lexical Fidelity）
- $w_S = 0.20$（風格特徵比對 Style Fidelity）
- $w_B = 0.25$（行為策略一致性 Behavioral Alignment）
- $w_C = 0.15$（語境與記憶一致性 Contextual Consistency）
- $w_H = 0.20$（獨立大模型雙盲裁判勝率 Blind LLM Judge）

---

## 4. L4 動態關係狀態與真人模擬演算法

EIDOLON 內建完整的 **BSM (Biometric Simulation Model)** 引擎：
1. **動態關係演化**：陌生人 $\rightarrow$ 熟人 $\rightarrow$ 朋友 $\rightarrow$ 曖昧 $\rightarrow$ 摯友/戀人。
2. **三維情緒矩陣**：好感度 (Affection 0-100)、親密度 (Intimacy 0-100)、信任度 (Trust 0-100)。
3. **人類擬真打字時延**：
   $$\text{Delay} = T_{\text{read}} + T_{\text{think}} + (\text{Len} \times T_{\text{type}}) + \text{Jitter}$$
4. **自適應連發訊息**：符合真人碎句發送習慣。

詳細演算法請參見：[docs/human-simulation-algorithm.md](docs/human-simulation-algorithm.md)。

---

## 6. 快速開始與首次部署引導

### 1. 全域安裝或本地建置
```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm run build:server
```

### 2. 首次部署使用者引導精靈
```bash
npm start
# 或執行:
node cli/index.js guide
```
引導程式將依照規範執行：
1. **步驟 0**：選擇偏好語言（預設 English，支援繁體中文、簡體中文、日語、韓語、俄語、法語、西班牙語）。
2. **步驟 1**：配置並執行模型 API Simple-Test 確保連通性。
3. **步驟 2**：輸入蒸餾聊天紀錄檔案路徑，並追問補充大環境/世界觀背景設定。
4. **步驟 3**：設定 Telegram 機器人 Token 與主使用者 User ID。
5. **步驟 4**：啟動背景常駐服務，引導使用者在 Telegram 發送 `/start` 進行安全配對。
6. **步驟 5**：確認啟動人格蒸餾，在 Telegram 即時匯報進度，完成後全量清理準備指令，無縫切換真人陪伴人格。

---

## 7. CLI 命令完整索引

| 命令 | 說明 |
| :--- | :--- |
| `eidolon init` | 啟動互動式引導程式，初始化環境、設定與 SQLite 資料庫 |
| `eidolon config [show\|set\|test]` | 查看、修改設定或進行 LLM 連通性 Simple-Test |
| `eidolon distill <file> [options]` | 執行對話攝取、7 層特徵蒸餾、Telegram 進度推送與離線評測 |
| `eidolon evaluate <persona>` | 對指定人格執行離線評測與 DSI 指標計算 |
| `eidolon validate <path>` | 校驗 `.eidolon` 安裝包或目錄的 JSON Schema 合規性 |
| `eidolon persona [list\|activate\|install\|verify]` | 查看、啟用、安全安裝或驗證人格包 |
| `eidolon memory [status\|compact\|export]` | 查看各層記憶統計、壓縮過期事實或匯出全量記憶 |
| `eidolon bot [token\|user\|status]` | 管理 Telegram Token 與授權使用者白名單 |
| `eidolon service [start\|stop\|restart\|status]` | 控制 Go 服務端常駐守護行程 |
| `eidolon logs [-n lines]` | 查看守護行程即時運作日誌 |
| `eidolon status` | 查看整體系統子系統與運作狀態 |
| `eidolon clear [--mode all\|chat-memory]` | 三步驟互動式清理：完全清空 (all-clear) 或僅清理聊天紀錄與記憶 (保留蒸餾成果) |

---

## 8. 授權協議

本專案基於 **GNU General Public License v3.0 (GPL-3.0)** 授權開源。
