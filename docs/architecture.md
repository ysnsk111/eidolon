# EIDOLON v1.0 Architecture Specification

## Overview

EIDOLON is a closed-loop Persona Distillation & Memory Runtime designed to extract computable linguistic, stylistic, behavioral, and memory representations from historical conversations, verify their fidelity via offline blind evaluation benchmarks, and execute human-like runtime generation.

```
┌─────────────────────────────────────────────┐
│                  EIDOLON CLI                │
├─────────────────────────────────────────────┤
│ Ingestion │ Distillation │ Evaluation      │
├─────────────────────────────────────────────┤
│ Persona │ Style │ Behavior │ World │ Assets │
├─────────────────────────────────────────────┤
│                 Memory Engine               │
├─────────────────────────────────────────────┤
│                Context Engine               │
├─────────────────────────────────────────────┤
│                 LLM Adapter                 │
├─────────────────────────────────────────────┤
│ Telegram Runtime │ HTTP │ Web Dashboard     │
└─────────────────────────────────────────────┘
```

## Subsystem Breakdown

### 1. Ingestion Layer (`cli/ingestion/`)
- Ingests raw chat records across multiple file formats:
  - **PDF**: Document stream text parsing and metadata extraction.
  - **JSON**: Official Telegram Desktop exports (`result.json`) and generic chat arrays.
  - **HTML**: Telegram HTML exports (`messages.html`) and DOM chat containers.
  - **TXT/MD**: Flexible timestamp and regex header parsing.
- Canonical Normalization (`normalize.js`):
  - Resolves speakers, frequency distribution, and primary target identification.
  - Normalizes timestamps to UTC ISO-8601.
  - Segments records into conversation sessions via idle gap detection (>25 minutes).

### 2. Distillation Engine (`cli/distillation/`)
- Multi-layer statistical and behavioral feature extraction:
  - **Layer 1: Language Fingerprint**: Vocabulary, n-grams, punctuation rates, sentence and message length distributions.
  - **Layer 2: Conditional Style**: Evaluates $P(\text{feature} \mid \text{context})$.
  - **Layer 3: Response Behavior**: Situational strategy policy matrix.
  - **Layer 4: Conversation Rhythm**: Clamped response latency, bursts, and double-messaging probabilities.
  - **Layer 5: Assets**: Emoji and sticker modeling with context and sentiment associations.
  - **Layer 6: World Model**: Knowledge graph of entities, relationships, timeline milestones, and temporal validity states.
  - **Layer 7: Memory Seed**: Initial episodic and semantic memory graph for runtime continuation.

### 3. Evaluation Engine (`cli/evaluation/`)
- Strict dataset separation: Distillation (70%), Validation (15%), Blind Test (15%).
- Blind evaluation executes candidate generation with hidden ground-truth targets.
- 5-Dimensional Distillation Similarity Index (DSI):
  $$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$
- Independent Blind Judge: Randomized pairwise comparison ($A$ vs $B$) without origin knowledge.

### 4. Memory Engine (`server/internal/memory/`)
- 4-layer memory hierarchy:
  - **L0 Working Memory**: Active in-flight conversation buffer.
  - **L1 Episodic Memory**: Salient conversational events and emotional peaks.
  - **L2 Semantic Memory**: Enduring preferences and facts with temporal versioning (`valid_from`, `valid_to`).
  - **L3 World & Timeline**: Macro environment facts and relationship states.
- 6-factor Importance Scoring formula:
  $$\text{Score} = \text{Imp} \times 0.30 + \text{Rec} \times 0.15 + \text{Freq} \times 0.15 + \text{RelImpact} \times 0.15 + \text{FutureRel} \times 0.15 + \text{Conf} \times 0.10$$

### 5. Persistent Runtime & Telegram Service (`server/`)
- Compiled Go service daemon providing high concurrency, low memory footprint, and SQLite storage.
- Telegram Bot client with strict user ID allowlist.
- Zero streaming (SSE disabled); simulates realistic typing durations before dispatching complete messages.
- Full-featured dark-theme web dashboard with GSAP animations.
