# Deployment

SpecCursor deploys the Node control plane with Docker Compose overlays on top
of the shared `docker-compose.yml` infra (Postgres, Redis). This does **not**
provision cloud accounts. Optional EKS observability lives under
`terraform/observability/` when you already have AWS credentials.

For Chaos Mesh experiments you need Kubernetes. Use the **local kind host**
documented below (and in [chaos.md](./chaos.md)) instead of inventing a cloud
cluster.

## Profiles

| Profile                      | Command                | Env file          | Overlay / target                             |
| ---------------------------- | ---------------------- | ----------------- | -------------------------------------------- |
| Local infra only             | `docker compose up -d` | `.env` (optional) | `docker-compose.yml`                         |
| Staging (Docker)             | `pnpm deploy:staging`  | `.env.staging`    | `docker-compose.staging.yml`                 |
| Production (Docker)          | `pnpm deploy:prod`     | `.env.production` | `docker-compose.prod.yml`                    |
| Staging-style + chaos (kind) | `pnpm k8s:up`          | `.env.staging`    | `infrastructure/kind` + `infrastructure/k8s` |

## Prerequisites (Docker host)

1. Docker Engine + Compose v2 (Docker Desktop on Windows/macOS is fine)
2. Copied and filled env file (never commit real secrets):

```bash
cp .env.staging.example .env.staging
# edit: POSTGRES_PASSWORD, REDIS_PASSWORD, ANTHROPIC_API_KEY,
#       GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, JWT_SECRET
```

3. Secrets must not be placeholders (`changeme`, `speccursor_dev`, …).
   `scripts/deploy.mjs` fail-closes before invoking Compose and checks that the
   Docker daemon is reachable.

### Windows notes

- Use Docker Desktop with the **Linux** engine (WSL2 backend).
- Prefer `pnpm deploy:staging` over hand-rolled `docker-compose` so overlays
  and `--env-file` stay consistent.
- If `docker info` fails, start Docker Desktop and wait until it is healthy.

## Staging (Docker Compose)

```bash
pnpm deploy:staging
# or dry-run validation only:
pnpm exec node scripts/deploy.mjs staging --dry-run

# readiness
curl -sf http://127.0.0.1:3001/ready   # controller
curl -sf http://127.0.0.1:3002/ready   # ai-service
curl -sf http://127.0.0.1:3080/ready   # github-app (host 3080 -> container 3000)
```

Tear down:

```bash
pnpm deploy:staging:down
# or:
pnpm exec node scripts/deploy.mjs staging --down
```

Observability stack (Prometheus/Grafana/…) is under Compose profile
`observability` to avoid port clashes with the github-app:

```bash
pnpm exec node scripts/deploy.mjs staging --profile observability
```

## Production (Docker Compose)

Same pathway with stricter defaults (`restart: always`, warn-level logs,
loopback-bound Postgres/Redis publish ports):

```bash
cp .env.production.example .env.production
# fill secrets — do not reuse staging passwords
pnpm deploy:prod
```

Put a reverse proxy / TLS terminator in front of ports `3001`, `3002`, and
`3080` before exposing the host to the internet. Compose alone is not a full
multi-region production platform.

## Images

| Dockerfile                                 | Image                                           | Role                                      |
| ------------------------------------------ | ----------------------------------------------- | ----------------------------------------- |
| `infrastructure/docker/Dockerfile.service` | `speccursor-{controller,ai-service,github-app}` | Node control plane (`SERVICE=` build-arg) |
| `infrastructure/docker/Dockerfile.worker`  | `speccursor-worker`                             | Rust worker HTTP process (chaos target)   |

The Node runtime entrypoint uses `tsx` because workspace packages currently
expose TypeScript `main` entrypoints.

## Local Kubernetes host (kind)

Use this when you need Chaos Mesh. It does not replace Compose for day-to-day
API work; it is the supported path for in-cluster labels and StatusChecks.

### Extra tools

| Tool                              | Purpose                             |
| --------------------------------- | ----------------------------------- |
| [kind](https://kind.sigs.k8s.io/) | Local Kubernetes cluster in Docker  |
| kubectl                           | Apply manifests / watch experiments |
| helm                              | Install pinned Chaos Mesh chart     |

### Bootstrap

```bash
# same secrets as Compose staging
cp .env.staging.example .env.staging   # if not already filled

pnpm k8s:up
# dry-run (validates env + prints plan):
pnpm exec node scripts/local-k8s.mjs up --dry-run

# readiness via kind NodePorts (see infrastructure/kind/cluster.yaml)
curl -sf http://127.0.0.1:3001/ready
curl -sf http://127.0.0.1:3002/ready
curl -sf http://127.0.0.1:3080/ready
curl -sf http://127.0.0.1:8080/health  # rust workers

pnpm k8s:status
pnpm k8s:chaos    # one-shot Chaos Mesh Workflow
pnpm k8s:down     # delete the kind cluster
```

What `pnpm k8s:up` does:

1. Creates kind cluster `speccursor` from `infrastructure/kind/cluster.yaml`
2. Installs Chaos Mesh Helm chart **2.8.3** with
   `infrastructure/k8s/chaos-mesh-values.yaml` (containerd socket for kind)
3. Builds and `kind load`s control-plane + worker images
4. Applies namespaces, secrets (from `.env.staging`), Postgres init ConfigMap,
   and workloads under `infrastructure/k8s/`

Labels match chaos experiments:

| Label                                                  | Workload                            |
| ------------------------------------------------------ | ----------------------------------- |
| `app=speccursor-worker`                                | Rust worker Deployment (2 replicas) |
| `app=speccursor-redis`                                 | Redis                               |
| `app=speccursor-postgres`                              | Postgres                            |
| Service `controller.speccursor.svc.cluster.local:3001` | StatusCheck target                  |

Script commands (also exposed as `pnpm k8s:*`):

| Command                                  | Action                                  |
| ---------------------------------------- | --------------------------------------- |
| `node scripts/local-k8s.mjs up`          | Cluster + Chaos Mesh + deploy           |
| `node scripts/local-k8s.mjs deploy`      | Rebuild/load images and apply manifests |
| `node scripts/local-k8s.mjs chaos-mesh`  | Install/upgrade Chaos Mesh only         |
| `node scripts/local-k8s.mjs apply-chaos` | Apply one-shot Workflow                 |
| `node scripts/local-k8s.mjs status`      | Pods / chaos CR status                  |
| `node scripts/local-k8s.mjs down`        | Delete kind cluster                     |

Flags: `--dry-run`, `--skip-build`, `--skip-chaos`.

## Terraform

`terraform/observability/` is optional managed observability after a cluster
already exists (typically cloud). It is not required for Compose or kind.
