# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-19

### Added
- **Distillation Core**:
  - Ingestion engine supporting PDF, Telegram JSON (`result.json`), WeChat/generic HTML, and TXT/Markdown chat transcripts.
  - Multi-speaker identification, target selection, and timestamp normalization.
  - Layer 1: Language Fingerprint (statistical distributions, n-grams, punctuation, line breaks, length profiles).
  - Layer 2: Conditional Style ($P(\text{feature} \mid \text{context})$).
  - Layer 3: Response Behavior distillation (situation-to-strategy matrix, follow-up, topic handling).
  - Layer 4: Conversation Rhythm (response latency distribution, burst patterns, double messaging).
  - Layer 5: Emoji & Sticker modeling with sentiment bindings.
  - Layer 6: Context Supplement & World Model knowledge graph with strict provenance tracking.
  - Layer 7: Memory seed extraction.
- **Evaluation Engine (DSI)**:
  - Blind evaluation dataset builder (`train.jsonl`, `validation.jsonl`, `test.jsonl`) with isolated target messages.
  - 5-Dimensional Distillation Similarity Index (Lexical 20%, Style 20%, Behavior 25%, Context 15%, Blind Judge 20%).
  - Independent LLM Pairwise Blind Judge with randomized order.
  - Failure case extraction and interactive HTML report generator (`evaluation_report.html`).
  - Distillation optimization feedback loop and Quality Gate validation.
- **Persistent Memory Engine**:
  - 4-layer architecture: L0 Working, L1 Episodic, L2 Semantic with versioned temporal facts, L3 World/Timeline.
  - Real-time conversation event/fact extraction and 6-factor importance scoring.
  - Historical conversation example retrieval for few-shot in-context grounding.
  - SQLite persistence with automatic conflict resolution.
- **Generation & Telegram Runtime**:
  - 3-candidate generation pipeline with Style Critic and Rewriter.
  - Human-like response scheduler (clamped latency distribution + length factor + random jitter).
  - Native Telegram Bot client with strict user ID allowlist.
  - Zero SSE / Zero streaming policy — complete generation before human-paced dispatch.
- **CLI Suite**:
  - Global `eidolon` CLI with subcommands: `init`, `config`, `distill`, `evaluate`, `persona`, `memory`, `bot`, `service`, `status`, `logs`.
- **Web Dashboard**:
  - Full-featured dark cyberpunk web dashboard powered by HTML, CSS, JavaScript, and GSAP animations.
  - Real-time service status, DSI radar breakdown, failure viewer, memory inspector, and live logs.
- **Packaging & Deployment**:
  - Persona package exporter with `.eidolon` archive compression.
  - systemd user service generator and automated installer script.
