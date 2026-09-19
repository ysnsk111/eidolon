# Security Policy & Real-Person Boundaries

## Supported Versions

Only the latest major version of EIDOLON receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Data Ownership & Credential Protection

EIDOLON is built with a strict **Data Ownership First** architecture:

1. **No Data Leakage**:
   - Historical chat logs, private conversation records, persona definitions, and SQLite databases are classified as strictly private user assets.
   - None of these are committed to version control (`.gitignore` enforces this).
2. **Secrets Isolation**:
   - Telegram Bot tokens, OpenAI/LLM API keys, and server authentication tokens are stored exclusively in local environment files (`.env`) or user configuration directory (`~/.config/eidolon/config.json`) with `0600` file permissions.
3. **Evaluation Dataset Isolation**:
   - The blind test dataset (`test.jsonl`) generated during distillation is cryptographically separated from the persona runtime prompt context to prevent data contamination and target leakage.

## Real-Person Boundary Policy

In adherence to ethical AI principles and Section 58 of the EIDOLON specification:

- **Authorized Personas Only**:
  - `SELF`: Distilling your own conversational and linguistic patterns.
  - `CONSENTED_PERSONA`: Distilling data from individuals who have provided explicit, informed consent.
  - `FICTIONAL_CHARACTER`: Distilling fictional or creative personas from public literature/scripts.
- **No Deceptive Impersonation**:
  - EIDOLON runtimes deployed to third-party messaging networks (such as Telegram) MUST NOT misrepresent synthetic agent instances as unconsenting real persons.
- **Safety Gate**:
  - The runtime strictly rejects generation configurations that attempt to forge digital signatures or execute deceptive impersonation attacks.

## Reporting a Vulnerability

If you discover a security vulnerability within EIDOLON, please report it confidentially:

1. Email: `security@eidolon.local` or submit a private report via GitHub Security Advisories.
2. Provide detailed steps to reproduce the vulnerability, including sample payloads or configuration snippets.
3. We will acknowledge receipt within 48 hours and coordinate a patch release.
