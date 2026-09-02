# AI Security

## Threat Model

| Threat | Description | Defense |
|---|---|---|
| Prompt Injection | Attacker input alters system behavior | Input validation, system prompt hardening, output parsing, least privilege |
| Indirect Prompt Injection | Malicious external content retrieved as context | Sanitize retrieved data, source allowlists, content isolation |
| Tool Injection | Attacker causes unauthorized tool use | Tool allowlist, input schema validation, policy enforcement |
| Memory Poisoning | Corrupt long-term memory | Write validation, anomaly detection, human feedback loop, versioning |
| Knowledge Poisoning | Corrupt knowledge base | Source validation, provenance, confidence, human curation |
| Data Exfiltration | AI leaks sensitive data | No raw memory in outputs, output filtering, tenant isolation, audit |
| Cross-Tenant Leakage | AI includes another tenant's data | Tenant-scoped context, per-tenant vector collections, RLS |
| Privilege Escalation | Agent gains unauthorized capabilities | Capability registry, policy enforcement, no self-elevation |
| Unsafe Autonomous Actions | AI takes disallowed action | Action risk engine, policy, approvals, tool gateway |
| Social Engineering | AI manipulated via conversation | Human escalation, policy, output validation |
| Malicious Tool Results | Tool output exploits agent | Output validation, sandboxing, schema checks |

## Input Defenses

- Treat all user/external input as untrusted.
- Escape/sanitize before inclusion in prompts.
- Use structured output parsing; reject malformed outputs.
- Do not expose system prompts to users.
- Validate against injection patterns.

## Tool Use Defenses

- Tool registry with strict allowlist.
- Tool input/output schemas.
- Policy evaluation before tool call.
- Output validation after tool call.
- No tool can access another tenant's resources.
- Tool descriptions cannot be altered by user input.

## Memory and Knowledge Defenses

- Write validation.
- Importance and confidence thresholds.
- Anomaly detection on updates.
- Tenant-scoped retrieval.
- Versioning and audit.
- Human correction path.

## Output Defenses

- Structured output schema validation.
- PII detection and redaction.
- No credential or secret disclosure.
- Citation requirements for factual claims.
- Content policy filters.

## Cross-Tenant Defenses

- Tenant ID in every context assembly step.
- Per-tenant vector collections or filters.
- Database RLS.
- Cache keys include tenant.
- Object storage paths include tenant.
- No shared prompts across tenants.

## AI Security Testing

- Red teaming prompt injection.
- Adversarial test cases for tool abuse.
- Cross-tenant leakage tests.
- Data exfiltration tests.
- Output validation tests.
- Regular security reviews.
