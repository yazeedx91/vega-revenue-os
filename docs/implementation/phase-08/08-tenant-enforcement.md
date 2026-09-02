# Phase 08: Tenant Enforcement

## Principles

Every aggregate, command, query, and event is scoped to a tenant. Cross-tenant access is treated as a security error.

## Tenant identity

`TenantId` is a branded string in `@projectx/shared`. All IDs are produced via `asTenantId(...)` factories to prevent accidental mixing of raw strings.

## Tenant context

`TenantContext` is propagated through repositories and commands. The application layer passes the tenant from the authenticated request.

## Enforcement points

- `requireTenant(context)` – asserts a tenant is present.
- `ensureSameTenant(tenantId, context)` – throws `TenantIsolationError` on mismatch.
- `AggregateRoot` constructor requires `tenantId`.
- `Actor` carries its own tenant scope and is validated against command context where applicable.
- In-memory repositories key aggregates as `${tenantId}:${aggregateId}` and throw `TenantIsolationError` if the stored tenant does not match the request context.

## Multi-tenancy in tests

Tests verify that a query/command for `tenant-2` cannot retrieve data owned by `tenant-1`.
