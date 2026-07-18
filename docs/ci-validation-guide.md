# SpecCursor CI Validation Guide

## Pipelines

| Workflow                                                                  | Role                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`.github/workflows/speccursor.yml`](../.github/workflows/speccursor.yml) | Fast primary gate: verify, format, lint, type-check, tests, audit; optional Rust/Lean jobs |
| [`.github/workflows/qualify.yml`](../.github/workflows/qualify.yml)       | Extended qualification: Node 18/20 matrix, workers, Trivy, load/chaos smoke                |

Both workflows are aligned to **repository reality** (pnpm workspace apps/packages; Rust under `workers/rust-worker`; Lean under `workers/lean-engine`). There is no root `go.mod` or `requirements.txt`. The primary workflow must remain non-empty; `pnpm verify` fails if it is truncated.

## Local quick gate

```bash
pnpm install
pnpm verify
pnpm type-check
pnpm test:unit
pnpm test:property
pnpm security:audit
```

## Secrets policy

| Secret                                                           | Required where                             | Honesty rule                                                      |
| ---------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                              | Staging/prod `ai-service`; local patch CLI | CI does not invent a key. Live Claude is out of band.             |
| `GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` | Staging/prod `github-app`                  | Required at process boot when `APP_ENV` is staging/production.    |
| `JWT_SECRET`                                                     | Staging/prod `github-app`                  | Placeholders rejected.                                            |
| `SNYK_TOKEN`                                                     | Optional (`qualify.yml`)                   | Step skipped with an explicit log when absent — never fake-green. |
| `CODECOV_TOKEN`                                                  | Not used                                   | Coverage upload removed from primary CI.                          |

Full variable reference: [environment.md](./environment.md). Deploy profiles:
[deployment.md](./deployment.md).

## Claude Messages API

Patch generation uses `@anthropic-ai/sdk` Messages API (`client.messages.create`).
Default model: `claude-sonnet-4-20250514` (`CLAUDE_MODEL`).
CLI: `pnpm ai-patch -- --original file.ts --failure fail.txt --ecosystem node`
