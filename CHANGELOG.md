# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0-preview.1] - 2026-09-23

### Fixed & Overhauled
- **Ingestion Sanitizer & System Message Leak Elimination**:
  - Overhauled regex matching in `cli/ingestion/sanitize.js` to detect malformed or unclosed group chat announcements (e.g. `我是群聊“...”?` with trailing punctuation or mismatched quotes) and system notices.
  - Added and exported `isPollutedContent(text)` and `cleanMessageContent(text)` across ingestion and distillation pipelines.
  - Fixed Markdown ingestion parser (`cli/ingestion/md.js`) speaker attribution: date headers (`### YYYY-MM-DD`) and system announcements are cleanly separated and discarded before speaker attribution, preventing system metadata from being concatenated to previous dialogue turns or parsed as dialogue content.
  - Strict speaker normalization in `cli/ingestion/normalize.js` isolating target speaker from counterpart speaker and discarding non-dialogue lines.
- **Distillation Engine & Persona Fidelity Overhaul**:
  - Completely overhauled `buildFewShotBlock` in `cli/distillation/persona.js`: verified prompt is from counterpart speaker and response is from target speaker, strictly preventing role reversal and eliminating repetitive message leaks.
  - CJK Tokenization & Space Normalization (`cli/distillation/language.js`): implemented `normalizeChineseSpaces` to remove artificial spaces between Chinese characters (`图 片` -> `图片`, `好 吧` -> `好吧`), and sanitized catchphrase extraction so colloquial expressions are authentic and clean (`好吧`, `没事`, `真的`, `晚安`, `行啊`, `也是`, `确实`, `好的`, `可以啊`).
  - Contextual Emoji Modeling (`cli/distillation/assets.js`): probability distribution $P(\text{emoji} \mid \text{context}, \text{emotion})$ with actual corpus frequencies and context sentiment bindings, eliminating unnatural emoji mismatches.
- **Go Server Runtime & Human Simulation Engine**:
  - Completely eradicated robotic fallback canned phrases (`在呢，怎么啦~`, `在忙呢，稍等下哦`) from `server/internal/runtime/runtime.go`.
  - Replaced with dynamic, state-aware, time-of-day contextual persona fallbacks for casual calls (`oi`, name calls, etc.) based on relationship warmth and time.
  - Leaked speaker label & candidate format stripping (`cleanSinglePassOutput`): cleans any lingering speaker tags (`Yawen:`, `Target:`, `Candidate:`, etc.).
  - Overhauled fallback persona in `server/internal/persona/persona.go` and added robust loading for top-level and nested linguistic fingerprints, openers, and catchphrases.
- **Test Infrastructure**:
  - Expanded test suite to 246 Node.js tests across 52 suites passing with 0 failures (`tests/distillation/engine_overhaul_verification.test.js`).
  - 100% Go unit tests passing across all packages.

## [1.3.1] - 2026-09-22

### Added
- **Burst Debounce Buffer (3.5s)**: Multi-message burst buffer in Telegram runtime, aggregating rapid consecutive messages into a single conversational turn.
- **Intelligent Semantic Quote Reply**: Replaced unconditional quote reply with smart targeted quoting only in multi-question burst scenarios.
- **Single-Pass Direct Generation**: Streamlined generation pipeline to single-pass direct synthesis, eliminating redundant 3-candidate Critic LLM rounds.
- **Latency Model Calibration**: Fixed minute-quantized timestamps yielding 60s latency spikes, restoring realistic human IM pacing (2-8 seconds).

## [1.2.1] - 2026-09-20

### Fixed
- **Telegram /start Pairing Synchronous Race Condition**:
  - In `pollLoop`, immediately execute `b.allowUser(userIDStr)` upon encountering `/start`, eliminating a race condition where subsequent messages in the same poll batch (e.g. `123`) were evaluated before asynchronous worker pairing and erroneously dropped as unauthorized.
  - Hardened `/start` command detection to be case-insensitive and match standard Telegram command patterns (`/start`, `/start `, `/start@...`).
  - Added unit test `TestTelegram_StartPairingFollowedByMessage123` verifying zero-loss delivery of `/start` followed immediately by `123` in the same update slice from an unauthorized user.
  - Handled HTTP 400 Bad Request on `deleteMessage` gracefully (already deleted / not found) and added transient error retries.
- **Companion Persona Human-Fidelity Guardrails**:
  - Rewrote default companion persona (`Ms.Yawen`) system prompt to strictly enforce colloquial human friendship chatting and forbid assistant/task-handling tone.
  - Enhanced `sanitizeOutput` and `cleanOutput` to detect and strip robotic service phrases ("想让我做什么", "处理任务", "指令", unclosed `<think>` tags), ensuring zero machine tone leaks.

## [1.2.0] - 2026-09-20

### Added
- **Telegram Bot /start Startup Pairing & Automatic Command Message Deletion**:
  - Implemented `/start` startup pairing command: user's Telegram ID is automatically added to the allowlist and persisted to `~/.config/eidolon/config.json`.
  - Silent pairing guarantee ("无其他多余"): automatically deletes the user's incoming `/start` message via Telegram Bot API `deleteMessage` without sending redundant greeting text.
  - Subsequent messages from paired users (e.g. `123`) are accepted and processed immediately.
- **Default Fallback Companion Persona**:
  - Built-in default companion identity (`Ms.Yawen`) ensures full conversational responsiveness even prior to distilling or activating a custom persona package.
- **L4 Dynamic Relationship & Human-like Behavioral Simulation Engine (真人模拟算法)**:
  - 8-dimensional continuous relationship state: `affinity`, `trust`, `warmth`, `irritation`, `hurt`, `engagement`, `tension`, `initiative`.
  - 8-dimensional continuous emotion dynamics: `anger`, `annoyance`, `affection`, `sadness`, `happiness`, `embarrassment`, `loneliness`, `excitement`.
  - Perception layer extracting `intent`, `sentiment`, `pressure`, `affection`, `humor`, `importance`, and `apology_strength`.
  - Inertial state transition differential equation: $S(t+1) = \text{clamp}(\lambda S(t) + W \cdot X(t) + \epsilon, 0, 1)$ with $\lambda = 0.88$.
  - Exponential temporal decay & emotional recovery functions with distinct half-lives ($\tau$).
  - Continuous Coldness Index ($C \in [0.0, 1.0]$) replacing binary cold war toggles.
  - Log-normal and interactive multi-factor response latency model conditioned on relationship warmth, irritation, and inquiry intent.
  - Multi-part message splitting & natural clause granularity planner.
  - Probabilistic contextual emoji distribution and sticker scoring model.
  - Post-send retraction & "send-then-regret" (先发后悔) behavioral chain powered by sigmoid deletion probability.
  - 12 macro response strategies with dynamic warmth & brevity controls.
  - Mathematical model of reconciliation and apology strength ($hurt_{new} = hurt \cdot (1 - 0.45 \cdot strength)$, $trust_{new} = trust + 0.12 \cdot strength$).
  - 7-state Behavioral State Machine (BSM: `NORMAL`, `WARM`, `DISTANT`, `ANNOYED`, `CONFLICT`, `COLD`, `RECOVERING`).
  - L4 state persistence in atomic SQLite transaction `CommitInteraction()`.
  - Comprehensive mathematical specification document in `docs/human-simulation-algorithm.md`.

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
