# Chaos engineering

SpecCursor uses [Chaos Mesh](https://chaos-mesh.org) experiments under
`chaos/experiments/` to validate worker resilience. CI only asserts that
experiment YAML files exist (`qualify.yml` load-smoke job). Live injection is
**never** run in GitHub Actions.

## Experiments

| Artifact                          | Mode               | Intent                                                  |
| --------------------------------- | ------------------ | ------------------------------------------------------- |
| `worker-failure.yaml`             | Scheduled (opt-in) | Pod kill, Redis delay, Postgres loss, memory/CPU stress |
| `worker-resilience-workflow.yaml` | One-shot Workflow  | Pod failure with continuous `/ready` StatusCheck abort  |

## Steady-state hypotheses

| Experiment                | Hypothesis                                                                |
| ------------------------- | ------------------------------------------------------------------------- |
| `worker-pod-failure`      | Jobs resume from Redis lists; queue depth returns to baseline within 5m   |
| `worker-network-delay`    | Redis latency recovers; controller `/ready` stays healthy                 |
| `worker-network-loss`     | Upgrade writes stay idempotent; pool recovers without manual restart      |
| `worker-memory-pressure`  | Pressure stays bounded to one worker; node remains schedulable            |
| `worker-cpu-pressure`     | Latency degrades gracefully; other replicas absorb depth                  |
| `worker-resilience-drill` | Controller `/ready` stays 200; abortWithStatusCheck ends chaos on failure |

Each CR carries `chaos.speccursor.io/steady-state`, `abort-if`, and `rollback`
annotations for operators.

## Abort conditions (stop immediately)

- Queue depth grows unbounded for >5m after recovery
- Controller `/ready` unhealthy after the experiment window
- Duplicate upgrade rows or suspected data corruption
- Node OOM / NotReady affecting non-worker pods
- All worker replicas Unavailable

## Prerequisites

1. Chaos Mesh installed in the cluster (pinned chart **2.8.3** via
   `pnpm k8s:chaos-mesh` / `scripts/local-k8s.mjs`).
2. Namespace `chaos-testing` for experiment CRs; targets live in `speccursor`.
3. Workers labeled `app=speccursor-worker`.
4. Supporting services labeled `app=speccursor-redis` / `app=speccursor-postgres`
   when targeting network chaos toward those dependencies.
5. In-cluster Service for controller probes:
   `controller.speccursor.svc.cluster.local:3001`.
6. Metrics scraped from control-plane `/metrics` and worker health endpoints.

Compose staging (`pnpm deploy:staging`) does **not** install Chaos Mesh. Use
the local kind pathway below (or any cluster that satisfies the labels).

## Local path: zero to experiment (kind)

This is the supported path without cloud accounts. Requires Docker Desktop
(or Engine), [kind](https://kind.sigs.k8s.io/), kubectl, and helm. On Windows,
use Docker Desktop's Linux engine.

### 1. Secrets

```bash
cp .env.staging.example .env.staging
# fill real POSTGRES_PASSWORD, REDIS_PASSWORD, ANTHROPIC_API_KEY,
# GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, JWT_SECRET
```

### 2. Cluster + Chaos Mesh + SpecCursor

```bash
pnpm k8s:up
# plan only:
pnpm exec node scripts/local-k8s.mjs up --dry-run
```

This creates kind cluster `speccursor`, installs Chaos Mesh 2.8.3
(`infrastructure/k8s/chaos-mesh-values.yaml`), builds/loads images, and applies
`infrastructure/k8s/` manifests with the labels experiments expect.

### 3. Baseline

```bash
pnpm k8s:status
kubectl -n speccursor get pods -l app=speccursor-worker
kubectl -n speccursor get svc controller
curl -sf http://127.0.0.1:3001/ready
```

### 4. One-shot drill (preferred)

```bash
pnpm k8s:chaos
# equivalent:
# kubectl apply -f chaos/experiments/worker-resilience-workflow.yaml

kubectl -n chaos-testing get workflow worker-resilience-drill -w
kubectl -n chaos-testing describe workflow worker-resilience-drill
```

Pass criteria: Workflow completes successfully; StatusCheck never aborted;
workers Ready; queue depth non-increasing within 5 minutes.

### 5. Optional scheduled suite

Only after the one-shot drill passes:

```bash
kubectl apply -f chaos/experiments/worker-failure.yaml
kubectl -n chaos-testing get podchaos,networkchaos,stresschaos
```

### 6. Abort / rollback

```bash
# Workflow (auto-cleans embedded chaos when deleted)
kubectl -n chaos-testing delete workflow worker-resilience-drill

# Scheduled suite
kubectl -n chaos-testing delete -f chaos/experiments/worker-failure.yaml

# Verify recovery
kubectl -n speccursor get pods -l app=speccursor-worker
curl -sf http://127.0.0.1:3001/ready
```

### 7. Tear down the local cluster

```bash
pnpm k8s:down
```

### 8. Record

Log hypothesis outcome, abort triggers (if any), and Grafana links in the
staging change ticket. Do not leave scheduled experiments running unattended
on shared clusters.

## Staging runbook (any Kubernetes context)

If you already have a non-production kube context (not CI, not production),
the same experiment YAMLs apply. Ensure labels and Chaos Mesh match the
prerequisites above, then follow steps 3–6.

### Baseline

```bash
kubectl -n speccursor get pods -l app=speccursor-worker
kubectl -n speccursor get svc controller
curl -sf http://<controller>/ready
# capture queue depth / error rate from Grafana or Prometheus
```

### One-shot drill

```bash
kubectl apply -f chaos/experiments/worker-resilience-workflow.yaml
kubectl -n chaos-testing get workflow worker-resilience-drill -w
```

## Design notes

- Schedules are intentionally sparse (`@every 30m`–`90m`) to avoid continuous
  fault injection in shared staging clusters.
- Network chaos uses an explicit `target` selector so faults hit dependency
  paths rather than random peer traffic.
- StressChaos targets one worker pod (`mode: one`) with bounded size/load.
- Workflow StatusCheck uses `abortWithStatusCheck: true` so unhealthy
  `/ready` tears down chaos automatically.
- Embedded Workflow chaos must not set `duration` (Chaos Mesh 2.8+); use the
  template `deadline` instead (see `worker-resilience-workflow.yaml`).
- Pin Chaos Mesh via `CHAOS_MESH_CHART_VERSION` in `scripts/local-k8s.mjs`
  (currently `2.8.3`) and `infrastructure/k8s/chaos-mesh-values.yaml`.
