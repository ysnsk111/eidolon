# E2E Test Infra: EIDOLON Human Simulation

## Test Philosophy
- Opaque-box, requirement-driven. Derived from `ORIGINAL_REQUEST.md` specifications.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Interaction + Real-World Workloads.
- Pass/Fail Semantics: 100% test pass with exit code 0.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | F1: Telegram Direct Send | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | F2: Burst Message Debounce | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | F3: Contextual Quote-Reply | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | F4: Ingestion Sanitizer | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 5 | F5: Distillation Language & Catchphrases | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | F6: Emoji Contextual Modeling | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 7 | F7: Few-Shot Turn Selection | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 8 | F8: Single-Pass Direct Runtime Generation | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 9 | F9: Timeout & Fallback Elimination | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 10 | F10: Distillation Latency Calibration | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 11 | F11: Dynamic Scheduler & Typing Simulation | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 12 | F12: Acceptance Criteria & Regression | ORIGINAL_REQUEST §AC | 5 | 5 | ✓ |

## Test Architecture
- E2E Test Suites Location: `tests/e2e/`
- Node.js Test Execution: `node --test tests/**/*.test.js`
- Go Test Execution: `cd server && go test -v ./...`
- Test Output: Standard TAP / subtest format, asserting exit code 0 and all assertions passing.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Rapid 3-Message Burst Greeting | F1, F2, F8, F11 | High |
| 2 | Multi-Question Burst with Contextual Quote-Reply | F1, F2, F3, F8 | High |
| 3 | Contaminated Raw Chat Log Ingestion to Distilled Persona | F4, F5, F6, F7, F10 | High |
| 4 | Direct Single-Pass Dialogue with Emotional Contextual Emoji | F6, F8, F9, F11 | High |
| 5 | Minute-Quantized Timestamp Rhythm to Calibrated Telegram Delay | F10, F11 | Medium |
| 6 | End-to-End Persona Distillation & Live Chat Turn Simulation | F1, F2, F4, F6, F8, F10, F11 | High |

## Coverage Thresholds
- Tier 1 (Feature Coverage): ≥5 tests per feature (60 tests minimum)
- Tier 2 (Boundary & Corner Cases): ≥5 tests per feature (60 tests minimum)
- Tier 3 (Cross-Feature Combinations): ≥12 pairwise scenario tests
- Tier 4 (Real-World Scenarios): ≥6 realistic end-to-end workload tests
- Total E2E test target: ≥138 test cases across Node and Go suites
