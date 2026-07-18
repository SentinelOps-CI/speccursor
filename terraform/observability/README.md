# Terraform: observability stack

This directory provisions an optional AWS/EKS-backed observability cluster
(Prometheus, Grafana, related IAM/network). It is **not** required for local
development — use `docker-compose.yml` and `infrastructure/docker/` instead.

## When to use

- Staging/production clusters that need managed observability infra.
- After control-plane services are deployable and scrape targets are known.

## When not to use

- Day-to-day local work (`docker-compose up -d`).
- CI (workflows do not apply Terraform).

## Layout

| File           | Role                                    |
| -------------- | --------------------------------------- |
| `main.tf`      | Providers, EKS, observability workloads |
| `variables.tf` | Inputs (region, subnets, tags)          |
| `outputs.tf`   | Cluster/endpoints for callers           |

Apply only with reviewed `tfvars` and least-privilege credentials. Prefer
pinning provider versions already declared in `required_providers`.
