# Tests layout

Runnable automated tests live **inside workspace packages**:

- `apps/*/src/__tests__/unit`
- `apps/*/src/__tests__/integration`
- `apps/*/src/__tests__/property`
- `packages/*/src/__tests__`

Historical trees under `tests/property/**` that imported non-existent
`UpgradeService` paths were removed. Prefer package-local Jest suites so
`pnpm test:unit` / `pnpm test:property` stay accurate.

Load and chaos assets remain under `load/` and `chaos/` and are smoke-checked
in `qualify.yml`, not executed against live clusters in CI.
