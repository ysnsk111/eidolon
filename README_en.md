# EIDOLON v1.3.1

<p align="center">
  <strong>Persona Distillation, L4 Relationship & Memory Runtime</strong><br>
  <em>«Preserve expression. Reconstruct context. Measure fidelity. Simulate authentic presence.»</em>
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
  <a href="docs/human-simulation-algorithm.md"><strong>📐 Algorithm Spec</strong></a>
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

## Table of Contents

- [1. Project Redefinition](#1-project-redefinition)
- [2. Core Architecture & 7 Distillation Layers](#2-core-architecture--7-distillation-layers)
- [3. Distillation Similarity Index (DSI)](#3-distillation-similarity-index-dsi)
- [4. L4 Dynamic Relationship State & Human Simulation](#4-l4-dynamic-relationship-state--human-simulation)
- [5. Engineering & Security Hardening](#5-engineering--security-hardening)
- [6. Quick Start & Onboarding Wizard](#6-quick-start--onboarding-wizard)
- [7. CLI Command Reference](#7-cli-command-reference)
- [8. License](#8-license)

---

## 1. Project Redefinition

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
│                  L4 Dynamic Relationship & Emotion Engine              │
├────────────────────────────────────────────────────────────────────────┤
│                  Memory Engine (L0-L3 Temporal Store)                  │
├────────────────────────────────────────────────────────────────────────┤
│                  Native SQLite Storage & ACID Engine                   │
├────────────────────────────────────────────────────────────────────────┤
│ Telegram Runtime (Serial Queue) │ HTTP API │ GSAP Web Dashboard        │
└────────────────────────────────────────────────────────────────────────┘
```

### The 7 Distillation Layers:
1. **Layer 1: Language Fingerprint**: Statistical distributions of message & sentence lengths (median, P90, std-dev), modal tone particles, character repetition patterns, message structures, terminal punctuation drop rates, and vocabulary profile rankings.
2. **Layer 2: Conditional Style**: Bayesian smoothing (Beta-Binomial with $\alpha=1, \beta=1$) calculating $P(\text{feature} \mid \text{context})$ with explicit sample size and confidence scores.
3. **Layer 3: Response Behavior**: Data-driven situational response matrix (banter, empathy, explanation, farewell) derived from observed statistics without generic assistant fallback templates.
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
| **B (Behavioral Similarity)** | 25% | Behavioral feature vector distance across key situations; immediate catastrophic penalty for AI identity leaks |
| **C (Contextual Consistency)**| 15% | World model entity contradiction checking, fact negation violation detection, and entity grounding bonus |
| **H (Independent Blind Judge)**| 20% | Randomized A/B candidate assignment, structured `reason_codes`, sub-dimension similarities, and blind qualitative scoring |

### Acceptance Quality Gate:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$

---

## 4. L4 Dynamic Relationship State & Human Simulation

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

## 5. Engineering & Security Hardening

- **Native SQLite Persistence**: Parameterized queries execute directly against SQLite; `CommitInteraction` provides atomic ACID transactions across messages, memories, and scheduler events.
- **Temporal Memory Versioning**: Updates supersede facts with `valid_to` timestamps, preserving complete historical fact evolutions. Multi-factor Top-K retrieval prevents prompt flooding:
  $$\text{Score} = \text{Relevance} \times 0.40 + \text{Importance} \times 0.25 + \text{Recency} \times 0.15 + \text{Confidence} \times 0.20$$
- **Session-based Split & Leakage Guard**: Evaluation sets partition by entire conversation sessions (Train 70% / Val 15% / Blind 15%). Cross-split 3-gram Jaccard similarity $> 0.90$ triggers automatic rejection.
- **Runtime Candidate Pipeline**: Generates Candidate A/B/C $\to$ Style Critic scoring $\to$ `sanitizeOutput` safety guardrail, stripping AI boilerplate and never leaking `[sanitized]` tokens.
- **Telegram Concurrency & Privacy**: Dedicated serial channel queues per chat guarantee message ordering; user IDs are masked in logs via HMAC-SHA256 salted hashes.
- **Zip Slip Defense**: Path normalization and containment checks prevent directory traversal during `.eidolon` bundle extraction.
- **Reproducibility & Prompts**: Distillation prompts externalized in `cli/distillation/prompts/`; bundles include `reproducibility.json` with commit, model, seed, and data hashes.

---

## 6. Quick Start & Onboarding Wizard

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

## 7. CLI Command Reference

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
| `eidolon clear [--mode all|chat-memory]` | 3-step interactive clearance: complete purge (all-clear) or chats & memories only (preserves personas) |

[↑ Back to Top](#eidolon-v121)

---

## 8. License

GNU General Public License v3.0 (GPL-3.0). See [LICENSE](LICENSE) for details.
