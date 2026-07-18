# Environment variables

Fail-closed configuration for SpecCursor Node services.

| Profile                  | How set                           | Startup behavior                                                          |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------- |
| `development`            | `APP_ENV=development` (default)   | May boot with empty optional secrets; **use sites reject** missing keys   |
| `staging` / `production` | `APP_ENV=staging` or `production` | **Process exits** if required secrets missing or equal known placeholders |

`NODE_ENV` stays Node semantics (`development` | `test` | `production`). Prefer
`APP_ENV` for SpecCursor deploy profile. If `APP_ENV` is unset, it is derived
from `NODE_ENV` when that value is `development` | `staging` | `production`.

Copy [`.env.example`](../.env.example) to `.env`, `.env.staging`, or
`.env.production`. Never commit real secrets.

## Required in staging / production

Checked by `assertServiceSecrets` in `@speccursor/shared-config` at service
startup (`create*App` / `start`).

| Variable                     | Used by                             | Notes                                                                                |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`          | `ai-service`, `scripts/ai-patch.ts` | Required to generate patches. `CLAUDE_API_KEY` is a deprecated alias.                |
| `GITHUB_APP_ID`              | `github-app`                        | Numeric GitHub App id.                                                               |
| `GITHUB_PRIVATE_KEY`         | `github-app`                        | PEM private key (literal newlines or `\n`-escaped).                                  |
| `GITHUB_WEBHOOK_SECRET`      | `github-app`                        | HMAC secret. Required whenever the webhook server boots; unsigned webhooks rejected. |
| `JWT_SECRET`                 | `github-app`                        | Must not be a placeholder (`your-secret-key`, etc.).                                 |
| `DATABASE_URL` or `DB_*`     | all apps                            | Must **not** use the local `speccursor_dev` password.                                |
| `DB_SSL`                     | all apps                            | Set `true` when talking to managed Postgres.                                         |
| `DB_SSL_REJECT_UNAUTHORIZED` | all apps                            | Defaults to verifying certs. Set `false` only for local self-signed TLS.             |
| `REDIS_URL` or `REDIS_*`     | controller, github-app              | Queue / cache.                                                                       |

Known placeholders (`your-secret-key`, `dev-missing-key`, `missing-key`,
`changeme`, …) are rejected as if the variable were empty.

## Claude Messages API

| Variable             | Default                    | Notes                 |
| -------------------- | -------------------------- | --------------------- |
| `CLAUDE_MODEL`       | `claude-sonnet-4-20250514` | Messages API model id |
| `CLAUDE_MAX_TOKENS`  | `4096`                     | Max output tokens     |
| `CLAUDE_TEMPERATURE` | `0.1`                      | Sampling temperature  |
| `CLAUDE_TIMEOUT`     | `30000`                    | Client timeout (ms)   |

SDK: `@anthropic-ai/sdk` (Messages API via `client.messages.create`).

## Optional CI secrets (GitHub Actions)

Documented honestly — missing secrets skip gated steps; they do not fake success.

| Secret              | Workflow       | Effect if missing                                       |
| ------------------- | -------------- | ------------------------------------------------------- |
| `SNYK_TOKEN`        | `qualify.yml`  | Snyk step logs skip reason and exits 0 (optional gate)  |
| `CODECOV_TOKEN`     | —              | Not required; coverage upload is not part of primary CI |
| `ANTHROPIC_API_KEY` | local / deploy | Not injected by CI for live Claude calls                |
| GitHub App secrets  | deploy         | Required on staging/prod hosts; not used by unit CI     |

## Local development

```bash
cp .env.example .env
# edit .env — at minimum set GITHUB_WEBHOOK_SECRET for github-app
export ANTHROPIC_API_KEY=sk-ant-...   # needed for live patch generation
docker compose up -d                  # postgres + redis (+ observability)
pnpm --filter @speccursor/ai-service dev
```

## Staging / production checklist

1. Set `APP_ENV=staging` or `APP_ENV=production` and `NODE_ENV=production`.
2. Provide every row in **Required in staging / production** for the services you run.
3. Confirm `/ready` returns healthy for each service after deploy.
4. Use compose overlays — see [deployment.md](./deployment.md).

There are no silent stub credentials: Octokit and Anthropic clients do not
substitute fake keys that appear to work.
