# EIDOLON v1.1.0

<p align="center">
  <strong>Persona Distillation & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity.»</em>
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

## 1. Project Redefinition / 项目重新定义

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

## 2. Core Architecture / 核心架构

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

### The 7 Distillation Layers:
1. **Layer 1: Language Fingerprint**: 字符/句子长度分布（中位数、P90、方差）、中文语气虚词（啊/呀/呢/嘛/吧等）、字词重复模式（哈哈哈/啊啊啊）、消息结构（单行/多行/列表）、标点脱落习惯、Top 词汇特征轮廓（不作为强制硬约束以防过拟合）。
2. **Layer 2: Conditional Style**: 基于 Beta-Binomial 贝叶斯平滑（$\alpha=1, \beta=1$）学习 $P(\text{feature} \mid \text{context})$，保留样本规模与置信度。
3. **Layer 3: Response Behavior**: 数据驱动的行为策略矩阵（调侃反讽、情感安抚、解释说明等），由统计特征 + LLM 仅做归纳，杜绝通用预设模板。
4. **Layer 4: Conversation Rhythm**: 基于历史时间戳建立短/中/长三桶实际回复延迟分布模型（`latency_model`），彻底废除伪造的固定 180 CPM。
5. **Layer 5: Emoji & Sticker Assets**: 上下文绑定的离散表情与贴纸资产模型。
6. **Layer 6: World Model & Context Supplement**: 区分对话内真实事实与外部补充设定（`--context`），具备严格溯源与实体关系网。
7. **Layer 7: Memory Seed**: L0（工作记忆）、L1（情景事件）、L2（语义事实）、L3（世界设定）分层初始化。

---

## 3. Distillation Similarity Index (DSI)

DSI 由 4 维确定性统计指标与 1 维独立盲评综合加权计算：

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| 维度 | 权重 | 计算依据与定义 |
| :--- | :---: | :--- |
| **L (Lexical Similarity)** | 20% | 0.30 字符 1/2-gram 余弦 + 0.20 标点分布距离 + 0.20 词汇特征重叠 + 0.15 消息长度比 + 0.15 句子长度比 |
| **S (Structural Style)** | 20% | 特征分布相似度（表情增量、省略号、问号、感叹号、无标点结尾、长度分桶比、重复字率） |
| **B (Behavioral Similarity)** | 25% | 行为特征向量对齐度（调侃应对、情绪共情、反问追问、语气正规度），检测到 AI 伪装硬性扣至最低分 |
| **C (Contextual Consistency)**| 15% | 世界模型实体矛盾检测、事实否定矛盾检测与事实落地加分（无事实时归一化为 null） |
| **H (Independent Blind Judge)**| 20% | 双候选（Candidate A/B）随机盲测打乱，输出结构化 `reason_codes`、分项相似度与客观判定证据 |

### Acceptance Quality Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

## 4. Key Engineering & Security Hardening (v1.1)

- **原生 SQLite 存储（Native SQLite ACID）**：彻底剔除冗余的磁盘 JSON 序列化，所有查询参数化直达 SQLite；提供 `CommitInteraction` 原子事务保障消息、时序记忆与调度事件一致性。
- **时序记忆版本控制（Temporal Versioning）**：事实更新时打上 `valid_to` 时间戳，完整记录事实变迁；多维加权检索 Top-K 防止 Prompt 膨胀：
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **会话切分与防泄漏（Leakage Guard）**：数据集按完整 Session 划分（Train 70% / Val 15% / Blind 15%）；引入 3-gram Jaccard 相似度去重（阈值 0.90 自动拦截剔除）。
- **Runtime 候选评判管线**：A/B/C 三候选生成 $\to$ Style Critic 评分选优 $\to$ `sanitizeOutput` 安全守卫；废除写死 0.88 分。
- **Telegram 并发与安全**：基于 `chat_id` 建立会话专属 Channel 保证时序严格递增；用户 ID 使用 HMAC-SHA256 盐值哈希脱敏，日志不存明文 ID。
- **Zip Slip 路径遍历防护**：`.eidolon` 安装与校验严格进行解压路径边界拦截，防范目录穿越攻击。
- **工件与提示词版本化**：外置提示词模版（`cli/distillation/prompts/`），导出包自带 `reproducibility.json` 可复现元数据。

---

## 5. Quick Start / 快速开始

### 1. Installation
```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm link
eidolon init
```

### 2. Configuration & Handshake
```bash
# 查看与测试 LLM 连接
eidolon config show
eidolon config test

# 设置 Telegram Bot
eidolon bot token set <YOUR_BOT_TOKEN>
eidolon bot user add <TELEGRAM_USER_ID>
```

### 3. Run Distillation Pipeline
```bash
# 基础对话蒸馏
eidolon distill /path/to/chat.txt -t Alice

# 附带世界观与人物设定并导出指定目录
eidolon distill \
  --input /path/to/chat.jsonl \
  --context /path/to/world.md \
  --target Alice \
  --output ./completed_result
```

### 4. Package Validation
```bash
# 对生成的 .eidolon 压缩包或解压目录执行 6 大 Schema 规范验证
eidolon validate ./completed_result/persona_xxx.eidolon
```

### 5. Start Runtime Service & Web Dashboard
```bash
# 构建并启动服务
npm run build:server
eidolon service start
eidolon status
```
浏览器打开 **http://127.0.0.1:8090** 即可访问管理面板。

---

## 6. CLI Command Reference / 完整 CLI 索引

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

---

## 7. Testing & Quality Assurance / 自动化测试

项目内置 Golden Dataset 与 13 个完整自动化测试套件：

```bash
# 运行全部 34 项测试
npm test

# 分模块针对性测试
npm run test:distillation   # 语言指纹、节奏延迟模型等
npm run test:evaluation     # DSI 公式、防泄漏去重、盲评协议等
npm run test:regression     # 黄金数据集端到端全链路回归

# Go 服务端单元测试与二进制构建
cd server && go test -v ./...
npm run build:server
```

---

## 8. License

GNU General Public License v3.0 (GPL-3.0). Detailed in [LICENSE](LICENSE).
