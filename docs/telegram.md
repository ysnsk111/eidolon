# Telegram Runtime & Bot Policy

## Zero Streaming Policy

In strict adherence to human imitation principles:
- **NO SSE**
- **NO HTTP chunked streaming**
- **NO sendMessageDraft**
- **NO partial tokens display**

The bot executes complete generation, applies Style Critic and Rewriter checks, schedules typing animation, and dispatches a single complete message.

## User Allowlist

Only authorized user IDs specified via CLI are processed:
```bash
eidolon bot user add 8287471787
eidolon bot user list
```
All unauthorized users sending messages to the bot are silently ignored. No management commands are exposed inside Telegram.

## Human-like Response Scheduler

- Simulates realistic typing speed based on character count and typing CPM.
- Adds random Gaussian jitter to mimic authentic pause variations.
- Supports conversational burst double-messaging.
