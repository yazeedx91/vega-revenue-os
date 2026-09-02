# Phase 08: Audit & Observability

## Audit port

```ts
interface IAuditLog {
  record(ctx: CommandContext, entry: AuditRecord): Promise<void>;
}
```

Every command executed by `CommandExecutor` emits an audit record containing:

- `action`
- `resourceType`
- `resourceId`
- `result` (`success` | `denied` | `failure`)
- `reason` (error code on failure)

The `InMemoryAuditLog` test double captures records for assertions.

## Observability port

```ts
interface ITelemetry {
  span<T>(name: string, operation: () => Promise<T>): Promise<T>;
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  log(level, message, meta): void;
}
```

`CommandExecutor` wraps each command in `telemetry.span(...)`. A `NoOpTelemetry` test double is provided.

## Design rule

No concrete infrastructure adapters for audit or telemetry are implemented in Phase 08. They remain ports that will be implemented by `@projectx/infrastructure` adapters later.
