# EIDOLON v1.2.1

<p align="center">
  <strong>Persona Distillation, L4 Relationship & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity. Simulate authentic presence.»</em>
</p>

<p align="center">
  <a href="#-简体中文"><strong>🇨🇳 简体中文</strong></a> •
  <a href="#-english"><strong>🇺🇸 English</strong></a> •
  <a href="#-日本語"><strong>🇯🇵 日本語</strong></a> •
  <a href="README_en.md"><strong>[ English File ]</strong></a> •
  <a href="README_ja.md"><strong>[ 日本語ファイル ]</strong></a> •
  <a href="docs/human-simulation-algorithm.md"><strong>📐 算法规范 (Algorithm Spec)</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.2.1%20(Formal)-blue.svg" alt="Release: v1.2.1 (Formal)">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/SQLite-Native%20ACID-003B57.svg" alt="SQLite: Native ACID">
  <img src="https://img.shields.io/badge/L4%20State-BSM%20Engine-ff69b4.svg" alt="L4 State: BSM Engine">
  <img src="https://img.shields.io/badge/Tests-38%20Passed-brightgreen.svg" alt="Tests: 38 Passed">
</p>

---

## 快速跳转 / Quick Navigation / クイックナビゲーション

- [🇨🇳 简体中文](#-简体中文)
  - [1. 项目重新定义](#1-项目重新定义)
  - [2. 核心架构与 7 层蒸馏](#2-核心架构与-7-层蒸馏)
  - [3. DSI 蒸馏相似度指数](#3-dsi-蒸馏相似度指数)
  - [4. L4 动态关系状态与真人模拟算法](#4-l4-动态关系状态与真人模拟算法)
  - [5. 工程与安全加固](#5-工程与安全加固)
  - [6. 快速开始与首次部署引导](#6-快速开始与首次部署引导)
  - [7. CLI 命令完整索引](#7-cli-命令完整索引)
- [🇺🇸 English](#-english)
  - [1. Project Redefinition](#1-project-redefinition)
  - [2. Core Architecture & 7 Distillation Layers](#2-core-architecture--7-distillation-layers)
  - [3. Distillation Similarity Index (DSI)](#3-distillation-similarity-index-dsi)
  - [4. L4 Dynamic Relationship State & Human Simulation](#4-l4-dynamic-relationship-state--human-simulation)
  - [5. Engineering & Security Hardening](#5-engineering--security-hardening)
  - [6. Quick Start & Onboarding Wizard](#6-quick-start--onboarding-wizard)
  - [7. CLI Command Reference](#7-cli-command-reference)
- [🇯🇵 日本語](#-日本語)
  - [1. プロジェクトの再定義](#1-プロジェクトの再定義)
  - [2. コアアーキテクチャと7層蒸留レイヤー](#2-コアアーキテクチャと7層蒸留レイヤー)
  - [3. 蒸留類似度指数 (DSI)](#3-蒸留類似度指数-dsi)
  - [4. L4動的関係状態と人間行動シミュレーション](#4-l4動的関係状態と人間行動シミュレーション)
  - [5. エンジニアリングとセキュリティ強化](#5-エンジニアリングとセキュリティ強化)
  - [6. クイックスタートと初期導入ウィザード](#6-クイックスタートと初期導入ウィザード)
  - [7. CLI コマンドリファレンス](#7-cli-コマンドリファレンス)

---

# 🇨🇳 简体中文

### 1. 项目重新定义

EIDOLON 不再定义为简单的“把聊天记录总结成一个 Prompt”。

**V1.2 正式定义为：**
> **«从历史真实对话中蒸馏出可计算的语言、行为、节奏、上下文与记忆特征，依托 L4 连续关系状态与情绪动力学引擎，通过离线评测集严格验证生成结果与历史样本之间的风格一致性与事实保真度，并在运行时提供高拟真的仿生陪伴交互体验。»**

EIDOLON 包含两个完全解耦的闭环：

```text
DISTILLATION LOOP:
历史对话语料 ──▶ Ingestion 摄取 ──▶ 多层特征蒸馏 ──▶ 人格可执行包 (.eidolon)

EVALUATION LOOP:
隔离盲测集 ──▶ 候选生成 (A/B/C) ──▶ 双盲对决裁判 ──▶ DSI 评分 ──▶ 优化迭代
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
│                  L4 Dynamic Relationship & Emotion Engine              │
├────────────────────────────────────────────────────────────────────────┤
│                  Memory Engine (L0-L3 Temporal Store)                  │
├────────────────────────────────────────────────────────────────────────┤
│                  Native SQLite Storage & ACID Engine                   │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram Runtime (Serial Queue) │ HTTP API │ GSAP Web Dashboard        │
└────────────────────────────────────────────────────────────────────────┘
```

#### 7 层特征蒸馏层级：
1. **Layer 1: Language Fingerprint**：字符/句子长度分布（中位数、P90、方差）、语气虚词（啊/呀/呢/嘛/吧等）、字词重复模式（哈哈哈/啊啊啊）、消息结构（单行/多行/列表）、标点脱落习惯、Top 词汇特征轮廓（不作为强制硬约束以防过拟合）。
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

### 4. L4 动态关系状态与真人模拟算法

> 详见完整数学推导与技术规范文档：[docs/human-simulation-algorithm.md](docs/human-simulation-algorithm.md)

EIDOLON 将 Telegram 回复层全面升级为**状态驱动的行为模拟器 (State-Driven Behavioral Simulator)**：

1. **L4 连续 8 维关系状态向量**：
   - 包含：`intimacy` (亲密), `affection` (喜爱), `trust` (信任), `attachment` (依恋), `discord` (分歧), `boundary` (心理边界), `openness` (开放度), `dominance` (主导倾向)。
   - 配套 8 维连续情绪动力学（愤怒、烦躁、依恋、悲伤、快乐、害羞、孤独、兴奋）。
2. **阻尼状态转移方程与时间衰减**：
   - 状态转移：$\mathbf{S}_{t+1} = \lambda \mathbf{S}_t + (1 - \lambda) \Delta \mathbf{S}_{\text{stimulus}} + \mathbf{R}_{\text{apology}}$，惯性系数 $\lambda = 0.88$ 保证情绪真实连续渐变。
   - 自然时间衰减：烦躁恢复半衰期 $\tau=6h$、情感伤害恢复 $\tau=24h$、紧张恢复 $\tau=4h$。
3. **道歉与和解数学模型**：
   - 识别真诚道歉强度 $A$ 后按对数饱和函数执行阶段性和解，绝不瞬时原谅；
   - 行为状态机经由 `CONFLICT -> RECOVERING -> DISTANT -> WARM -> NORMAL` 平滑回暖。
4. **多因子对数正态交互延时与消息断句**：
   - 延迟分布：$\tau = \text{Lognormal}(\mu, \sigma) \times M_{\text{length}} \times M_{\text{rapid}} \times M_{\text{cold}}$；
   - 先进入思考期（无输入状态），打字期持续超过 5 秒时自动以 4 秒间隔刷新保活；
   - 消息分裂调度：优先在句末标点（换行、句号、感叹号、问号、波浪号）自然断开，两句之间插入 1.2 秒自然打字间隔。
5. **撤回与“先发后悔”行为链**：
   - 依据冲动度与信任度计算 $P(\text{delete}) = \sigma(z)$，触发后等待 $1.5s \sim 2.5s$ 自动调用 Telegram `deleteMessage` 撤回并跟帖解释。
6. **Telegram `/start` 启动配对命令**：
   - 用户发送 `/start` 时，机器人瞬间将其 Telegram ID 加入白名单并持久化写入 `config.json`；
   - 自动调用 `deleteMessage` 物理删除用户发送的 `/start` 消息；
   - **无其他多余**：静默完成配对，不发送任何冗余欢迎文本；后续消息（如 `123`）直接获得真人拟人回复。

---

### 5. 工程与安全加固

- **原生 SQLite 存储（Native SQLite ACID）**：彻底剔除冗余的磁盘 JSON 序列化，所有查询参数化直达 SQLite；提供 `CommitInteraction` 原子事务保障消息、时序记忆与调度事件一致性。
- **时序记忆版本控制（Temporal Versioning）**：事实更新时打上 `valid_to` 时间戳，完整记录事实变迁；多维加权检索 Top-K 防止 Prompt 膨胀：
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **会话切分与防泄漏（Leakage Guard）**：数据集按完整 Session 划分（Train 70% / Val 15% / Blind 15%）；引入 3-gram Jaccard 相似度去重（阈值 0.90 自动拦截剔除）。
- **Runtime 候选评判管线**：A/B/C 三候选生成 $\to$ Style Critic 评分选优 $\to$ `sanitizeOutput` 安全守卫，清除 AI 套话并回退到自然口语，绝不向用户泄露 `[sanitized]` 标签。
- **Telegram 并发与安全**：基于 `chat_id` 建立会话专属 Channel 保证时序严格递增；用户 ID 使用 HMAC-SHA256 盐值哈希脱敏，日志不存明文 ID。
- **Zip Slip 路径遍历防护**：`.eidolon` 安装与校验严格进行解压路径边界拦截，防范目录穿越攻击。
- **工件与提示词版本化**：外置提示词模版（`cli/distillation/prompts/`），导出包自带 `reproducibility.json` 可复现元数据。

---

### 6. 快速开始与首次部署引导

```bash
# 1. 安装项目
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link

# 2. 运行首次交互式引导（先不启动机器人）
eidolon init
# 引导程序将依次带您完成：
# - 模型 API 连接与 Simple-Test 验证
# - 指定语料路径与大环境/世界观背景追问录入
# - 绑定 Telegram Bot Token 与录入用户 ID
# - 启动机器人并指引发送 /start 完成静默鉴权配对

# 3. 运行对话蒸馏（支持 Telegram 实时进度汇报与 All-Clear 清理）
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. 验证包合规性（Schema Validation）
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. 启动后台常驻守护进程
npm run build:server && eidolon service start
```

---

### 7. CLI 命令完整索引

| 命令 | 说明 |
| :--- | :--- |
| `eidolon init` | 启动交互式引导程序，初始化环境、配置与 SQLite 数据库 |
| `eidolon config [show\|set\|test]` | 查看、修改配置或进行 LLM 连通性 Simple-Test |
| `eidolon distill <file> [options]` | 执行对话摄取、7 层特征蒸馏、Telegram 进度推送与离线评测 |
| `eidolon evaluate <persona>` | 对指定人格执行离线评测与 DSI 指标计算 |
| `eidolon validate <path>` | 校验 `.eidolon` 安装包或目录的 JSON Schema 合规性 |
| `eidolon persona [list\|activate\|install\|verify]` | 查看、激活、安全安装或验证人格包 |
| `eidolon memory [status\|compact\|export]` | 查看各层记忆统计、压缩过期事实或导出全量记忆 |
| `eidolon bot [token\|user\|status]` | 管理 Telegram Token 与授权用户白名单 |
| `eidolon service [start\|stop\|restart\|status]` | 控制 Go 服务端常驻守护进程 |
| `eidolon logs [-n lines]` | 查看守护进程实时运行日志 |
| `eidolon status` | 查看整体系统子系统与运行状态 |

[↑ 返回顶部 / Back to Top](#eidolon-v121)

---

# 🇺🇸 English

### 1. Project Redefinition

EIDOLON is no longer defined as simply "summarizing chat logs into a system prompt".

**V1.2 Official Definition:**
> **«Distill computable linguistic, behavioral, rhythmic, contextual, and memory features from authentic historical conversations, driven by an L4 dynamic relationship and emotion engine, rigorously verified against offline evaluation holdouts for stylistic consistency and factual fidelity, and delivering lifelike biometric companion presence in live interaction.»**

EIDOLON operates on two strictly decoupled closed loops:

```text
DISTILLATION LOOP:
Historical Chat ──▶ Ingestion ──▶ Multi-Layer Distillation ──▶ Persona Runtime Package (.eidolon)

EVALUATION LOOP:
Isolated Blind Holdout ──▶ Candidate Gen (A/B/C) ──▶ Pairwise Blind Judge ──▶ DSI Score ──▶ Optimization
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
│                  L4 Dynamic Relationship & Emotion Engine              │
├────────────────────────────────────────────────────────────────────────┤
│                  Memory Engine (L0-L3 Temporal Store)                  │
├────────────────────────────────────────────────────────────────────────┤
│                  Native SQLite Storage & ACID Engine                   │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram Runtime (Serial Queue) │ HTTP API │ GSAP Web Dashboard        │
└────────────────────────────────────────────────────────────────────────┘
```

#### The 7 Distillation Layers:
1. **Layer 1: Language Fingerprint**: Statistical distributions of message & sentence lengths (median, P90, std-dev), modal tone particles, character repetition patterns, message structures, terminal punctuation drop rates, and vocabulary profile rankings.
2. **Layer 2: Conditional Style**: Bayesian smoothing (Beta-Binomial with $\alpha=1, \beta=1$) calculating $P(\text{feature} \mid \text{context})$ with explicit sample size and confidence scores.
3. **Layer 3: Response Behavior**: Data-driven situational response matrix (banter, empathy, explanation, farewell) derived from observed statistics without generic assistant fallback templates.
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
| **B (Behavioral Similarity)** | 25% | Behavioral feature vector distance across key situations; immediate catastrophic penalty for AI identity leaks |
| **C (Contextual Consistency)**| 15% | World model entity contradiction checking, fact negation violation detection, and entity grounding bonus |
| **H (Independent Blind Judge)**| 20% | Randomized A/B candidate assignment, structured `reason_codes`, sub-dimension similarities, and blind qualitative scoring |

#### Acceptance Quality Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

### 4. L4 Dynamic Relationship State & Human Simulation

> Detailed mathematical derivation: [docs/human-simulation-algorithm.md](docs/human-simulation-algorithm.md)

1. **Continuous 8D Relationship State Vector**:
   - `intimacy`, `affection`, `trust`, `attachment`, `discord`, `boundary`, `openness`, `dominance`.
   - Accompanied by 8D continuous emotion dynamics (anger, irritation, attachment, sadness, joy, shyness, loneliness, excitement).
2. **Damped State Transition & Time Decay**:
   - State transition: $\mathbf{S}_{t+1} = \lambda \mathbf{S}_t + (1 - \lambda) \Delta \mathbf{S}_{\text{stimulus}} + \mathbf{R}_{\text{apology}}$ with inertia $\lambda = 0.88$.
   - Natural exponential decay: irritation $\tau=6h$, emotional hurt $\tau=24h$, tension $\tau=4h$.
3. **Apology & Reconciliation Model**:
   - Logarithmic saturation reconciliation based on sincere apology strength $A$;
   - Behavioral State Machine warms smoothly: `CONFLICT -> RECOVERING -> DISTANT -> WARM -> NORMAL`.
4. **Multi-Factor Log-Normal Interactive Latency & Splitting**:
   - Latency distribution: $\tau = \text{Lognormal}(\mu, \sigma) \times M_{\text{length}} \times M_{\text{rapid}} \times M_{\text{cold}}$;
   - Reading/thinking phase (no typing status), followed by typing state refreshed every 4 seconds for long replies;
   - Natural sentence splitting at delimiters (`\n`, `。`, `！`, `!`, `？`, `?`, `~`) with a 1.2s inter-message typing pause.
5. **Sigmoidal Retraction & Post-Send Regret Chain**:
   - Computes $P(\text{delete}) = \sigma(z)$; upon trigger, sleeps 1.5s~2.5s and calls Telegram `deleteMessage` to simulate human impulse retraction.
6. **Telegram `/start` Startup Pairing**:
   - Immediately adds user ID into allowlist and persists to `config.json`;
   - Automatically deletes the incoming `/start` command message;
   - **Zero redundant clutter**: strictly silent pairing; subsequent messages (e.g. `123`) receive natural companion responses.

---

### 5. Engineering & Security Hardening

- **Native SQLite Persistence**: Parameterized queries execute directly against SQLite; `CommitInteraction` provides atomic ACID transactions across messages, memories, and scheduler events.
- **Temporal Memory Versioning**: Updates supersede facts with `valid_to` timestamps, preserving complete historical fact evolutions. Multi-factor Top-K retrieval prevents prompt flooding:
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **Session-based Split & Leakage Guard**: Evaluation sets partition by entire conversation sessions (Train 70% / Val 15% / Blind 15%). Cross-split 3-gram Jaccard similarity $> 0.90$ triggers automatic rejection.
- **Runtime Candidate Pipeline**: Generates Candidate A/B/C $\to$ Style Critic scoring $\to$ `sanitizeOutput` safety guardrail, stripping AI boilerplate and never leaking `[sanitized]` tokens.
- **Telegram Concurrency & Privacy**: Dedicated serial channel queues per chat guarantee message ordering; user IDs are masked in logs via HMAC-SHA256 salted hashes.
- **Zip Slip Defense**: Path normalization and containment checks prevent directory traversal during `.eidolon` bundle extraction.
- **Reproducibility & Prompts**: Distillation prompts externalized in `cli/distillation/prompts/`; bundles include `reproducibility.json` with commit, model, seed, and data hashes.

---

### 6. Quick Start & Onboarding Wizard

```bash
# 1. Install and initialize
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link

# 2. Run interactive onboarding wizard (bot stays silent initially)
eidolon init
# The wizard guides you through:
# - Model API configuration and live simple-test verification
# - Chat history file path input & supplementary context/worldline inquiry
# - Telegram Bot Token binding & User ID registration
# - Starting daemon and sending /start for silent pairing

# 3. Run distillation (with live Telegram progress updates & all-clear sweep)
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. Validate package against formal JSON schemas
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. Launch background daemon runtime service
npm run build:server && eidolon service start
```

---

### 7. CLI Command Reference

| Command | Description |
| :--- | :--- |
| `eidolon init` | Launch interactive onboarding wizard, configure environment, and init SQLite |
| `eidolon config [show\|set\|test]` | Inspect, modify configuration, or test LLM endpoint connectivity |
| `eidolon distill <file> [options]` | Execute dialogue ingestion, 7-layer distillation, Telegram progress, and evaluation |
| `eidolon evaluate <persona>` | Run offline benchmark evaluations and compute DSI metrics |
| `eidolon validate <path>` | Validate `.eidolon` archive or directory against all 6 JSON schemas |
| `eidolon persona [list\|activate\|install\|verify]` | List, activate, securely install, or verify persona bundles |
| `eidolon memory [status\|compact\|export]` | Inspect layer counts, prune expired facts, or export persistent memory |
| `eidolon bot [token\|user\|status]` | Manage Telegram Bot token and user allowlist |
| `eidolon service [start\|stop\|restart\|status]` | Control persistent Go background daemon service |
| `eidolon logs [-n lines]` | Inspect live runtime daemon logs |
| `eidolon status` | Display full runtime status across all subsystems |

[↑ 返回顶部 / Back to Top](#eidolon-v121)

---

# 🇯🇵 日本語

### 1. プロジェクトの再定義

EIDOLON はもはや単なる「チャット履歴を要約してプロンプトにするツール」ではありません。

**V1.2 における正式な定義：**
> **«過去の実際の対話履歴から計算可能な言語・行動・リズム・文脈・記憶の特徴を蒸留し、L4 動的関係状態と感情力学エンジンを通じて、オフライン評価用データセットを用いて生成結果と過去サンプル間のスタイル一貫性および事実忠実度を厳格に検証し、極めて自然な生体感覚のコンパニオン体験を提供する。»**

EIDOLON は2つの完全に独立したクローズドループを備えています：

```text
蒸留ループ (DISTILLATION LOOP):
対話履歴 ──▶ 取り込み ──▶ 多層蒸留パイプライン ──▶ ペルソナ実行可能パッケージ (.eidolon)

評価ループ (EVALUATION LOOP):
独立ブラインドデータ ──▶ 候補生成 (A/B/C) ──▶ ペアワイズ・ブラインド評価 ──▶ DSIスコア ──▶ 最適化
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
│               L4 動的関係状態＆感情力学エンジン (Emotion Engine)       │
├────────────────────────────────────────────────────────────────────────┤
│                    記憶エンジン (L0〜L3 時系列永続化)                  │
├────────────────────────────────────────────────────────────────────────┤
│                    ネイティブ SQLite ストレージ＆ACID                  │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram ランタイム (直列キュー) │ HTTP API │ GSAP Web ダッシュボード │
└────────────────────────────────────────────────────────────────────────┘
```

#### 7層の特徴蒸留レイヤー：
1. **Layer 1: 言語指紋 (Language Fingerprint)**: メッセージ長および文長の統計分布（中央値、P90、標準偏差）、終助詞・語気詞（ね/よ/わ/啊/呀等）、文字の連続繰り返しパターン（www/笑/哈哈哈）、メッセージ構造、句読点の省略傾向、Top語彙プロファイル。
2. **Layer 2: 条件付きスタイル (Conditional Style)**: ベータ二項ベイズ平滑化（$\alpha=1, \beta=1$）に基づく $P(\text{feature} \mid \text{context})$ の学習。サンプルサイズと信頼度を保持。
3. **Layer 3: 応答行動 (Response Behavior)**: からかいへの返し、共感・慰め、説明要求への対応など、統計特徴量とLLMの純粋な要約によって抽出される行動ポリシー行列。
4. **Layer 4: 会話リズム (Conversation Rhythm)**: メッセージ長（短・中・長）ごとの応答遅延分布モデル（`latency_model`）とガウスジッターを算出。固定180 CPMを完全撤廃。
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

### 4. L4動的関係状態と人間行動シミュレーション

> 詳細な数学的仕様書：[docs/human-simulation-algorithm.md](docs/human-simulation-algorithm.md)

1. **L4 連続 8 次元関係状態ベクトル**:
   - `intimacy` (親密さ), `affection` (好意), `trust` (信頼), `attachment` (愛着), `discord` (不和), `boundary` (心理的境界), `openness` (開放度), `dominance` (主導性)。
   - 8次元連続感情力学（怒り、苛立ち、愛着、悲しみ、喜び、照れ、孤独、興奮）と連携。
2. **減衰状態遷移方程式と時間的減衰**:
   - 状態遷移：$\mathbf{S}_{t+1} = \lambda \mathbf{S}_t + (1 - \lambda) \Delta \mathbf{S}_{\text{stimulus}} + \mathbf{R}_{\text{apology}}$、慣性係数 $\lambda = 0.88$ により感情の自然な連続的変化を保証。
   - 時間減衰半減期：苛立ちの解消 $\tau=6h$、傷心からの回復 $\tau=24h$、緊張緩和 $\tau=4h$。
3. **謝罪と和解の数理モデル**:
   - 誠実な謝罪強度 $A$ に基づく対数飽和回復；
   - 行動状態機が `CONFLICT -> RECOVERING -> DISTANT -> WARM -> NORMAL` とスムーズに軟化移行。
4. **多要素対数正規インタラクティブ遅延とメッセージ分割**:
   - 遅延算出：$\tau = \text{Lognormal}(\mu, \sigma) \times M_{\text{length}} \times M_{\text{rapid}} \times M_{\text{cold}}$；
   - 読解・思考期（入力中アニメーション非表示）を経て、長文時は4秒周期でタイピング状態を維持；
   - 文末記号（改行、句点、感嘆符、疑問符、チルダ等）で自然に分割し、文間に1.2秒の自然な入力間隔を挿入。
5. **送信後後悔・取り消しシグモイドモデル**:
   - 衝動性と信頼度から $P(\text{delete}) = \sigma(z)$ を算出し、トリガー時は1.5〜2.5秒待機後に Telegram `deleteMessage` で自動送信取り消しを実行。
6. **Telegram `/start` 起動ペアリングコマンド**:
   - ユーザーが `/start` を送信すると、ロボットは即座にユーザーIDをホワイトリストへ登録し `config.json` へ永続化；
   - 送信された `/start` コマンドメッセージを Telegram 上から自動削除；
   - **完全な静黙ペアリング**：余計な定型文を送らず、その後の通常メッセージ（例：`123`）に対して直接自然な会話を開始。

---

### 5. エンジニアリングとセキュリティ強化

- **ネイティブ SQLite ACID ストレージ**: 冗長なディスク JSON シリアライズを完全排除し、全クエリを直接 SQLite へパラメータ化実行。`CommitInteraction` によるメッセージ・時系列記憶・スケジューライベントのアトミックな一括トランザクションを実現。
- **時系列記憶バージョン管理 (Temporal Versioning)**: 事実更新時に `valid_to` タイムスタンプを付与し、歴史的事実の変遷を完全保持。多要素加重スコアリングによる Top-K 抽出でプロンプト肥大化を防止。
- **セッション単位分割と漏洩防御**: データセットを会話セッション単位で分割（Train 70% / Val 15% / Blind 15%）。3-gram Jaccard 類似度 0.90 以上の近傍重複を自動検知・排除。
- **Runtime 候補評価パイプライン**: 候補A/B/C 生成 $\to$ Style Critic 採点選別 $\to$ `sanitizeOutput` 安全ガードレール（AI定型文を除去し、`[sanitized]` を漏洩させない）。
- **Telegram 並行処理とプライバシー保護**: `chat_id` ごとの専用直列チャンネルにより発言順序を完全保証。監査ログのユーザーIDは HMAC-SHA256 ソルトハッシュでマスキング。
- **Zip Slip パストラバーサル対策**: `.eidolon` パッケージの展開時にパスの正規化と境界検査を実施し、ディレクトリ横断攻撃を防御。
- **プロンプトと成果物のバージョン管理**: プロンプトを外部テンプレート化（`cli/distillation/prompts/`）。パッケージには commit・モデル・seed・データハッシュを記録した `reproducibility.json` を同梱。

---

### 6. クイックスタートと初期導入ウィザード

```bash
# 1. インストール
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon && npm install && npm link

# 2. インタラクティブ初期導入ウィザードの実行（ボットは最初起動しません）
eidolon init
# ウィザードの案内内容：
# - モデル API の接続設定と simple-test による応答検証
# - 対話履歴ファイルパスの入力と大環境・世界観の追加入力
# - Telegram Bot Token の接続とユーザー ID の登録
# - ボットを起動し /start を送信して静黙ペアリング完了

# 3. 対話の蒸留を実行（Telegram リアルタイム進捗通知＆完了時一括消去）
eidolon distill /path/to/chat.jsonl --target Alice --output ./completed_result

# 4. パッケージのスキーマ検証 (Schema Validation)
eidolon validate ./completed_result/persona_xxx.eidolon

# 5. 常駐デーモンサービスの起動
npm run build:server && eidolon service start
```

---

### 7. CLI コマンドリファレンス

| コマンド | 説明 |
| :--- | :--- |
| `eidolon init` | 対話的初期導入ウィザードの起動、環境・設定・SQLite の初期化 |
| `eidolon config [show\|set\|test]` | 設定の確認・変更、LLM 接続 simple-test の実行 |
| `eidolon distill <file> [options]` | 対話取り込み、7層特徴蒸留、Telegram 進捗通知、評価の実行 |
| `eidolon evaluate <persona>` | 指定ペルソナのオフライン評価と DSI スコア算出 |
| `eidolon validate <path>` | `.eidolon` アーカイブまたはディレクトリの JSON スキーマ検証 |
| `eidolon persona [list\|activate\|install\|verify]` | ペルソナ一覧表示、アクティブ化、安全なインストール、整合性検証 |
| `eidolon memory [status\|compact\|export]` | 記憶統計の確認、期限切れ記憶の圧縮、全量エクスポート |
| `eidolon bot [token\|user\|status]` | Telegram Bot トークンおよび許可ユーザーの管理 |
| `eidolon service [start\|stop\|restart\|status]` | Go 言語常駐デーモンサービスの管理 |
| `eidolon logs [-n lines]` | デーモンのリアルタイムログの閲覧 |
| `eidolon status` | システム全体のステータス確認 |

[↑ 返回顶部 / Back to Top](#eidolon-v121)

---

## 8. License

GNU General Public License v3.0 (GPL-3.0). 詳細については [LICENSE](LICENSE) を参照してください。
