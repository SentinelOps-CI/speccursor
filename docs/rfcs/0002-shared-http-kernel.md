# ADR 0002: Shared HTTP Kernel and Layered Services

- **Status**: Accepted
- **Date**: 2026-07-17

## Context

Node services duplicated Express bootstrap (helmet, CORS, rate limits, health,
metrics, error envelopes). Entry points mixed transport, use cases, and
infrastructure, which blocked meaningful tests and created drift.

## Decision

1. Centralize HTTP bootstrap in `@speccursor/shared-utils` via `createHttpKernel`
   and `listenAndServe`.
2. Structure each app as `index.ts` (process) / `app.ts` (assembly) /
   `routes` / `application` / `infrastructure`.
3. Prefer Redis list queues (`LPUSH`/`RPOP`) for jobs and a single
   `COUNT(*) OVER()` + `LIMIT` pagination query for list endpoints.
4. Fail closed on webhook HMAC when `rawBody` is missing — never re-serialize
   `req.body` for signature checks.

## Consequences

- Lower bootstrap duplication and consistent observability endpoints.
- Route/use-case tests can mount real routers with in-memory doubles.
- New endpoints must not reintroduce monolithic `index.ts` handlers.
