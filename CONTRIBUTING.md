# Contributing

## Branch and PR expectations

1. Keep services layered (`routes` / `application` / `infrastructure`).
2. Prefer shared HTTP kernel helpers over copying Express bootstrap.
3. Add or update route/use-case tests for behavior changes.
4. Run before opening a PR:

```bash
pnpm install
pnpm verify
pnpm type-check
pnpm test:unit
pnpm security:audit
```

5. Significant design changes go through an RFC under `docs/rfcs/`.

## Commit style

Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …).
