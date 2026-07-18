#!/usr/bin/env node
/**
 * Runs ecosystem-specific security audits only when manifests exist.
 * Avoids hard failures from `cargo audit` / `go list` when those trees
 * are absent or tooling is not installed on the local machine.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.warn(`Skipping ${cmd}: ${result.error.message}`);
    return;
  }
  if (result.status !== 0 && result.status !== null) {
    process.exit(result.status);
  }
}

const rustManifest = resolve(root, 'workers', 'rust-worker', 'Cargo.toml');
if (existsSync(rustManifest)) {
  const cargoAudit = spawnSync('cargo', ['audit', '--version'], {
    shell: process.platform === 'win32',
  });
  if (cargoAudit.status === 0) {
    run('cargo', ['audit'], resolve(root, 'workers', 'rust-worker'));
  } else {
    console.warn('cargo-audit not installed; skipping Rust audit');
  }
}

const goMod = resolve(root, 'go.mod');
if (existsSync(goMod)) {
  run('go', ['list', '-json', '-deps', './...'], root);
}
