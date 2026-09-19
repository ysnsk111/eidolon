# EIDOLON v1.1.0

<p align="center">
  <strong>Persona Distillation & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity.»</em>
</p>

<p align="center">
  <a href="#-简体中文"><strong>简体中文</strong></a> •
  <a href="#-english"><strong>English</strong></a> •
  <a href="#-日本語"><strong>日本語</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/Tests-34%20Passed-brightgreen.svg" alt="Tests: 34 Passed">
  <img src="https://img.shields.io/badge/DSI-Deterministic%20v1.1-purple.svg" alt="DSI: Deterministic v1.1">
</p>

---

## 快速跳转 / Quick Navigation / クイックナビゲーション

- [🇨🇳 简体中文](#-简体中文)
  - [1. 项目重新定义](#1-项目重新定义)
  - [2. 核心架构与 7 层蒸馏](#2-核心架构与-7-层蒸馏)
  - [3. DSI 蒸馏相似度指数](#3-dsi-蒸馏相似度指数)
  - [4. 工程与安全加固](#4-工程与安全加固)
  - [5. 快速开始](#5-快速开始)
  - [6. CLI 命令完整索引](#6-cli-命令完整索引)
- [🇺🇸 English](#-english)
  - [1. Project Redefinition](#1-project-redefinition)
  - [2. Core Architecture & 7 Distillation Layers](#2-core-architecture--7-distillation-layers)
  - [3. Distillation Similarity Index (DSI)](#3-distillation-similarity-index-dsi)
  - [4. Engineering & Security Hardening](#4-engineering--security-hardening)
  - [5. Quick Start](#5-quick-start)
  - [6. CLI Command Reference](#6-cli-command-reference)
- [🇯🇵 日本語](#-日本語)
  - [1. プロジェクトの再定義](#1-プロジェクトの再定義)
  - [2. コアアーキテクチャと7層蒸留レイヤー](#2-コアアーキテクチャと7層蒸留レイヤー)
  - [3. 蒸留類似度指数 (DSI)](#3-蒸留類似度指数-dsi)
  - [4. エンジニアリングとセキュリティ強化](#4-エンジニアリングとセキュリティ強化)
  - [5. クイックスタート](#5-クイックスタート)
  - [6. CLI コマンドリファレンス](#6-cli-コマンドリファレンス)

---

# 🇨🇳 简体中文

### 1. 项目重新定义

EIDOLON 不再定义为简单的“把聊天记录总结成一个 Prompt”。

**V1.1 正式定义为：**
> **«从历史真实对话中蒸馏出可计算的语言、行为、节奏、上下文与记忆特征，并通过离线评测集严格验证生成结果与历史样本之间的风格一致性与事实保真度。»**

EIDOLON 包含两个完全解耦的闭环：

```text
DISTILLATION LOOP:
Historical Chat ──▶ Ingestion ──▶ Multi-Layer Distillation ──▶ Persona Runtime Package (.eidolon)

EVALUATION LOOP:
Blind Test Dataset ──▶ Candidate Generation ──▶ Pairwise Blind Judge ──▶ DSI Score ──▶ Optimization
```

只有两项均完成并通过质量门槛（Quality Gate），才算真正的 **Distillation Complete**。

---

### 2. 核心架构与 7 层蒸馏

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              EIDOLON CLI                               │
├────────────────────────────────────────────────────────────────────────┤
│    Ingestion    │          Distillation          │      Evaluation     │
├────────────────────────────────────────────────────────────────────────┤
│ Language (L1)   │ Style (L2) │ Behavior (L3)     │ Rhythm Latency (L4) │
│ Assets (L5)     │ World (L6) │ Memory Seed (L7)  │ Reproducibility     │
├────────────────────────────────────────────────────────────────────────┤
│                  Memory Engine (L0-L3 Temporal Store)                  │
├────────────────────────────────────────────────────────────────────────┤
│                  Native SQLite Storage & ACID Engine                   │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram Runtime (Serial Queue) │ HTTP API │ GSAP Web Dashboard        │
└────────────────────────────────────────────────────────────────────────┘
```

#### 7 层特征蒸馏层级：
1. **Layer 1: Language Fingerprint**：字符/句子长度分布（中位数、P90、方差）、中文语气虚词（啊/呀/呢/嘛/吧等）、字词重复模式（哈哈哈/啊啊啊）、消息结构（单行/多行/列表）、标点脱落习惯、Top 词汇特征轮廓（不作为强制硬约束以防过拟合）。
2. **Layer 2: Conditional Style**：基于 Beta-Binomial 贝叶斯平滑（$\alpha=1, \beta=1$）学习 $P(\text{feature} \mid \text{context})$，保留样本规模与置信度。
3. **Layer 3: Response Behavior**：数据驱动的行为策略矩阵（调侃反讽、情感安抚、解释说明等），由统计特征 + LLM 仅做归纳，杜绝通用预设模板。
4. **Layer 4: Conversation Rhythm**：基于历史时间戳建立短/中/长三桶实际回复延迟分布模型（`latency_model`），彻底废除伪造的固定 180 CPM。
5. **Layer 5: Emoji & Sticker Assets**：上下文绑定的离散表情与贴纸资产模型。
6. **Layer 6: World Model & Context Supplement**：区分对话内真实事实与外部补充设定（`--context`），具备严格溯源与实体关系网。
7. **Layer 7: Memory Seed**：L0（工作记忆）、L1（情景事件）、L2（语义事实）、L3（世界设定）分层初始化。

---

### 3. DSI 蒸馏相似度指数

DSI 由 4 维确定性统计指标与 1 维独立盲评综合加权计算：

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| 维度 | 权重 | 计算依据与定义 |
| :--- | :---: | :--- |
| **L (Lexical Similarity)** | 20% | 0.30 字符 1/2-gram 余弦 + 0.20 标点分布距离 + 0.20 词汇特征重叠 + 0.15 消息长度比 + 0.15 句子长度比 |
| **S (Structural Style)** | 20% | 特征分布相似度（表情增量、省略号、问号、感叹号、无标点结尾、长度分桶比、重复字率） |
| **B (Behavioral Similarity)** | 25% | 行为特征向量对齐度（调侃应对、情绪共情、反问追问、语气正规度），检测到 AI 伪装硬性扣至最低分 |
| **C (Contextual Consistency)**| 15% | 世界模型实体矛盾检测、事实否定矛盾检测与事实落地加分（无事实时归一化为 null） |
| **H (Independent Blind Judge)**| 20% | 双候选（Candidate A/B）随机盲测打乱，输出结构化 `reason_codes`、分项相似度与客观判定证据 |

#### 验收质量门槛 (Acceptance Quality Gate)：
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

### 4. 工程与安全加固

- **原生 SQLite 存储（Native SQLite ACID）**：彻底剔除冗余的磁盘 JSON 序列化，所有查询参数化直达 SQLite；提供 `CommitInteraction` 原子事务保障消息、时序记忆与调度事件一致性。
- **时序记忆版本控制（Temporal Versioning）**：事实更新时打上 `valid_to` 时间戳，完整记录事实变迁；多维加权检索 Top-K 防止 Prompt 膨胀：
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **会话切分与防泄漏（Leakage Guard）**：数据集按完整 Session 划分（Train 70% / Val 15% / Blind 15%）；引入 3-gram Jaccard 相似度去重（阈值 0.90 自动拦截剔除）。
- **Runtime 候选评判管线**：A/B/C 三候选生成 $\to$ Style Critic 评分选优 $\to$ `sanitizeOutput` 安全守卫；废除写死 0.88 分。
- **Telegram 并发与安全**：基于 `chat_id` 建立会话专属 Channel 保证时序严格递增；用户 ID 使用 HMAC-SHA256 盐值哈希脱敏，日志不存明文 ID。
- **Zip Slip 路径遍历防护**：`.eidolon` 安装与校验严格进行解压路径边界拦截，防范目录穿越攻击。
- **工件与提示词版本化**：外置提示词模版（`cli/distillation/prompts/`），导出包自带 `reproducibility.json` 可复现元数据。

---

### 5. 快速开始

```bash
# 1. 安装与初始化
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link
eidolon init

# 2. 配置与握手测试
eidolon config test
eidolon bot token set <YOUR_BOT_TOKEN>

# 3. 运行对话蒸馏
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. 验证包合规性（Schema Validation）
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. 构建并启动服务
npm run build:server && eidolon service start
```

---

### 6. CLI 命令完整索引

| 命令 | 说明 |
| :--- | :--- |
| `eidolon init` | 初始化本地运行环境与 SQLite 数据库 |
| `eidolon config [show\|set\|test]` | 查看、修改配置或进行 LLM 握手测试 |
| `eidolon distill <file> [options]` | 执行对话摄取、7 层特征蒸馏与离线盲评 |
| `eidolon evaluate <persona>` | 对指定人格执行离线评测与 DSI 指标计算 |
| `eidolon validate <path>` | 校验 `.eidolon` 安装包或目录的 JSON Schema 合规性 |
| `eidolon persona [list\|activate\|install\|verify]` | 查看、激活、安全安装或验证人格包 |
| `eidolon memory [status\|compact\|export]` | 查看各层记忆统计、压缩过期事实或导出全量记忆 |
| `eidolon bot [token\|user\|status]` | 管理 Telegram Token 与授权用户白名单 |
| `eidolon service [start\|stop\|restart\|status]` | 控制 Go 服务端常驻守护进程 |
| `eidolon logs [-n lines]` | 查看守护进程实时运行日志 |
| `eidolon status` | 查看整体系统子系统与运行状态 |

[↑ 返回顶部 / Back to Top](#eidolon-v110)

---

# 🇺🇸 English

### 1. Project Redefinition

EIDOLON is no longer defined as simply "summarizing chat logs into a system prompt".

**V1.1 Official Definition:**
> **«Distill computable linguistic, behavioral, rhythmic, contextual, and memory features from authentic historical conversations, and rigorously verify the stylistic consistency and factual fidelity of generated responses against historical holdouts via offline evaluation benchmarks.»**

EIDOLON operates on two strictly decoupled closed loops:

```text
DISTILLATION LOOP:
Historical Chat ──▶ Ingestion ──▶ Multi-Layer Distillation ──▶ Persona Runtime Package (.eidolon)

EVALUATION LOOP:
Blind Test Dataset ──▶ Candidate Generation ──▶ Pairwise Blind Judge ──▶ DSI Score ──▶ Optimization
```

A persona is only deemed **Distillation Complete** when both loops execute and pass the rigorous Quality Gate.

---

### 2. Core Architecture & 7 Distillation Layers

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              EIDOLON CLI                               │
├────────────────────────────────────────────────────────────────────────┤
│    Ingestion    │          Distillation          │      Evaluation     │
├────────────────────────────────────────────────────────────────────────┤
│ Language (L1)   │ Style (L2) │ Behavior (L3)     │ Rhythm Latency (L4) │
│ Assets (L5)     │ World (L6) │ Memory Seed (L7)  │ Reproducibility     │
├────────────────────────────────────────────────────────────────────────┤
│                  Memory Engine (L0-L3 Temporal Store)                  │
├────────────────────────────────────────────────────────────────────────┤
│                  Native SQLite Storage & ACID Engine                   │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram Runtime (Serial Queue) │ HTTP API │ GSAP Web Dashboard        │
└────────────────────────────────────────────────────────────────────────┘
```

#### The 7 Distillation Layers:
1. **Layer 1: Language Fingerprint**: Statistical distributions of message & sentence lengths (median, P90, std-dev), Chinese modal/tone particles (`啊/呀/呢/嘛/吧`), character repetition patterns (`哈哈哈/啊啊啊`), message structures (single-line, multi-line, bulleted), terminal punctuation drop rates, and vocabulary profile rankings (never injected as mandatory prompt constraints).
2. **Layer 2: Conditional Style**: Bayesian smoothing (Beta-Binomial with $\alpha=1, \beta=1$) calculating $P(\text{feature} \mid \text{context})$ with explicit sample size and confidence scores.
3. **Layer 3: Response Behavior**: Data-driven situational response matrix (banter, empathy, explanation, farewell) derived from observed stats + LLM summarization without generic fallback templates.
4. **Layer 4: Conversation Rhythm**: Observed response latency model (`latency_model`) bucketed by message length (short, medium, long) with Gaussian jitter; completely eliminating fabricated 180 CPM.
5. **Layer 5: Emoji & Sticker Assets**: Context-bound discrete asset models mapped to conversational sentiments.
6. **Layer 6: World Model & Context Supplement**: Strict provenance separating conversational ground truth from external background files (`--context`).
7. **Layer 7: Memory Seed**: 4-layer memory initialization across L0 (working), L1 (episodes), L2 (semantic facts), and L3 (world state).

---

### 3. Distillation Similarity Index (DSI)

DSI is calculated as a weighted composite of 4 deterministic dimensions and 1 independent blind judge:

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| Dimension | Weight | Mathematical Definition & Basis |
| :--- | :---: | :--- |
| **L (Lexical Similarity)** | 20% | $0.30 \times \text{ngram cosine} + 0.20 \times \text{punct dist} + 0.20 \times \text{vocab overlap} + 0.15 \times \text{msg len ratio} + 0.15 \times \text{sent len ratio}$ |
| **S (Structural Style)** | 20% | Feature distribution similarity (emoji delta, ellipsis, question marks, exclamations, clean terminal drop, length bucket, repetition) |
| **B (Behavioral Similarity)** | 25% | Behavioral feature vector distance across key situations; immediate catastrophic penalty for AI identity leak |
| **C (Contextual Consistency)**| 15% | World model entity contradiction checking, fact negation violation detection, and entity grounding bonus |
| **H (Independent Blind Judge)**| 20% | Randomized A/B candidate assignment, structured `reason_codes`, sub-dimension similarities, and blind qualitative scoring |

#### Acceptance Quality Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

### 4. Engineering & Security Hardening

- **Native SQLite Persistence**: Eliminated redundant disk JSON serialization. Parameterized SQL queries execute directly against SQLite; `CommitInteraction` provides atomic ACID transactions across messages, memories, and scheduler events.
- **Temporal Memory Versioning**: Updates supersede facts with `valid_to` timestamps, preserving complete historical fact evolutions. Multi-factor Top-K retrieval prevents prompt flooding:
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **Session-based Split & Leakage Guard**: Evaluation sets partition by entire conversation sessions (Train 70% / Val 15% / Blind 15%). Cross-split 3-gram Jaccard similarity $> 0.90$ triggers automatic rejection and leakage reporting.
- **Runtime Candidate Pipeline**: Generates Candidate A/B/C $\to$ Style Critic scoring $\to$ `sanitizeOutput` safety guardrail; removed fixed 0.88 critic scores.
- **Telegram Concurrency & Privacy**: Per-chat dedicated serial channel queues guarantee strict sequential message and memory ordering; user IDs are masked in logs via HMAC-SHA256 salted hashes.
- **Zip Slip Defense**: Path normalization and containment checks prevent directory traversal during `.eidolon` bundle extraction.
- **Reproducibility & Prompts**: Distillation prompts externalized in `cli/distillation/prompts/`; bundles include `reproducibility.json` with commit, model, seed, and data hashes.

---

### 5. Quick Start

```bash
# 1. Install and initialize
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link
eidolon init

# 2. Test configuration and LLM connectivity
eidolon config test
eidolon bot token set <YOUR_BOT_TOKEN>

# 3. Run distillation pipeline
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. Validate package against formal JSON schemas
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. Build and launch daemon runtime service
npm run build:server && eidolon service start
```

---

### 6. CLI Command Reference

| Command | Description |
| :--- | :--- |
| `eidolon init` | Initialize environment, SQLite databases, and workspace directories |
| `eidolon config [show\|set\|test]` | Inspect, modify configuration, or test LLM endpoint connectivity |
| `eidolon distill <file> [options]` | Execute dialogue ingestion, 7-layer distillation, and offline blind evaluation |
| `eidolon evaluate <persona>` | Run offline benchmark evaluations and compute DSI metrics |
| `eidolon validate <path>` | Validate `.eidolon` archive or directory against all 6 JSON schemas |
| `eidolon persona [list\|activate\|install\|verify]` | List, activate, securely install, or verify persona bundles |
| `eidolon memory [status\|compact\|export]` | Inspect layer counts, prune expired facts, or export persistent memory |
| `eidolon bot [token\|user\|status]` | Manage Telegram Bot token and user allowlist |
| `eidolon service [start\|stop\|restart\|status]` | Control persistent Go background daemon service |
| `eidolon logs [-n lines]` | Inspect live runtime daemon logs |
| `eidolon status` | Display full runtime status across all subsystems |

[↑ 返回顶部 / Back to Top](#eidolon-v110)

---

# 🇯🇵 日本語

### 1. プロジェクトの再定義

EIDOLON はもはや単なる「チャット履歴を要約してプロンプトにするツール」ではありません。

**V1.1 における正式な定義：**
> **«過去の実際の対話履歴から計算可能な言語・行動・リズム・文脈・記憶の特徴を蒸留し、オフライン評価用データセットを用いて生成結果と過去サンプル間のスタイル一貫性および事実忠実度を厳格に検証する。»**

EIDOLON は2つの完全に独立したクローズドループを備えています：

```text
蒸留ループ (DISTILLATION LOOP):
対話履歴 ──▶ 取り込み ──▶ 多層蒸留パイプライン ──▶ ペルソナ実行可能パッケージ (.eidolon)

評価ループ (EVALUATION LOOP):
ブラインドテストデータ ──▶ 候補生成 ──▶ ペアワイズ・ブラインド評価 ──▶ DSIスコア ──▶ 最適化
```

両方のループが正常に実行され、品質ゲート（Quality Gate）をクリアして初めて、真の **Distillation Complete（蒸留完了）** と判定されます。

---

### 2. コアアーキテクチャと7層蒸留レイヤー

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              EIDOLON CLI                               │
├────────────────────────────────────────────────────────────────────────┤
│    取り込み (Ingestion)    │    蒸留 (Distillation)   │    評価 (Evaluation)   │
├────────────────────────────────────────────────────────────────────────┤
│ 言語指紋 (L1)   │ スタイル (L2) │ 行動モデル (L3)    │ リズム・遅延 (L4)  │
│ アセット (L5)   │ 世界観 (L6)   │ 記憶シード (L7)    │ 再現性メタデータ   │
├────────────────────────────────────────────────────────────────────────┤
│                    記憶エンジン (L0〜L3 時系列永続化)                  │
├────────────────────────────────────────────────────────────────────────┤
│                    ネイティブ SQLite ストレージ＆ACID                  │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram ランタイム (直列キュー) │ HTTP API │ GSAP Web ダッシュボード │
└────────────────────────────────────────────────────────────────────────┘
```

#### 7層の特徴蒸留レイヤー：
1. **Layer 1: 言語指紋 (Language Fingerprint)**: メッセージ長および文長の統計分布（中央値、P90、標準偏差）、日本語・中国語の終助詞・語気詞（ね/よ/わ/啊/呀等）、文字の連続繰り返しパターン（www/笑/哈哈哈）、メッセージ構造（単行/複数行/箇条書き）、句読点の省略傾向、Top語彙プロファイル（過学習防止のため強制プロンプト拘束にはしない）。
2. **Layer 2: 条件付きスタイル (Conditional Style)**: ベータ二項ベイズ平滑化（$\alpha=1, \beta=1$）に基づく $P(\text{feature} \mid \text{context})$ の学習。サンプルサイズと信頼度を保持。
3. **Layer 3: 応答行動 (Response Behavior)**: からかいへの返し、共感・慰め、説明要求への対応など、統計特徴量とLLMの純粋な要約によって抽出される行動ポリシー行列（固定AIテンプレートを排除）。
4. **Layer 4: 会話リズム (Conversation Rhythm)**: メッセージ長（短・中・長）ごとの応答遅延分布モデル（`latency_model`）とガウスジッターを算出。架空の固定180 CPMを完全撤廃。
5. **Layer 5: 絵文字・スタンプ (Emoji & Sticker Assets)**: 感情や文脈に紐付いたアセットモデル。
6. **Layer 6: 世界観モデル (World Model & Context)**: 会話内の客観的事実と外部補足背景（`--context`）を厳格に分離・検証。
7. **Layer 7: 記憶シード (Memory Seed)**: L0（作業記憶）、L1（エピソード記憶）、L2（意味事実）、L3（世界設定）の初期化。

---

### 3. 蒸留類似度指数 (DSI)

DSI は 4 つの決定論的統計指標と 1 つの独立ブラインド評価の重み付け統合によって算出されます：

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| 次元 | 重み | 計算基準と定義 |
| :--- | :---: | :--- |
| **L (語彙類似度)** | 20% | 0.30 文字 1/2-gram コサイン ＋ 0.20 句読点分布距離 ＋ 0.20 語彙適合度 ＋ 0.15 メッセージ長比 ＋ 0.15 文長比 |
| **S (構造スタイル類似度)** | 20% | 特徴量分布類似度（絵文字差分、三点リーダー、疑問符、感嘆符、文末句点省略、長さバケット、繰り返し率） |
| **B (行動類似度)** | 25% | からかい対応、共感対応、逆質問等の特徴量アライメント。AI特有の定型謝罪・自己開示検知時は最低点へ減点 |
| **C (文脈一貫性)** | 15% | 世界観エンティティ矛盾検知、事実否定違反検知、事実グラウンディング加点（検証事実不在時は null 正規化） |
| **H (独立ブラインド評価)** | 20% | 候補A/Bの完全ブラインドシャッフル評価、構造化 `reason_codes`、観点別類似度判定 |

#### 品質合格基準 (Quality Gate):
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

### 4. エンジニアリングとセキュリティ強化

- **ネイティブ SQLite ACID ストレージ**: 冗長なディスク JSON シリアライズを完全排除し、全クエリを直接 SQLite へパラメータ化実行。`CommitInteraction` によるメッセージ・時系列記憶・スケジューライベントのアトミックな一括トランザクションを実現。
- **時系列記憶バージョン管理 (Temporal Versioning)**: 事実更新時に `valid_to` タイムスタンプを付与し、歴史的事実の変遷を完全保持。多要素加重スコアリングによる Top-K 抽出でプロンプト肥大化を防止：
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **セッション単位分割と漏洩防御**: データセットを会話セッション単位で分割（Train 70% / Val 15% / Blind 15%）。3-gram Jaccard 類似度 0.90 以上の近傍重複を自動検知・排除。
- **Runtime 候補評価パイプライン**: 候補A/B/C 生成 $\to$ Style Critic 採点選別 $\to$ `sanitizeOutput` 安全ガードレール。
- **Telegram 並行処理とプライバシー保護**: `chat_id` ごとの専用直列チャンネルにより発言順序を完全保証。監査ログのユーザーIDは HMAC-SHA256 ソルトハッシュでマスキング。
- **Zip Slip パストラバーサル対策**: `.eidolon` パッケージの展開時にパスの正規化と境界検査を実施し、ディレクトリ横断攻撃を防御。
- **プロンプトと成果物のバージョン管理**: プロンプトを外部テンプレート化（`cli/distillation/prompts/`）。パッケージには commit・モデル・seed・データハッシュを記録した `reproducibility.json` を同梱。

---

### 5. クイックスタート

```bash
# 1. インストールと初期化
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link
eidolon init

# 2. 設定と接続テスト
eidolon config test
eidolon bot token set <YOUR_BOT_TOKEN>

# 3. 対話の蒸留を実行
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. パッケージのスキーマ検証 (Schema Validation)
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. サーバーのビルドと起動
npm run build:server && eidolon service start
```

---

### 6. CLI コマンドリファレンス

| コマンド | 説明 |
| :--- | :--- |
| `eidolon init` | 実行環境とローカル SQLite データベースの初期化 |
| `eidolon config [show\|set\|test]` | 設定の確認・変更、LLM 接続テスト |
| `eidolon distill <file> [options]` | 対話取り込み、7層特徴蒸留、オフライン評価の実行 |
| `eidolon evaluate <persona>` | 指定ペルソナのオフライン評価と DSI スコア算出 |
| `eidolon validate <path>` | `.eidolon` アーカイブまたはディレクトリの JSON スキーマ検証 |
| `eidolon persona [list\|activate\|install\|verify]` | ペルソナ一覧表示、アクティブ化、安全なインストール、整合性検証 |
| `eidolon memory [status\|compact\|export]` | 記憶統計の確認、期限切れ記憶の圧縮、全量エクスポート |
| `eidolon bot [token\|user\|status]` | Telegram Bot トークンおよび許可ユーザーの管理 |
| `eidolon service [start\|stop\|restart\|status]` | Go 言語常駐デーモンサービスの管理 |
| `eidolon logs [-n lines]` | デーモンのリアルタイムログの閲覧 |
| `eidolon status` | システム全体のステータス確認 |

[↑ 返回顶部 / Back to Top](#eidolon-v110)

---

## 8. License

GNU General Public License v3.0 (GPL-3.0). 詳細については [LICENSE](LICENSE) を参照してください。
