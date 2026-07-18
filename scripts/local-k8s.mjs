#!/usr/bin/env node
/**
 * Local Kubernetes host for SpecCursor staging-style deploy + Chaos Mesh.
 *
 * Uses kind (Kubernetes in Docker) — no cloud accounts required.
 * Windows-friendly (Node + Docker Desktop + kind + kubectl + helm).
 *
 * Usage:
 *   node scripts/local-k8s.mjs up              # cluster + Chaos Mesh + deploy
 *   node scripts/local-k8s.mjs down            # delete kind cluster
 *   node scripts/local-k8s.mjs deploy          # build images, apply manifests
 *   node scripts/local-k8s.mjs chaos-mesh      # install/upgrade Chaos Mesh only
 *   node scripts/local-k8s.mjs status          # pods / chaos status
 *   node scripts/local-k8s.mjs apply-chaos     # one-shot resilience workflow
 *   node scripts/local-k8s.mjs up --dry-run
 *   node scripts/local-k8s.mjs deploy --skip-build
 *
 * Secrets come from .env.staging (same fail-closed rules as scripts/deploy.mjs).
 */

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const CLUSTER_NAME = 'speccursor';
const CLUSTER_CONFIG = 'infrastructure/kind/cluster.yaml';
const K8S_DIR = 'infrastructure/k8s';
const CHAOS_VALUES = 'infrastructure/k8s/chaos-mesh-values.yaml';
const CHAOS_MESH_CHART_VERSION = '2.8.3';
const ENV_FILE = '.env.staging';
const ENV_EXAMPLE = '.env.staging.example';
const INIT_SQL = 'infrastructure/docker/postgres/init.sql';
const WORKFLOW = 'chaos/experiments/worker-resilience-workflow.yaml';

const FORBIDDEN = new Set([
  'your-secret-key',
  'dev-missing-key',
  'dev-webhook-secret',
  'missing-key',
  'changeme',
  'replace-me',
  'speccursor_dev',
  'TODO',
  'FIXME',
]);

const REQUIRED_KEYS = [
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'ANTHROPIC_API_KEY',
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'JWT_SECRET',
];

const IMAGES = [
  {
    name: 'speccursor-controller:local',
    dockerfile: 'infrastructure/docker/Dockerfile.service',
    buildArgs: ['SERVICE=controller'],
  },
  {
    name: 'speccursor-ai-service:local',
    dockerfile: 'infrastructure/docker/Dockerfile.service',
    buildArgs: ['SERVICE=ai-service'],
  },
  {
    name: 'speccursor-github-app:local',
    dockerfile: 'infrastructure/docker/Dockerfile.service',
    buildArgs: ['SERVICE=github-app'],
  },
  {
    name: 'speccursor-worker:local',
    dockerfile: 'infrastructure/docker/Dockerfile.worker',
    buildArgs: [],
  },
];

function usage(code = 1) {
  console.error(`Usage: node scripts/local-k8s.mjs <command> [flags]

Commands:
  up           Create kind cluster, install Chaos Mesh, deploy SpecCursor
  down         Delete the kind cluster named "${CLUSTER_NAME}"
  deploy       Build/load images and apply SpecCursor manifests
  chaos-mesh   Install or upgrade pinned Chaos Mesh (${CHAOS_MESH_CHART_VERSION})
  status       Show cluster, SpecCursor pods, and Chaos Mesh status
  apply-chaos  Apply the one-shot worker-resilience Workflow

Flags:
  --dry-run      Print planned actions; do not mutate cluster/images
  --skip-build   On deploy/up: reuse existing local images (still kind load)
  --skip-chaos   On up: skip Chaos Mesh install

Requires: Docker Engine, kind, kubectl, helm.
Secrets: copy ${ENV_EXAMPLE} -> ${ENV_FILE} and fill real values.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === '-h' || command === '--help') usage(0);
  const flags = new Set(argv.slice(1));
  return {
    command,
    dryRun: flags.has('--dry-run'),
    skipBuild: flags.has('--skip-build'),
    skipChaos: flags.has('--skip-chaos'),
  };
}

function shell() {
  return process.platform === 'win32';
}

function run(cmd, args, { inherit = true, allowFail = false } = {}) {
  const display = [cmd, ...args].join(' ');
  console.log(`> ${display}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell: shell(),
    env: process.env,
  });
  if (result.error) {
    throw new Error(
      `Failed to run ${cmd}: ${result.error.message}. Is it installed and on PATH?`
    );
  }
  const code = result.status ?? 1;
  if (code !== 0 && !allowFail) {
    const stderr = result.stderr ? String(result.stderr).trim() : '';
    throw new Error(
      `Command failed (${code}): ${display}${stderr ? `\n${stderr}` : ''}`
    );
  }
  return {
    code,
    stdout: result.stdout ? String(result.stdout) : '',
    stderr: result.stderr ? String(result.stderr) : '',
  };
}

function requireBin(name, versionArgs = ['version']) {
  const result = spawnSync(name, versionArgs, {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: shell(),
  });
  if (result.error || (result.status ?? 1) !== 0) {
    throw new Error(
      `Required tool "${name}" is missing or not runnable. Install it and ensure it is on PATH.`
    );
  }
  return (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0];
}

function assertDocker() {
  requireBin('docker', ['version', '--format', '{{.Server.Version}}']);
  const info = spawnSync('docker', ['info'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: shell(),
  });
  if ((info.status ?? 1) !== 0) {
    throw new Error(
      'Docker Engine is not reachable. Start Docker Desktop (or your Engine) and retry.'
    );
  }
}

function assertTools({ needHelm = false } = {}) {
  assertDocker();
  requireBin('kind', ['version']);
  requireBin('kubectl', ['version', '--client', '--output=yaml']);
  if (needHelm) {
    requireBin('helm', ['version', '--short']);
  }
}

function parseEnvFile(path) {
  const map = {};
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function validateEnv(envPath) {
  if (!existsSync(envPath)) {
    throw new Error(
      `Missing ${envPath}. Copy ${ENV_EXAMPLE} and fill real secrets (never commit them).`
    );
  }
  const env = parseEnvFile(envPath);
  const missing = [];
  for (const key of REQUIRED_KEYS) {
    const value = (env[key] || '').trim();
    if (!value || FORBIDDEN.has(value)) missing.push(key);
  }
  if (missing.length) {
    throw new Error(
      `Fail-closed: incomplete or placeholder secrets in ${envPath}: ${missing.join(', ')}`
    );
  }
  env.POSTGRES_USER = (env.POSTGRES_USER || 'speccursor').trim() || 'speccursor';
  env.POSTGRES_DB = (env.POSTGRES_DB || 'speccursor').trim() || 'speccursor';
  env.DATABASE_URL = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`;
  env.REDIS_URL = `redis://:${env.REDIS_PASSWORD}@redis:6379`;
  env.LOG_LEVEL = (env.LOG_LEVEL || 'info').trim() || 'info';
  return env;
}

function clusterExists() {
  const result = spawnSync('kind', ['get', 'clusters'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: shell(),
  });
  if ((result.status ?? 1) !== 0) return false;
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .includes(CLUSTER_NAME);
}

function ensureCluster(dryRun) {
  if (clusterExists()) {
    console.log(`kind cluster "${CLUSTER_NAME}" already exists.`);
    if (!dryRun) {
      run('kind', ['export', 'kubeconfig', '--name', CLUSTER_NAME]);
      waitForApi(dryRun);
    }
    return;
  }
  const configPath = resolve(root, CLUSTER_CONFIG);
  if (!existsSync(configPath)) {
    throw new Error(`Missing kind config: ${CLUSTER_CONFIG}`);
  }
  if (dryRun) {
    console.log(`[dry-run] kind create cluster --name ${CLUSTER_NAME} --config ${CLUSTER_CONFIG}`);
    return;
  }
  run('kind', [
    'create',
    'cluster',
    '--name',
    CLUSTER_NAME,
    '--config',
    CLUSTER_CONFIG,
  ]);
  // Refresh kubeconfig (avoids stale/TLS issues across Docker Desktop restarts).
  run('kind', ['export', 'kubeconfig', '--name', CLUSTER_NAME]);
  waitForApi(dryRun);
}

function waitForApi(dryRun) {
  if (dryRun) {
    console.log('[dry-run] wait for Kubernetes API');
    return;
  }
  const deadline = Date.now() + 120_000;
  let lastErr = '';
  while (Date.now() < deadline) {
    const result = spawnSync(
      'kubectl',
      ['--context', `kind-${CLUSTER_NAME}`, 'get', 'nodes'],
      {
        cwd: root,
        encoding: 'utf8',
        shell: shell(),
        stdio: 'pipe',
      }
    );
    if ((result.status ?? 1) === 0) {
      console.log('Kubernetes API is ready.');
      return;
    }
    lastErr = (result.stderr || result.stdout || '').trim();
    spawnSync(
      process.platform === 'win32' ? 'timeout' : 'sleep',
      process.platform === 'win32' ? ['/t', '3', '/nobreak'] : ['3'],
      { stdio: 'ignore', shell: shell() }
    );
  }
  throw new Error(
    `Kubernetes API not ready after kind create. Last error: ${lastErr || 'unknown'}`
  );
}

function deleteCluster(dryRun) {
  if (!clusterExists()) {
    console.log(`kind cluster "${CLUSTER_NAME}" does not exist.`);
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] kind delete cluster --name ${CLUSTER_NAME}`);
    return;
  }
  run('kind', ['delete', 'cluster', '--name', CLUSTER_NAME]);
}

function buildImages({ dryRun, skipBuild }) {
  if (skipBuild) {
    console.log('Skipping image builds (--skip-build).');
    return;
  }
  for (const img of IMAGES) {
    const args = ['build', '-f', img.dockerfile, '-t', img.name];
    for (const ba of img.buildArgs) {
      args.push('--build-arg', ba);
    }
    args.push('.');
    if (dryRun) {
      console.log(`[dry-run] docker ${args.join(' ')}`);
      continue;
    }
    run('docker', args);
  }
}

function loadImages(dryRun) {
  for (const img of IMAGES) {
    if (dryRun) {
      console.log(
        `[dry-run] kind load docker-image ${img.name} --name ${CLUSTER_NAME}`
      );
      continue;
    }
    run('kind', ['load', 'docker-image', img.name, '--name', CLUSTER_NAME]);
  }
}

function applyNamespaces(dryRun) {
  const nsPath = resolve(root, K8S_DIR, 'namespace.yaml');
  if (dryRun) {
    console.log(`[dry-run] kubectl apply -f ${nsPath}`);
    return;
  }
  run('kubectl', ['apply', '-f', nsPath]);
}

function applyPostgresInit(dryRun) {
  const sqlPath = resolve(root, INIT_SQL);
  if (!existsSync(sqlPath)) {
    throw new Error(`Missing Postgres init SQL: ${INIT_SQL}`);
  }
  if (dryRun) {
    console.log(
      `[dry-run] kubectl apply configmap/postgres-init from ${INIT_SQL}`
    );
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'speccursor-pginit-'));
  const outPath = join(dir, 'postgres-init.yaml');
  try {
    const rendered = spawnSync(
      'kubectl',
      [
        '-n',
        'speccursor',
        'create',
        'configmap',
        'postgres-init',
        `--from-file=init.sql=${sqlPath}`,
        '--dry-run=client',
        '-o',
        'yaml',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        shell: shell(),
        stdio: 'pipe',
      }
    );
    if ((rendered.status ?? 1) !== 0) {
      throw new Error(
        `Failed to render postgres-init ConfigMap: ${rendered.stderr || rendered.stdout}`
      );
    }
    writeFileSync(outPath, rendered.stdout, 'utf8');
    run('kubectl', ['apply', '-f', outPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function normalizeSecretValue(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function yamlQuote(value) {
  // JSON string literals are valid YAML double-quoted scalars.
  return JSON.stringify(normalizeSecretValue(value));
}

function applySecrets(env, dryRun) {
  const keys = [
    'POSTGRES_USER',
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'DATABASE_URL',
    'REDIS_URL',
    'ANTHROPIC_API_KEY',
    'GITHUB_APP_ID',
    'GITHUB_PRIVATE_KEY',
    'GITHUB_WEBHOOK_SECRET',
    'JWT_SECRET',
    'LOG_LEVEL',
  ];
  if (dryRun) {
    console.log(
      '[dry-run] kubectl apply secret/speccursor-secrets (from .env.staging)'
    );
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'speccursor-k8s-'));
  const secretPath = join(dir, 'secret.yaml');
  try {
    const dataLines = keys
      .map(k => `  ${k}: ${yamlQuote(env[k] ?? '')}`)
      .join('\n');
    const doc = `apiVersion: v1
kind: Secret
metadata:
  name: speccursor-secrets
  namespace: speccursor
  labels:
    app.kubernetes.io/part-of: speccursor
type: Opaque
stringData:
${dataLines}
`;
    writeFileSync(secretPath, doc, 'utf8');
    run('kubectl', ['apply', '-f', secretPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function applyWorkloads(dryRun) {
  const kustomizeDir = resolve(root, K8S_DIR);
  if (dryRun) {
    console.log(`[dry-run] kubectl apply -k ${K8S_DIR}`);
    return;
  }
  run('kubectl', ['apply', '-k', kustomizeDir]);
}

function waitReady(dryRun) {
  if (dryRun) {
    console.log('[dry-run] kubectl -n speccursor rollout status ...');
    return;
  }
  const deployments = [
    'postgres',
    'redis',
    'controller',
    'ai-service',
    'github-app',
    'worker',
  ];
  for (const d of deployments) {
    run('kubectl', [
      '-n',
      'speccursor',
      'rollout',
      'status',
      `deployment/${d}`,
      '--timeout=300s',
    ]);
  }
}

function installChaosMesh(dryRun) {
  const values = resolve(root, CHAOS_VALUES);
  if (!existsSync(values)) {
    throw new Error(`Missing Chaos Mesh values: ${CHAOS_VALUES}`);
  }
  if (dryRun) {
    console.log(
      `[dry-run] helm repo add chaos-mesh https://charts.chaos-mesh.org`
    );
    console.log(
      `[dry-run] helm upgrade --install chaos-mesh chaos-mesh/chaos-mesh -n chaos-mesh --create-namespace --version ${CHAOS_MESH_CHART_VERSION} -f ${CHAOS_VALUES}`
    );
    return;
  }
  run('helm', ['repo', 'add', 'chaos-mesh', 'https://charts.chaos-mesh.org'], {
    allowFail: true,
  });
  run('helm', ['repo', 'update', 'chaos-mesh']);
  run('helm', [
    'upgrade',
    '--install',
    'chaos-mesh',
    'chaos-mesh/chaos-mesh',
    '--namespace',
    'chaos-mesh',
    '--create-namespace',
    '--version',
    CHAOS_MESH_CHART_VERSION,
    '-f',
    values,
    '--wait',
    '--timeout',
    '10m',
  ]);
}

function applyChaosWorkflow(dryRun) {
  const path = resolve(root, WORKFLOW);
  if (!existsSync(path)) {
    throw new Error(`Missing workflow: ${WORKFLOW}`);
  }
  if (dryRun) {
    console.log(`[dry-run] kubectl apply -f ${WORKFLOW}`);
    return;
  }
  // Ensure CRDs exist
  const crd = spawnSync(
    'kubectl',
    ['get', 'crd', 'workflows.chaos-mesh.org'],
    {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
      shell: shell(),
    }
  );
  if ((crd.status ?? 1) !== 0) {
    throw new Error(
      'Chaos Mesh CRDs not found. Run: node scripts/local-k8s.mjs chaos-mesh'
    );
  }
  run('kubectl', ['apply', '-f', path]);
  console.log('Watch: kubectl -n chaos-testing get workflow worker-resilience-drill -w');
}

function printStatus() {
  if (!clusterExists()) {
    console.log(`kind cluster "${CLUSTER_NAME}" is not running.`);
    console.log('Create it with: pnpm k8s:up');
    return;
  }
  run('kubectl', ['config', 'current-context'], { allowFail: true });
  run('kubectl', ['-n', 'speccursor', 'get', 'pods', '-o', 'wide'], {
    allowFail: true,
  });
  run(
    'kubectl',
    ['-n', 'speccursor', 'get', 'svc', 'controller', 'worker', 'postgres', 'redis'],
    { allowFail: true }
  );
  run(
    'kubectl',
    ['-n', 'chaos-mesh', 'get', 'pods', '-l', 'app.kubernetes.io/name=chaos-mesh'],
    { allowFail: true }
  );
  run(
    'kubectl',
    ['-n', 'chaos-testing', 'get', 'workflow,podchaos,networkchaos,stresschaos'],
    { allowFail: true }
  );
  console.log('\nHost readiness (kind NodePorts):');
  console.log('  curl -sf http://127.0.0.1:3001/ready   # controller');
  console.log('  curl -sf http://127.0.0.1:3002/ready   # ai-service');
  console.log('  curl -sf http://127.0.0.1:3080/ready   # github-app');
  console.log('  curl -sf http://127.0.0.1:8080/health  # worker');
}

function cmdUp(opts) {
  assertTools({ needHelm: !opts.skipChaos });
  const env = validateEnv(resolve(root, ENV_FILE));
  ensureCluster(opts.dryRun);
  if (!opts.skipChaos) {
    installChaosMesh(opts.dryRun);
  }
  buildImages(opts);
  if (!opts.dryRun && !clusterExists()) {
    throw new Error('kind cluster missing after create (unexpected).');
  }
  loadImages(opts.dryRun);
  applyNamespaces(opts.dryRun);
  applyPostgresInit(opts.dryRun);
  applySecrets(env, opts.dryRun);
  applyWorkloads(opts.dryRun);
  waitReady(opts.dryRun);
  if (!opts.dryRun) {
    console.log('\nLocal K8s host is up.');
    console.log('Next: pnpm k8s:chaos   # one-shot Chaos Mesh workflow');
    printStatus();
  }
}

function cmdDeploy(opts) {
  assertTools({ needHelm: false });
  if (!opts.dryRun && !clusterExists()) {
    throw new Error(
      `kind cluster "${CLUSTER_NAME}" not found. Run: node scripts/local-k8s.mjs up`
    );
  }
  const env = validateEnv(resolve(root, ENV_FILE));
  buildImages(opts);
  loadImages(opts.dryRun);
  applyNamespaces(opts.dryRun);
  applyPostgresInit(opts.dryRun);
  applySecrets(env, opts.dryRun);
  applyWorkloads(opts.dryRun);
  waitReady(opts.dryRun);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    switch (opts.command) {
      case 'up':
        cmdUp(opts);
        break;
      case 'down':
        assertDocker();
        requireBin('kind', ['version']);
        deleteCluster(opts.dryRun);
        break;
      case 'deploy':
        cmdDeploy(opts);
        break;
      case 'chaos-mesh':
        assertTools({ needHelm: true });
        if (!opts.dryRun && !clusterExists()) {
          throw new Error(
            `kind cluster "${CLUSTER_NAME}" not found. Run: node scripts/local-k8s.mjs up --skip-chaos`
          );
        }
        ensureCluster(opts.dryRun);
        installChaosMesh(opts.dryRun);
        break;
      case 'status':
        assertDocker();
        requireBin('kind', ['version']);
        requireBin('kubectl', ['version', '--client', '--output=yaml']);
        printStatus();
        break;
      case 'apply-chaos':
        assertTools({ needHelm: false });
        if (!opts.dryRun && !clusterExists()) {
          throw new Error(
            `kind cluster "${CLUSTER_NAME}" not found. Run: pnpm k8s:up`
          );
        }
        applyChaosWorkflow(opts.dryRun);
        break;
      default:
        console.error(`Unknown command: ${opts.command}`);
        usage(1);
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
