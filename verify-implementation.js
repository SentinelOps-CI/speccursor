#!/usr/bin/env node
/**
 * Structural verification that the layered architecture, shared kernel,
 * CI honesty artifacts, and Claude Messages client are present.
 */
const { existsSync, readFileSync, statSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname);

const required = [
  'packages/shared-utils/src/http-kernel.ts',
  'packages/shared-utils/src/index.ts',
  'packages/shared-types/src/index.ts',
  'packages/shared-types/src/ecosystem.ts',
  'packages/shared-config/src/index.ts',
  'packages/shared-config/src/secrets.ts',
  'apps/controller/src/app.ts',
  'apps/controller/src/application/upgrade-service.ts',
  'apps/controller/src/infrastructure/upgrade-repository.ts',
  'apps/controller/src/routes/upgrades.ts',
  'apps/ai-service/src/app.ts',
  'apps/ai-service/src/application/patch-service.ts',
  'apps/ai-service/src/infrastructure/claude-client.ts',
  'apps/ai-service/src/routes/patches.ts',
  'apps/github-app/src/app.ts',
  'apps/github-app/src/application/webhook-service.ts',
  'apps/github-app/src/domain/dependency.ts',
  'apps/github-app/src/infrastructure/job-queue.ts',
  'apps/github-app/src/routes/webhooks.ts',
  'docs/architecture/README.md',
  'docs/engineering-kpis.md',
  'docs/environment.md',
  'docs/deployment.md',
  'docs/ci-validation-guide.md',
  'docs/chaos.md',
  '.github/dependabot.yml',
  '.github/workflows/qualify.yml',
  '.github/workflows/speccursor.yml',
  'chaos/experiments/worker-failure.yaml',
  'chaos/experiments/worker-resilience-workflow.yaml',
  'scripts/security-audit.mjs',
  'scripts/deploy.mjs',
  'scripts/local-k8s.mjs',
  'scripts/ai-patch.ts',
  'infrastructure/docker/Dockerfile.service',
  'infrastructure/docker/Dockerfile.worker',
  'infrastructure/kind/cluster.yaml',
  'infrastructure/k8s/kustomization.yaml',
  'infrastructure/k8s/chaos-mesh-values.yaml',
  'infrastructure/k8s/worker.yaml',
  'docker-compose.staging.yml',
  'docker-compose.prod.yml',
  '.env.example',
  '.env.staging.example',
  '.env.production.example',
];

const missing = required.filter(rel => !existsSync(resolve(root, rel)));

if (missing.length) {
  console.error('Architecture verification failed. Missing:');
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

const primaryCi = resolve(root, '.github/workflows/speccursor.yml');
if (statSync(primaryCi).size < 64) {
  console.error(
    'Architecture verification failed: .github/workflows/speccursor.yml is empty or truncated.'
  );
  process.exit(1);
}

const primaryCiBody = readFileSync(primaryCi, 'utf8');
if (
  !primaryCiBody.includes('pnpm install') ||
  !primaryCiBody.includes('verify-implementation')
) {
  console.error(
    'Architecture verification failed: speccursor.yml must run install + architecture verify.'
  );
  process.exit(1);
}

const claudeClient = readFileSync(
  resolve(root, 'apps/ai-service/src/infrastructure/claude-client.ts'),
  'utf8'
);
if (!claudeClient.includes('messages.create')) {
  console.error(
    'Architecture verification failed: claude-client must use Messages API (messages.create).'
  );
  process.exit(1);
}
if (claudeClient.includes('completions.create')) {
  console.error(
    'Architecture verification failed: claude-client still references completions.create.'
  );
  process.exit(1);
}

const qualify = readFileSync(
  resolve(root, '.github/workflows/qualify.yml'),
  'utf8'
);
if (qualify.includes("cache: 'npm'") || qualify.includes('leanchecker')) {
  console.error(
    'Architecture verification failed: qualify.yml still contains npm-cache or leanchecker theater.'
  );
  process.exit(1);
}

const webhookRoute = readFileSync(
  resolve(root, 'apps/github-app/src/routes/webhooks.ts'),
  'utf8'
);
if (/:\s*JSON\.stringify\(req\.body\)/.test(webhookRoute)) {
  console.error(
    'Architecture verification failed: webhook HMAC must not fall back to JSON.stringify(req.body).'
  );
  process.exit(1);
}

const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');
if (
  packageJson.includes('deploy:staging": "echo') ||
  packageJson.includes('deploy:prod": "echo')
) {
  console.error(
    'Architecture verification failed: deploy scripts must not be stub echo/exit failures.'
  );
  process.exit(1);
}
if (
  !packageJson.includes('"k8s:up"') ||
  !packageJson.includes('scripts/local-k8s.mjs')
) {
  console.error(
    'Architecture verification failed: package.json must wire k8s:up to scripts/local-k8s.mjs.'
  );
  process.exit(1);
}

const localK8s = readFileSync(resolve(root, 'scripts/local-k8s.mjs'), 'utf8');
if (
  localK8s.includes('exit 1; // TODO') ||
  localK8s.includes('throw new Error("not implemented")')
) {
  console.error(
    'Architecture verification failed: local-k8s.mjs must not be a placeholder stub.'
  );
  process.exit(1);
}
if (
  !localK8s.includes('CHAOS_MESH_CHART_VERSION') ||
  !localK8s.includes('speccursor-worker')
) {
  console.error(
    'Architecture verification failed: local-k8s.mjs must pin Chaos Mesh and load worker images.'
  );
  process.exit(1);
}

const workerManifest = readFileSync(
  resolve(root, 'infrastructure/k8s/worker.yaml'),
  'utf8'
);
if (!workerManifest.includes('app: speccursor-worker')) {
  console.error(
    'Architecture verification failed: worker manifest must label app=speccursor-worker for chaos.'
  );
  process.exit(1);
}

const secretsMod = readFileSync(
  resolve(root, 'packages/shared-config/src/secrets.ts'),
  'utf8'
);
if (
  !secretsMod.includes('assertServiceSecrets') ||
  !secretsMod.includes('FORBIDDEN_SECRET_PLACEHOLDERS')
) {
  console.error(
    'Architecture verification failed: shared-config secrets module incomplete.'
  );
  process.exit(1);
}

console.log(
  `Architecture verification passed (${required.length} paths + content checks).`
);
