# Architecture

SpecCursor is an architecture-first monorepo for autonomous dependency upgrades,
AI-assisted regression patches, and Lean-backed formal verification workflows.

## Trust boundaries

```text
GitHub webhooks / API clients
        |
        v
  github-app  ----->  controller  ----->  workers (rust / lean)
        |                  |
        |                  +----->  ai-service (Claude)
        v
   Postgres + Redis (control-plane state and queues)
```

- **Control plane** (`apps/*`): authenticated HTTP APIs. Never execute untrusted
  build/test commands in-process.
- **Execution sandboxes** (`workers/*`): isolated upgrade/proof work.
- **Shared packages** (`packages/*`): typed contracts, config, and HTTP kernel.

## Service layering (Node apps)

Each Node service follows:

| Service                | Layer     | Responsibility                              |
| ---------------------- | --------- | ------------------------------------------- |
| `src/index.ts`         | Process   | Env, listen, shutdown only                  |
| `src/app.ts`           | Assembly  | Wire kernel + routes + adapters             |
| `src/routes/*`         | Transport | HTTP contracts, validation, status codes    |
| `src/application/*`    | Use cases | Orchestration                               |
| `src/domain/*`         | Domain    | Pure rules (e.g. dependency classification) |
| `src/infrastructure/*` | Adapters  | Postgres, Redis, Claude, Octokit            |

Cross-cutting concerns (helmet, CORS, rate limits, correlation IDs,
`/health` `/ready` `/metrics`, error envelopes) live in
`@speccursor/shared-utils` (`createHttpKernel`).

## Queues

Upgrade and analysis jobs use Redis **lists** (`LPUSH` / `RPOP`), not
timestamped keys. That keeps enqueue/dequeue O(1) and avoids `KEYS`/`SCAN`
over the keyspace.

## Pagination

List endpoints use a single SQL round-trip with `COUNT(*) OVER()` plus
`LIMIT`/`OFFSET`, backed by composite indexes on `(status, created_at)` and
`(ecosystem, created_at)`.

## Chaos

Worker fault injection experiments live under `chaos/experiments/`. See
[chaos.md](../chaos.md). CI only checks that experiment files exist.

## Local topology

`docker-compose.yml` provides Postgres, Redis, Prometheus, Grafana, Loki, and
Jaeger for local development. Staging/production overlays add the Node control
plane images — see [deployment.md](../deployment.md).

For Chaos Mesh, use the kind host (`pnpm k8s:up`) so workers carry
`app=speccursor-worker` and controller DNS matches experiment StatusChecks —
see [chaos.md](../chaos.md).
