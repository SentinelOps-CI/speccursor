# SpecCursor

Autonomous dependency upgrades, AI-powered regression patches, and formal
verification using Lean 4.20.0.

## What is in this repository

- **Apps (`apps/`)**
  - `controller` — upgrade orchestration API
  - `ai-service` — AI patch generation API
  - `github-app` — GitHub webhook and manual trigger API
- **Shared packages (`packages/`)**
  - `@speccursor/shared-types` — contracts and schemas
  - `@speccursor/shared-config` — typed configuration
  - `@speccursor/shared-utils` — logger, infra clients, HTTP kernel
- **Workers (`workers/`)**
  - `rust-worker` — execution worker
  - `lean-engine` — Lean/Mathlib proof workspace
- **Ops**
  - `docker-compose.yml` — local Postgres, Redis, observability stack
  - `docker-compose.staging.yml` / `prod` — control-plane overlays (`pnpm deploy:*`)
  - `infrastructure/kind` + `infrastructure/k8s` — local kind host for Chaos Mesh (`pnpm k8s:*`)
  - `.github/workflows` — CI
  - `docs/` — architecture, CI guide, KPIs, RFCs

## Core engineering principles

- Layered service boundaries: `routes -> application -> infrastructure` with
  bootstrap in `index.ts` and assembly in `app.ts`
- Shared cross-cutting concerns centralized in `@speccursor/shared-utils`
  (`createHttpKernel`)
- Fail-closed AI/GitHub secrets: empty local defaults do not invent production
  credentials
- O(1) Redis job queues (lists), accurate SQL pagination with `COUNT(*)`

## Quick start

```bash
# Prerequisites: Node 18+, pnpm 8.15+
pnpm install

# Optional local infra
docker-compose up -d

# Staging-style control plane on Docker Desktop
# (requires filled .env.staging — see docs/deployment.md)
# pnpm deploy:staging

# Local kind cluster + Chaos Mesh (requires kind, kubectl, helm)
# pnpm k8s:up && pnpm k8s:chaos

# Verify architecture layout
pnpm verify

# Typecheck and tests
pnpm type-check
pnpm test:unit
```

### Service ports (defaults)

| Service    | Port                                |
| ---------- | ----------------------------------- |
| controller | 3001                                |
| ai-service | 3002                                |
| github-app | from `PORT` / config (default 3000) |

## Documentation

- [Architecture](docs/architecture/README.md)
- [Environment variables](docs/environment.md)
- [Deployment](docs/deployment.md)
- [CI validation guide](docs/ci-validation-guide.md)
- [Chaos experiments](docs/chaos.md)
- [Engineering KPIs](docs/engineering-kpis.md)
- [RFC template](docs/rfcs/0001-template.md)
- [ADR: shared HTTP kernel](docs/rfcs/0002-shared-http-kernel.md)

## Security

```bash
pnpm security:audit
```

Dependabot is configured in `.github/dependabot.yml` for npm, Cargo, Actions,
and Docker. CodeQL uses `security/codeql-config.yml` with GitHub
`security-extended` and `security-and-quality` suites.

## License

MIT — see [LICENSE](LICENSE).
