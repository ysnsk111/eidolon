# 4-Layer Memory Engine Specification

## Hierarchy

```
L0 Working Memory (Circular turn buffer)
       ↓
L1 Episodic Memory (Salient events, emotional peaks)
       ↓
L2 Semantic Memory (Preferences, traits, versioned facts)
       ↓
L3 World & Timeline (Milestones, environment states)
```

## Memory Save Pipeline

1. **New Message Ingestion**: Captures incoming and outgoing dialog turns.
2. **Fact & Event Extraction**: Identifies preferences, changes, and milestones.
3. **Importance Scoring**:
   $$\text{Score} = \text{Imp} \times 0.30 + \text{Rec} \times 0.15 + \text{Freq} \times 0.15 + \text{RelImpact} \times 0.15 + \text{FutureRel} \times 0.15 + \text{Conf} \times 0.10$$
4. **Conflict Resolution**:
   Uses versioned temporal facts:
   ```json
   {
     "key": "user_preference_music",
     "versions": [
       { "value": "Pop", "valid_from": "2026-01-01", "valid_to": "2026-06-01" },
       { "value": "Rock", "valid_from": "2026-06-01", "valid_to": null }
     ]
   }
   ```
5. **Persistence**: Saved to SQLite database with index on `persona_id` and `layer`.

## Context & Historical Example Retrieval

During generation, the memory engine retrieves only:
- Current dialogue buffer (L0)
- High-importance active episodes (L1)
- Active versioned facts (L2)
- Nearest historical conversation example matching current context semantics (few-shot demonstration)
