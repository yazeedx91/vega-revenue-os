# Reasoning Architecture

## Purpose

The Reasoning Engine produces auditable, structured reasoning for AI decisions without requiring exposure of raw chain-of-thought. It distinguishes facts, inferences, assumptions, predictions, and uncertainty.

## Reasoning Artifacts

| Artifact | Purpose |
|---|---|
| Decision Summary | Human-readable explanation of the decision |
| Evidence List | Sources supporting the decision |
| Inferences | Conclusions drawn from evidence |
| Assumptions | Gaps filled by assumption |
| Predictions | Forecasted outcomes |
| Uncertainties | Known unknowns and confidence |
| Confidence Score | Normalized confidence in decision |
| Policy Check | How policy was evaluated |
| Decision Rationale | Why this action vs alternatives |

## Reasoning Process

1. Gather context, evidence, memory, knowledge.
2. Identify relevant facts and sources.
3. Draw inferences with confidence.
4. Surface assumptions and predictions.
5. Evaluate options against mission/policy.
6. Select action with justification.
7. Package reasoning artifact for audit.

## Reasoning vs Chain-of-Thought

- Raw chain-of-thought is not stored or exposed by default.
- Structured reasoning artifact is the contract with the rest of the system.
- Reasoning artifact contains only what is necessary for audit, debugging, and human review.
- Private reasoning can be logged for evaluation but not used as authoritative evidence.

## Structured Reasoning Format

```json
{
  "decision": "QualifyLead",
  "summary": "The company matches ICP and shows expansion signals.",
  "evidence": [
    {"source": "ResearchAgent", "fact": "50% YoY headcount growth", "freshness": "2026-08-01", "confidence": 0.92}
  ],
  "inferences": ["Rapid growth indicates ERP scaling needs"],
  "assumptions": ["Growth is organic, not acquisition-driven"],
  "predictions": ["Likely to evaluate ERP within 6 months"],
  "uncertainties": ["Budget not publicly confirmed"],
  "confidence": 0.85,
  "policyCheck": "ALLOW at autonomy level 3",
  "rationale": "ICP score exceeds threshold and no disqualifiers present."
}
```

## Reasoning Validation

- Evidence must be attributable.
- Unsupported claims flagged.
- Confidence within expected range.
- Policy compliance verified.
- Contradictions detected.

## Security

- Reasoning artifacts do not include secrets.
- PII redacted where necessary.
- Tenant-scoped storage.
- Access controlled by role.
