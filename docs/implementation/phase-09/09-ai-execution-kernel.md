# Phase 09 — AI Execution Kernel

## Scope

Phase 09 turns the AI Execution Plane interfaces into an executable, testable, policy-controlled runtime. The runtime is deliberately bounded: it does not implement full revenue workflows, live CRM integrations, or real LLM/tool providers. Instead it provides deterministic fake adapters and in-memory test doubles so that every gate can be exercised without live credentials.

## Deliverables

- **Agent Executor** (`packages/ai-runtime/src/agent-executor/`)
  - `AgentExecutor` implements `IAgentExecutor` and orchestrates the full execution pipeline.
  - Enforces tenant isolation, agent lifecycle, capability checks, and policy evaluation.
  - Calls the reasoning engine, decision engine, and output validator.
  - Delegates tool calls to the tool executor and checkpoints state after transitions.
- **Planner** (`packages/ai-runtime/src/planner/`)
  - `MissionPlanner` decomposes a `MissionContract` into phases and tasks based on configurable templates.
  - Verifies required capabilities exist in the available agent pool.
- **Reasoning Engine** (`packages/ai-runtime/src/reasoning/`)
  - `LLMBasedReasoningEngine` turns an LLM completion into structured `ReasoningOutput`.
  - Supports JSON reasoning payloads and free-text fallback.
  - Surfaces proposed actions and model usage back to the executor.
- **Decision Engine** (`packages/ai-runtime/src/decision/`)
  - `PolicyAwareDecisionEngine` translates policy outcomes, confidence thresholds, autonomy level, and risk category into `ALLOW`, `REQUIRE_APPROVAL`, or `DENY`.
- **Context Assembler** (`packages/ai-runtime/src/context-assembler/`)
  - `ContextAssembler` builds tenant-scoped `PromptContext` from execution request, memory, and knowledge.
- **LLM Router** (`packages/ai-runtime/src/llm-client/`)
  - `LLMRouter` routes completions to the correct provider by model family and provider fallback.
  - Provider contract is abstracted behind `ILLMProvider`.
- **Tool Executor** (`packages/ai-runtime/src/tool-client/`)
  - `ToolExecutor` enforces authorization, expiry, tenant isolation, retry classification, and idempotency telemetry before delegating to a gateway.
- **Output Validator** (`packages/ai-runtime/src/output-validator/`)
  - `StructuredOutputValidator` checks required fields, forbidden values, allowed actions, PII patterns, and tenant isolation.
- **Memory / Knowledge Retrievers** (`packages/ai-runtime/src/memory/`, `packages/ai-runtime/src/knowledge/`)
  - In-memory test doubles with tenant-scoped retrieval and authorization filtering.
- **Execution State & Checkpointing** (`packages/ai-runtime/src/execution-state/`)
  - `ExecutionState` tracks status, budget consumption, tool history, and failures.
  - `InMemoryCheckpointStore` persists snapshots for recovery and observability.
- **Test Doubles** (`packages/ai-runtime/src/test-doubles/`)
  - `FakeAgentRegistry`, `FakeLLMProvider`, `FakePolicyClient`, `FakeToolGateway`, and `NoOpTelemetry` enable deterministic unit and integration tests.

## Out of Scope

- Full lead-generation, outreach, email, LinkedIn, or meeting-booking workflows.
- Live Dynamics 365, external email, calendar, or LinkedIn integrations.
- Real LLM provider credentials or network calls.
- Persistent vector/knowledge stores (only in-memory test doubles).

## Architectural Rules

- The Control Plane is authoritative: agent contracts, capabilities, and policies originate from `IAgentRegistry` and `IPolicyClient`.
- Tenant context is enforced at every boundary (`ensureSameTenant`).
- No tool runs without an `ALLOW` policy decision and unexpired authorization.
- Retry decisions are classified explicitly; policy denials never retry.
- Telemetry spans, histograms, and logs are emitted for lookups, policy evaluation, LLM calls, tool calls, and validation.
