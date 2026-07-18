#!/usr/bin/env node
/**
 * SpecCursor staging / production deploy via Docker Compose overlays.
 *
 * Usage:
 *   node scripts/deploy.mjs staging
 *   node scripts/deploy.mjs prod
 *   node scripts/deploy.mjs staging --down
 *   node scripts/deploy.mjs staging --dry-run
 *   node scripts/deploy.mjs staging --profile observability
 *
 * Does not invent cloud credentials. Requires Docker + Compose v2 and a
 * filled .env.staging / .env.production (see *.example files).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PROFILES = {
  staging: {
    envFile: '.env.staging',
    example: '.env.staging.example',
    overlay: 'docker-compose.staging.yml',
    appEnv: 'staging',
  },
  prod: {
    envFile: '.env.production',
    example: '.env.production.example',
    overlay: 'docker-compose.prod.yml',
    appEnv: 'production',
  },
};

PROFILES.production = PROFILES.prod;

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

function usage(code = 1) {
  console.error(`Usage: node scripts/deploy.mjs <staging|prod> [--down] [--dry-run] [--profile NAME]

Env files:
  staging -> .env.staging   (from .env.staging.example)
  prod    -> .env.production (from .env.production.example)
`);
  process.exit(code);
}

function parseArgs(argv) {
  const target = argv[0];
  if (!target || target === '-h' || target === '--help') usage(0);
  const profile = PROFILES[target];
  if (!profile) {
    console.error(`Unknown target: ${target}`);
    usage(1);
  }
  const rest = argv.slice(1);
  return {
    target,
    profile,
    down: rest.includes('--down'),
    dryRun: rest.includes('--dry-run'),
    composeProfiles: collectProfiles(rest),
  };
}

function collectProfiles(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      out.push(args[++i]);
    }
  }
  return out;
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

function validateEnv(envPath, appEnv) {
  if (!existsSync(envPath)) {
    throw new Error(
      `Missing ${envPath}. Copy the example file and fill real secrets (never commit them).`
    );
  }
  const env = parseEnvFile(envPath);
  const missing = [];

  for (const key of REQUIRED_KEYS) {
    const value = (env[key] || '').trim();
    if (!value || FORBIDDEN.has(value)) {
      missing.push(key);
    }
  }

  if ((env.APP_ENV || '').trim() && env.APP_ENV !== appEnv) {
    console.warn(
      `Warning: ${envPath} has APP_ENV=${env.APP_ENV}; compose forces APP_ENV=${appEnv}.`
    );
  }

  if (missing.length) {
    throw new Error(
      `Fail-closed: incomplete or placeholder secrets in ${envPath}: ${missing.join(', ')}`
    );
  }

  return env;
}

function assertDockerRunning() {
  const info = spawnSync('docker', ['info'], {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (info.error) {
    throw new Error(
      `Docker CLI is not available (${info.error.message}). Install Docker Desktop or Engine and ensure "docker" is on PATH.`
    );
  }
  if ((info.status ?? 1) !== 0) {
    const detail = (info.stderr || info.stdout || '').trim();
    throw new Error(
      `Docker Engine is not reachable. Start Docker Desktop (Linux engine) and retry.${detail ? `\n${detail}` : ''}`
    );
  }
}

function runCompose(args, { dryRun, envFile }) {
  const cmd = [
    'docker',
    'compose',
    '-f',
    'docker-compose.yml',
    '-f',
    args.overlay,
    '--env-file',
    envFile,
    ...args.extra,
  ];
  console.log(`> ${cmd.join(' ')}`);
  if (dryRun) {
    console.log('Dry run only — compose not executed.');
    return 0;
  }
  assertDockerRunning();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  return result.status ?? 1;
}

function main() {
  const { profile, down, dryRun, composeProfiles } = parseArgs(
    process.argv.slice(2)
  );
  const envPath = resolve(root, profile.envFile);
  const examplePath = resolve(root, profile.example);

  if (!existsSync(resolve(root, profile.overlay))) {
    console.error(`Missing overlay ${profile.overlay}`);
    process.exit(1);
  }
  if (!existsSync(examplePath)) {
    console.error(`Missing example ${profile.example}`);
    process.exit(1);
  }

  try {
    validateEnv(envPath, profile.appEnv);
  } catch (err) {
    console.error(err.message || err);
    console.error(`Template: ${profile.example}`);
    process.exit(1);
  }

  const profileFlags = composeProfiles.flatMap(p => ['--profile', p]);
  const services = [
    'postgres',
    'redis',
    'controller',
    'ai-service',
    'github-app',
  ];

  if (down) {
    const code = runCompose(
      {
        overlay: profile.overlay,
        extra: [...profileFlags, 'down', '--remove-orphans'],
      },
      { dryRun, envFile: profile.envFile }
    );
    process.exit(code);
  }

  const code = runCompose(
    {
      overlay: profile.overlay,
      extra: [
        ...profileFlags,
        'up',
        '-d',
        '--build',
        '--remove-orphans',
        ...services,
      ],
    },
    { dryRun, envFile: profile.envFile }
  );

  if (code === 0 && !dryRun) {
    console.log(`Deploy ${profile.appEnv} requested. Check readiness:`);
    console.log('  curl -sf http://127.0.0.1:3001/ready');
    console.log('  curl -sf http://127.0.0.1:3002/ready');
    console.log('  curl -sf http://127.0.0.1:3080/ready');
  }
  process.exit(code);
}

main();
