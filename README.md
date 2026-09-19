# EIDOLON v1.1.0

<p align="center">
  <strong>Persona Distillation & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity.»</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL-3.0">
  <img src="https://img.shields.io/badge/Node.js-24%20LTS-green.svg" alt="Node.js: 24 LTS">
  <img src="https://img.shields.io/badge/Go-1.22+-00ADD8.svg" alt="Go 1.22+">
  <img src="https://img.shields.io/badge/OS-AlmaLinux%209-orange.svg" alt="AlmaLinux 9">
  <img src="https://img.shields.io/badge/DSI-84.2%25%20PASS-brightgreen.svg" alt="DSI: PASS">
</p>

---

## 1. Project Redefinition / 项目重新定义

EIDOLON 不再定义为：“把聊天记录总结成一个 Persona”。

**V1 正式定义为：**
> **«从历史对话中蒸馏出可计算的语言、行为、上下文与记忆特征，并通过离线评测集反复验证生成结果与历史样本之间的风格一致性。»**

EIDOLON 拥有两个完全独立的闭环：

```
DISTILLATION LOOP:
Historical Chat ──▶ Ingestion ──▶ Multi-Layer Distillation ──▶ Persona Runtime Package

EVALUATION LOOP:
Blind Test Dataset ──▶ Candidate Generation ──▶ Pairwise Blind Judge ──▶ DSI Score ──▶ Optimization
```

只有两项均完成并通过质量门槛（Quality Gate），才算真正的 **Distillation Complete**。

---

## 2. Core Architecture / 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                       EIDOLON CLI                       │
├─────────────────────────────────────────────────────────┤
│    Ingestion    │    Distillation    │    Evaluation    │
├─────────────────────────────────────────────────────────┤
│ Persona │ Style │ Behavior │ World │ Assets │ Memory    │
├─────────────────────────────────────────────────────────┤
│                   Memory Engine (L0-L3)                 │
├─────────────────────────────────────────────────────────┤
│                  LLM Provider Adapter                   │
├─────────────────────────────────────────────────────────┤
│ Telegram Runtime │ Persistent HTTP │ Web Dashboard      │
└─────────────────────────────────────────────────────────┘
```

### The 7 Distillation Layers:
1. **Layer 1: Language Fingerprint**: Sentence and message length distributions (median, p90, stdDev), n-grams (1, 2, 3), punctuation rates (ellipsis, question, exclamation, terminal drop), mixed language ratio, catchphrases, openers, closers.
2. **Layer 2: Conditional Style**: $P(\text{feature} \mid \text{context})$ conditional probabilities.
3. **Layer 3: Response Behavior**: Situational strategy policy matrix (teasing, venting, inquiry, closing).
4. **Layer 4: Conversation Rhythm**: Typing speed calculation (CPM), burst patterns, double-message probabilities.
5. **Layer 5: Emoji & Sticker Assets**: Discrete asset modeling with emotion bindings.
6. **Layer 6: World Model & Context Supplement**: Strict separation between supplied backstory (`--context`) and conversational ground truth.
7. **Layer 7: Memory Seed**: 4-layer initialization.

---

## 3. Distillation Similarity Index (DSI)

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

- **L (Lexical Similarity)**: 20%
- **S (Structural Style Similarity)**: 20%
- **B (Behavioral Similarity)**: 25% *(Highest weight: speaking the same words does not mean responding the same way)*
- **C (Contextual Consistency)**: 15%
- **H (Independent Blind Judge)**: 20%

### Acceptance Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

## 4. Quick Start / 快速开始

### Installation (User Space)
```bash
git clone https://github.com/ysnsk111/eidolon.git
cd eidolon
npm install
npm link
eidolon init
```

### Configuration & LLM Connectivity Test
```bash
# Test LLM endpoint handshake
eidolon config test

# View configuration
eidolon config show

# Set Telegram bot token
eidolon bot token set <YOUR_BOT_TOKEN>
eidolon bot user add <ALLOWED_TELEGRAM_USER_ID>
```

### Run Distillation Pipeline
```bash
# Basic distillation
eidolon distill /path/to/chat.pdf

# With supplied world context & backstory
eidolon distill \
  --input /path/to/chat.pdf \
  --context /path/to/world.md \
  --output ./completed_result
```

### Offline Blind Evaluation
```bash
eidolon evaluate persona_20260919_143000
```

### Start Persistent Runtime & Web Dashboard
```bash
eidolon service start
eidolon status
```
Open **http://127.0.0.1:8090** to access the GSAP-powered Web Dashboard.

---

## 5. CLI Command Reference / CLI 命令完整索引

| Command | Description |
| ------- | ----------- |
| `eidolon init` | Initialize environment, local SQLite database, and directory structures |
| `eidolon config show` | Print current active configuration |
| `eidolon config test` | Perform live handshake with LLM endpoint |
| `eidolon config set <key> <val>` | Update configuration key |
| `eidolon distill <file> [opts]` | Execute end-to-end persona distillation and evaluation |
| `eidolon evaluate <persona>` | Run offline blind benchmarks against isolated test set |
| `eidolon persona list` | List installed personas, active status, and DSI scores |
| `eidolon persona activate <id>` | Set active persona for runtime |
| `eidolon persona verify` | Validate package schemas and files integrity |
| `eidolon memory status` | Inspect L0-L3 memory layers count |
| `eidolon memory compact` | Prune low-importance and expired memories |
| `eidolon memory export` | Export all persistent memory records to JSON |
| `eidolon bot token set <token>` | Set Telegram bot token |
| `eidolon bot user add <id>` | Add user ID to Telegram allowlist |
| `eidolon bot status` | Check Telegram bot configuration |
| `eidolon service start/stop` | Control persistent daemon service |
| `eidolon logs` | View live runtime daemon logs |
| `eidolon status` | Complete system overview |

---

## 6. Real-Person Boundary Policy / 现实人物伦理边界

In accordance with Section 58 of the specification, EIDOLON runtimes must strictly operate within authorized domains:
1. `SELF`: Distilling your own communication patterns.
2. `CONSENTED_PERSONA`: Explicit, informed consent granted by the target individual.
3. `FICTIONAL_CHARACTER`: Distilling fictional or literary figures.

Deceptive real-person impersonation on live communication networks is strictly prohibited.

---

## 7. License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for full details.
