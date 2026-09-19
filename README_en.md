# EIDOLON v1.1.0

<p align="center">
  <strong>Persona Distillation & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity.»</em>
</p>

<p align="center">
  <a href="README.md#-简体中文"><strong>简体中文</strong></a> •
  <a href="README_en.md"><strong>English</strong></a> •
  <a href="README_ja.md"><strong>日本語</strong></a>
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

## 1. Project Redefinition

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

## 2. Core Architecture & 7 Distillation Layers

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
1. **Layer 1: Language Fingerprint**: Statistical distributions of message & sentence lengths (median, P90, std-dev), Chinese modal/tone particles (`啊/呀/呢/嘛/吧`), character repetition patterns (`哈哈哈/啊啊啊`), message structures (single-line, multi-line, bulleted), terminal punctuation drop rates, and vocabulary profile rankings (never injected as mandatory prompt constraints).
2. **Layer 2: Conditional Style**: Bayesian smoothing (Beta-Binomial with $\alpha=1, \beta=1$) calculating $P(\text{feature} \mid \text{context})$ with explicit sample size and confidence scores.
3. **Layer 3: Response Behavior**: Data-driven situational response matrix (banter, empathy, explanation, farewell) derived from observed stats + LLM summarization without generic fallback templates.
4. **Layer 4: Conversation Rhythm**: Observed response latency model (`latency_model`) bucketed by message length (short, medium, long) with Gaussian jitter; completely eliminating fabricated 180 CPM.
5. **Layer 5: Emoji & Sticker Assets**: Context-bound discrete asset models mapped to conversational sentiments.
6. **Layer 6: World Model & Context Supplement**: Strict provenance separating conversational ground truth from external background files (`--context`).
7. **Layer 7: Memory Seed**: 4-layer memory initialization across L0 (working), L1 (episodes), L2 (semantic facts), and L3 (world state).

---

## 3. Distillation Similarity Index (DSI)

DSI is calculated as a weighted composite of 4 deterministic dimensions and 1 independent blind judge:

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

| Dimension | Weight | Mathematical Definition & Basis |
| :--- | :---: | :--- |
| **L (Lexical Similarity)** | 20% | $0.30 \times \text{ngram cosine} + 0.20 \times \text{punct dist} + 0.20 \times \text{vocab overlap} + 0.15 \times \text{msg len ratio} + 0.15 \times \text{sent len ratio}$ |
| **S (Structural Style)** | 20% | Feature distribution similarity (emoji delta, ellipsis, question marks, exclamations, clean terminal drop, length bucket, repetition) |
| **B (Behavioral Similarity)** | 25% | Behavioral feature vector distance across key situations; immediate catastrophic penalty for AI identity leak |
| **C (Contextual Consistency)**| 15% | World model entity contradiction checking, fact negation violation detection, and entity grounding bonus |
| **H (Independent Blind Judge)**| 20% | Randomized A/B candidate assignment, structured `reason_codes`, sub-dimension similarities, and blind qualitative scoring |

### Acceptance Quality Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

## 4. Engineering & Security Hardening

- **Native SQLite Persistence**: Eliminated redundant disk JSON serialization. Parameterized SQL queries execute directly against SQLite; `CommitInteraction` provides atomic ACID transactions across messages, memories, and scheduler events.
- **Temporal Memory Versioning**: Updates supersede facts with `valid_to` timestamps, preserving complete historical fact evolutions. Multi-factor Top-K retrieval prevents prompt flooding:
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **Session-based Split & Leakage Guard**: Evaluation sets partition by entire conversation sessions (Train 70% / Val 15% / Blind 15%). Cross-split 3-gram Jaccard similarity $> 0.90$ triggers automatic rejection and leakage reporting.
- **Runtime Candidate Pipeline**: Generates Candidate A/B/C $\to$ Style Critic scoring $\to$ `sanitizeOutput` safety guardrail; removed fixed 0.88 critic scores.
- **Telegram Concurrency & Privacy**: Per-chat dedicated serial channel queues guarantee strict sequential message and memory ordering; user IDs are masked in logs via HMAC-SHA256 salted hashes.
- **Zip Slip Defense**: Path normalization and containment checks prevent directory traversal during `.eidolon` bundle extraction.
- **Reproducibility & Prompts**: Distillation prompts externalized in `cli/distillation/prompts/`; bundles include `reproducibility.json` with commit, model, seed, and data hashes.

---

## 5. Quick Start

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

## 6. CLI Command Reference

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

---

## 7. License

GNU General Public License v3.0 (GPL-3.0). Detailed in [LICENSE](LICENSE).
