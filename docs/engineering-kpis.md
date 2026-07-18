# Engineering KPIs

Track weekly in architecture review. Use as release go/no-go signals.

## Architecture

| Metric                      | Target                            | How to measure                                   |
| --------------------------- | --------------------------------- | ------------------------------------------------ |
| Shared HTTP kernel adoption | 100% Node services                | Review `createHttpKernel` usage in each `app.ts` |
| Layering compliance         | 100% services                     | PR checklist + `node verify-implementation.js`   |
| Bootstrap duplication       | Reduced vs pre-refactor monoliths | Diff shared-kernel usage over time               |

## Delivery (CI)

| Metric                  | Target                                         | How to measure                |
| ----------------------- | ---------------------------------------------- | ----------------------------- |
| Main pipeline pass rate | >= 95%                                         | GitHub Actions insights       |
| Median CI duration      | < 20 minutes (full), prefer < 10 for fast gate | Workflow duration trend       |
| Flaky workflow rate     | < 2% rerun-required jobs                       | Manual triage + workflow logs |

## Quality

| Metric                              | Target                                        | How to measure                        |
| ----------------------------------- | --------------------------------------------- | ------------------------------------- |
| Critical endpoint integration tests | Present for upgrades, patches, webhook domain | `pnpm test:unit` / integration suites |
| Escaped defects                     | Trending down QoQ                             | Issue labels                          |

## Security

| Metric                                  | Target                      | How to measure                                               |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| Time-to-patch critical dependency vulns | < 7 days                    | Dependabot + `pnpm security:audit`                           |
| Default secrets in non-test runtime     | Zero for production deploys | Config review; empty local defaults fail closed at use sites |
