# Distillation Similarity Index (DSI) & Offline Evaluation

## The Blind Benchmark Protocol

The primary breakthrough in EIDOLON v1.0 is **data isolation**:
- Historical chat records are split into Distillation Set (70%), Validation Set (15%), and Blind Test Set (15%).
- The ground truth responses in the Blind Test Set are NEVER provided to the persona prompt context during generation.
- Candidate generation is tested strictly under blind conditions.

## The 5 Core Dimensions

1. **L: Lexical Similarity (Weight: 20%)**
   Measures token choice, n-gram distribution overlap, catchphrase adherence, and character length proportionality.

2. **S: Structural Style Similarity (Weight: 20%)**
   Measures punctuation rates (ellipsis, question marks, exclamations, tildes), terminal drop rate, line breaks, and emoji density.

3. **B: Behavioral Similarity (Weight: 25%)**
   Evaluates situational strategy matching (e.g. playful when teased, empathic when venting, concise during message bursts). Highest weight in the system.

4. **C: Contextual Consistency (Weight: 15%)**
   Verifies worldline consistency, entity relationships, and absence of hallucinations contradicting supplied background.

5. **H: Independent Blind Judge (Weight: 20%)**
   A pairwise blind comparison where Candidate A and Candidate B (one ground truth, one generated) are evaluated by an independent judge model with randomized assignment.

## DSI Formula

$$\text{DSI} = L \times 0.20 + S \times 0.20 + B \times 0.25 + C \times 0.15 + H \times 0.20$$

## Acceptance Gate

A persona release passes only if:
- $\text{DSI} \ge 0.80$
- $\text{Context Fidelity} \ge 0.90$
- $\text{Behavior Similarity} \ge 0.75$
- $\text{Style Similarity} \ge 0.80$
- $\text{Lexical Similarity} \ge 0.80$
- Zero critical memory conflicts
- Zero evaluation dataset leakage
