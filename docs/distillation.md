# Distillation Pipeline & Mathematical Models

## Distillation vs Prompt Engineering

In EIDOLON, persona distillation is defined as:

> «Extracting computable linguistic, behavioral, contextual, and memory representations from historical dialogue, and repeatedly verifying style consistency against historical ground truth through offline blind benchmarks.»

## Distillation Layers

### Layer 1: Language Fingerprint
Calculates real mathematical distributions rather than subjective descriptions:
- **Message Length Distribution**: Median, Mean, P90, Standard Deviation.
- **Punctuation Rates**:
  - $\text{EllipsisRate} = \frac{N_{\text{ellipsis}}}{N_{\text{messages}}}$
  - $\text{QuestionRate} = \frac{N_{\text{questions}}}{N_{\text{messages}}}$
  - $\text{TerminalDropRate} = \frac{N_{\text{terminal\_punctuation\_omitted}}}{N_{\text{messages}}}$
- **Vocabulary & N-Grams**: Unigrams, bigrams, trigrams, and frequent catchphrase detection.

### Layer 2: Conditional Style
Evaluates conditional probability $P(\text{feature} \mid \text{context})$:
- $P(\text{emoji} \mid \text{joking})$
- $P(\text{emoji} \mid \text{serious})$
- $P(\text{ellipsis} \mid \text{uncertainty})$
- $P(\text{short\_message} \mid \text{greeting})$
- $P(\text{long\_message} \mid \text{explanation})$

### Layer 3: Response Behavior
Maps conversational situations to concrete strategies:
- `user_teasing` $\to$ `playful_return`
- `user_question_fact` $\to$ `direct_answer`
- `user_venting_negative` $\to$ `emotional_acknowledgment`
- `user_burst_messages` $\to$ `short_selective_reply`

### Layer 4: Conversation Rhythm
Calculates latency distribution based on typing speed and message length:
$$\text{TypingDuration} = \text{CharCount} \times \frac{60000}{\text{CPM}}$$
$$\text{Delay} = \text{clamp}(\text{BaseDelay} + \text{LengthFactor} + \text{ComplexityFactor} + \text{RandomJitter})$$

### Layer 5: Emoji & Sticker Assets
Maintains discrete asset models with context bindings:
```json
{
  "asset": "😂",
  "frequency": 0.18,
  "contexts": ["joking", "agreement"],
  "confidence": 0.94
}
```

### Layer 6: World Model & Context Supplement
Context files (`--context world.md`) are strictly separated from conversation history. The system builds an entity-relationship-event knowledge graph with strict provenance:
- `source: "supplied_context"`
- `source: "historical_conversation"`
