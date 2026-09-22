# Project: EIDOLON Human Simulation Refactor & Fidelity Calibration

## Architecture

EIDOLON is a dual-stack human simulation engine consisting of:
1. **Distillation & Ingestion Engine (Node.js/ESM in `cli/`)**:
   - `cli/ingestion/`: Parses heterogeneous chat exports (TXT, Markdown, Telegram JSON/HTML, PDF), normalizes sessions, and applies data sanitization.
   - `cli/distillation/`: 6-layer extraction pipeline:
     - Layer 1: Language Fingerprint (`language.js`) - lexical stats, CJK tokens, catchphrases, openers/closers.
     - Layer 2: Conditional Style (`behavior.js`) - Bayesian Beta-Binomial context feature probabilities.
     - Layer 3: Response Behavior (`behavior.js`) - situation policy mapping.
     - Layer 4: Conversation Rhythm (`behavior.js`) - latency modeling and typing dynamics.
     - Layer 5: Assets / Emoji Contextual Modeling (`assets.js`) - contextual emotion bindings, compound emojis.
     - Layer 6: World Model (`world.js`) & Persona Package Assembly (`persona.js`).
   - `cli/evaluation/`: Decoupled DSI (Distillation Score Index) evaluation engine (`metrics.js`, `judge.js`, `runner.js`).
2. **Runtime Companion Server (Go in `server/`)**:
   - `server/cmd/eidolon-server/`: Main daemon entrypoint.
   - `server/internal/telegram/`: Telegram Bot service, session message queue, debounce buffer, typing simulator, message dispatcher.
   - `server/internal/runtime/`: Orchestrator, prompt builder, direct single-pass inference client, output sanitizer, SQLite persistence.
   - `server/internal/scheduler/`: Advanced human-like response delay scheduler with Gaussian jitter.
   - `server/internal/memory/` & `relationship/`: Episodic memory and relationship perception engine.
   - `server/internal/storage/`: SQLite transactional storage.

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Telegram Direct Send | Normal 1-to-1 dialogue turns sent directly without quote-reply banners (`reply_parameters: { message_id: ... }`). | M3 | ORIGINAL_REQUEST §R1 |
| F2 | Burst Message Debounce Buffer | Session-level 3-4s debounce window per chat in Telegram bot service; coalesces rapid messages into single turn. | M3 | ORIGINAL_REQUEST §R1 |
| F3 | Intelligent Contextual Quote-Replying | Intelligently triggers quote-reply targeting specific message ID only for multi-question bursts or explicit referenced turns. | M3 | ORIGINAL_REQUEST §R1 |
| F4 | Ingestion Sanitizer | Scrub Markdown headers (`### YYYY-MM-DD`), image tokens (`[图片]`), group announcements (`我是群聊...`), and system logs before extraction. | M1 | ORIGINAL_REQUEST §R2 |
| F5 | Distillation Language Fingerprint & Catchphrases | CJK tokenization without space separation, whole-sentence catchphrases, stopword filtering, clean openers/closers. | M1 | ORIGINAL_REQUEST §R2 |
| F6 | Emoji Contextual Modeling | Fix array index desynchronization, support compound emojis (ZWJ/modifiers), fine-grained emotional tags, contextual system prompt bindings, eliminate generic `'😊 ✨'`. | M1 | ORIGINAL_REQUEST §R2 |
| F7 | Few-Shot Selection & Injection | Dynamic counterpart naming, noise filtering, joined burst turns, phase diversity, clean authentic colloquial turns. | M1 | ORIGINAL_REQUEST §R2 |
| F8 | Single-Pass Direct Runtime Generation | Replace 3-candidate JSON contract (`candidate_a/b/c`) and Style Critic LLM roundtrip with direct, single-pass generation (1-2 short phrases). | M2 | ORIGINAL_REQUEST §R3 |
| F9 | Runtime Timeout & Fallback Elimination | Honor dynamic 5-15s timeout; overhaul `sanitizeOutput` to eliminate false-positive AI marker triggers; 0% fallback to `"在呢，怎么啦~"`. | M2 | ORIGINAL_REQUEST §R3 |
| F10 | Distillation Rhythm Latency Calibration | Eliminate minute-level 60,000ms timestamp quantization artifacts in `behavior.js`; calibrate median latency to 1.5s - 8.0s. | M1 | ORIGINAL_REQUEST §R4 |
| F11 | Dynamic Scheduler Calibration & Typing Simulation | Enforce 1.5s - 8.0s bounds in `scheduler.go`, clamp bucket medians, calibrate jitter, real-time typing status simulation in `telegram.go`. | M3 | ORIGINAL_REQUEST §R4 |
| F12 | Acceptance Testing & Regression Verification | Comprehensive test suites across `npm test` and `go test ./...`, E2E golden dataset DSI validation, zero regressions. | M4 & E2E Track | ORIGINAL_REQUEST §Acceptance Criteria |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Persona Distillation Ingestion Sanitizer, Emoji Modeling & Rhythm Calibration (F4, F5, F6, F7, F10) | Node.js `cli/ingestion/` & `cli/distillation/`: Create dedicated sanitizer, refactor language tokenization & catchphrases, fix emoji index desync and prompt bindings, clean few-shot turns, eliminate 60s rhythm quantization artifact. | none | DONE |
| M2 | Single-Pass Direct Runtime Generation & Timeout/Sanitizer Overhaul (F8, F9) | Go `server/internal/runtime/` & Node.js prompt templates: Replace 3-candidate JSON & Style Critic roundtrip with direct single-pass generation, calibrate 5-15s timeout, overhaul `sanitizeOutput` false-positives, 0% `"在呢，怎么啦~"` boilerplate. | M1 (interface contracts defined) | DONE |
| M3 | Telegram Direct Send, Burst Debounce & Latency Scheduler Calibration (F1, F2, F3, F11) | Go `server/internal/telegram/` & `server/internal/scheduler/`: Default direct send (replyToMsgID=0), 3-4s burst debounce buffer, intelligent quote-reply targeting, calibrate scheduler bounds (1.5s-8.0s), real-time typing status. | M2 | IN_PROGRESS |
| M4 | E2E Integration, Full Test Suite Verification & DSI Golden Regression (F12) | Opaque-box test suite execution, 100% pass across `npm test` and `go test ./...`, persona distillation run on test datasets with DSI validation and zero synthetic artifacts. | M1, M2, M3 | PLANNED |

---

## Interface Contracts

### 1. Distillation Persona Package ↔ Runtime Engine Contract
- **File**: `completed_result/<persona_id>/persona.json`
- **System Prompts (`system_prompts.generator`)**:
  - Must NOT contain `[CANDIDATE GENERATION CONTRACT]` producing JSON `{"candidate_a": ..., "candidate_b": ..., "candidate_c": ...}`.
  - Must contain `[DIRECT CASUAL IM DIALOGUE CONTRACT]` instructing the model to reply directly as the target persona in 1-2 short phrases or broken sentences (10-25 characters), omitting trailing periods and using natural colloquial syntax and emojis.
  - Must include contextual emoji bindings:
    `* When joking: 😂, 哈哈哈`
    `* When tired/goodnight: 😴`
    `* When cute/pleading: 🥺`
    Never fall back to generic assistant placeholder `'😊 ✨'`.
  - Must NOT contain Markdown headers (`### 2026-05-27`), `[图片]`, or group announcements (`我是群聊...`) in few-shot dialogue samples or catchphrases.
- **Rhythm Model (`rhythm.json` / `behavior.json`)**:
  - `latency_model.short.median_ms`: 1,500 – 3,000 ms.
  - `latency_model.medium.median_ms`: 3,000 – 5,500 ms.
  - `latency_model.long.median_ms`: 5,000 – 8,000 ms.
  - Response latency median: 2,000 – 4,000 ms (strictly < 10,000 ms, never 60,000 ms or 70,000 ms).

### 2. Runtime Orchestrator ↔ Telegram Service Contract
- **Method**: `orch.ProcessMessage(sessionID string, userIDStr string, messageText string) (*runtime.GenerationResult, error)`
- **Input**:
  - `messageText`: Coalesced text from burst debounce buffer (newline-separated if multi-message burst).
- **Output (`GenerationResult`)**:
  - `FinalMessage`: Natural, concise direct human response.
  - `TargetQuoteMsgID`: `int` (0 for direct send; >0 if multi-question burst or referenced turn).
  - `CriticResult`: `Status: "not_run"` (Style Critic removed from online generation path).
  - `Schedule`: Dynamic delay schedule (1.5s to 8.0s total delay).

### 3. Telegram Service ↔ Telegram Bot API Contract
- **Normal Dialogue Turns**:
  - Direct message: `sendMessage(chatID, text, 0)` -> payload omits `reply_parameters`.
- **Targeted Turns**:
  - Quote-reply message: `sendMessage(chatID, text, targetMsgID)` -> payload includes `reply_parameters: { message_id: targetMsgID }`.
- **Typing Simulation**:
  - Reading delay (silent): 25% - 35% of total delay.
  - Typing delay: 65% - 75% of total delay, refreshing `sendChatAction("typing")` every 4s.

---

## Code Layout

### Node.js CLI & Distillation Engine (`cli/`)
- `cli/ingestion/sanitize.js`: NEW dedicated ingestion sanitizer.
- `cli/ingestion/normalize.js`: Ingestion normalization calling sanitizer.
- `cli/ingestion/md.js`, `txt.js`, `json.js`, `html.js`: Parsers skipping date headers and media tokens.
- `cli/distillation/language.js`: CJK tokenization, bigrams without whitespace, catchphrases & openers/closers.
- `cli/distillation/assets.js`: Fixed turn-to-target alignment, compound emoji regex, contextual tags.
- `cli/distillation/behavior.js`: Minute quantization filter, calibrated latency buckets.
- `cli/distillation/persona.js`: Single-pass generation prompt, clean few-shot turns, contextual emoji rules.
- `cli/evaluation/runner.js`: 15s timeout, direct candidate extraction.

### Go Server & Runtime Engine (`server/`)
- `server/internal/runtime/runtime.go`: Single-pass direct generation, honest critic skip, dynamic timeout, `sanitizeOutput` overhaul.
- `server/internal/runtime/runtime_test.go`: Unit tests for single-pass generation and sanitizer precision.
- `server/internal/scheduler/scheduler.go`: Calibrated human IM bounds (1500-8000ms), median clamping.
- `server/internal/scheduler/scheduler_test.go`: Unit tests for calibrated bounds.
- `server/internal/telegram/telegram.go`: ReplyToMessage struct, direct send default, 3-4s burst debounce, quote-reply logic.
- `server/internal/telegram/telegram_test.go`: Unit tests for direct send, debounce aggregation, and quote-replying.

### Tests (`tests/`)
- `tests/ingestion/sanitizer.test.js`: Ingestion sanitizer unit tests.
- `tests/distillation/distillation.test.js`: Distillation cleanliness & emoji fidelity tests.
- `tests/distillation/rhythm.test.js`: Calibrated rhythm and minute-quantization tests.
- `tests/e2e/`: Requirement-driven E2E tests for Tiers 1-4.
