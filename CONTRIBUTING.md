# Contributing to EIDOLON

Thank you for your interest in contributing to **EIDOLON — Persona Distillation & Memory Runtime**!

## Code of Conduct

All contributors are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development Setup

1. **Prerequisites**:
   - Node.js 24 LTS
   - Go 1.22+
   - AlmaLinux 9 or Linux x86_64
   - Git

2. **Clone & Install**:
   ```bash
   git clone https://github.com/ysnsk111/eidolon.git
   cd eidolon
   npm install
   ```

3. **Link CLI Locally**:
   ```bash
   npm link
   eidolon --help
   ```

4. **Run Automated Tests**:
   ```bash
   npm test
   cd server && go test ./...
   ```

## Contribution Workflow

1. Fork the repository and create a feature branch (`git checkout -b feature/distillation-metric`).
2. Implement your changes adhering to existing architectural patterns:
   - CLI commands belong in `cli/commands/`.
   - Ingestion parsers belong in `cli/ingestion/`.
   - Distillation algorithms belong in `cli/distillation/`.
   - Evaluation metrics and judge logic belong in `cli/evaluation/`.
   - Persistent Go runtime and memory engines belong in `server/internal/`.
3. Ensure comprehensive unit and integration tests are added in `tests/`.
4. Run lint and test suites:
   ```bash
   npm test
   ```
5. Submit a Pull Request with clear description, test results, and references to any issues.

## Quality Standards

- **No Stubs / No Shortcuts**: Every statistical formula (DSI, Style Distance, Memory Decay, Rhythm Latency) must be fully calculated, never mock-stubbed.
- **Strict Separation of Data**: Blind test datasets must never leak into prompt context.
- **GPL v3 Compliance**: All contributions will be licensed under GNU GPL v3.0.
