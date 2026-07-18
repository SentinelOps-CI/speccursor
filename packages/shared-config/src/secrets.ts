/**
 * Fail-closed secret resolution and startup checks for SpecCursor services.
 *
 * Development may boot with empty optional secrets and reject at use sites.
 * Staging and production refuse to start when required secrets are missing
 * or equal known placeholder values.
 */

export type SpecCursorService = 'ai-service' | 'github-app' | 'controller';

export type RuntimeEnvironment =
  | 'development'
  | 'staging'
  | 'production'
  | 'test';

/** Values that must never be treated as real credentials. */
export const FORBIDDEN_SECRET_PLACEHOLDERS: readonly string[] = [
  'your-secret-key',
  'dev-missing-key',
  'dev-webhook-secret',
  'missing-key',
  'changeme',
  'replace-me',
  'TODO',
  'FIXME',
  'xxx',
  'placeholder',
] as const;

export class MissingSecretsError extends Error {
  readonly missing: readonly string[];
  readonly service: SpecCursorService;

  constructor(service: SpecCursorService, missing: string[]) {
    super(
      `[${service}] Missing or invalid required secrets (fail-closed): ${missing.join(', ')}. ` +
        'See docs/environment.md and .env.example.'
    );
    this.name = 'MissingSecretsError';
    this.service = service;
    this.missing = missing;
  }
}

/**
 * Resolve deploy environment. Prefer APP_ENV; map NODE_ENV when APP_ENV unset.
 * NODE_ENV=test stays test (Jest). NODE_ENV=production with APP_ENV=staging
 * remains staging.
 */
export function resolveRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env
): RuntimeEnvironment {
  const appEnv = (env['APP_ENV'] || '').trim().toLowerCase();
  if (
    appEnv === 'development' ||
    appEnv === 'staging' ||
    appEnv === 'production' ||
    appEnv === 'test'
  ) {
    return appEnv;
  }

  const nodeEnv = (env['NODE_ENV'] || 'development').trim().toLowerCase();
  if (nodeEnv === 'test') return 'test';
  if (nodeEnv === 'staging') return 'staging';
  if (nodeEnv === 'production') return 'production';
  return 'development';
}

export function isDeployedEnvironment(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const runtime = resolveRuntimeEnvironment(env);
  return runtime === 'staging' || runtime === 'production';
}

export function isBlank(value: string | undefined | null): boolean {
  return value == null || value.trim() === '';
}

export function isForbiddenPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return FORBIDDEN_SECRET_PLACEHOLDERS.some(
    p => p.toLowerCase() === normalized
  );
}

/** True when a secret is present and not a known fake placeholder. */
export function isUsableSecret(value: string | undefined | null): boolean {
  if (isBlank(value)) return false;
  return !isForbiddenPlaceholder(value as string);
}

/**
 * Canonical Anthropic key. Prefer ANTHROPIC_API_KEY; accept CLAUDE_API_KEY
 * as a deprecated alias for older configs.
 */
export function resolveAnthropicApiKey(
  env: NodeJS.ProcessEnv = process.env
): string {
  const primary = env['ANTHROPIC_API_KEY']?.trim() ?? '';
  if (primary) return primary;
  return env['CLAUDE_API_KEY']?.trim() ?? '';
}

function requireSecret(
  missing: string[],
  name: string,
  value: string | undefined | null
): void {
  if (!isUsableSecret(value)) {
    missing.push(name);
  }
}

function hasDatabaseConfig(env: NodeJS.ProcessEnv): boolean {
  if (isUsableSecret(env['DATABASE_URL'])) return true;
  return (
    !isBlank(env['DB_HOST']) &&
    !isBlank(env['DB_NAME']) &&
    !isBlank(env['DB_USER']) &&
    isUsableSecret(env['DB_PASSWORD'])
  );
}

function hasRedisConfig(env: NodeJS.ProcessEnv): boolean {
  if (!isBlank(env['REDIS_URL'])) return true;
  return !isBlank(env['REDIS_HOST']);
}

/**
 * Service-specific required secrets for staging/production startup.
 * Development/test: returns [] (use-site fail-closed still applies).
 */
export function requiredSecretsForService(
  service: SpecCursorService,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (!isDeployedEnvironment(env)) {
    return [];
  }

  const missing: string[] = [];

  if (!hasDatabaseConfig(env)) {
    missing.push('DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD)');
  }

  // Reject docker-compose local password in deployed environments.
  const dbUrl = env['DATABASE_URL'] ?? '';
  const dbPassword = env['DB_PASSWORD'] ?? '';
  if (dbUrl.includes('speccursor_dev') || dbPassword === 'speccursor_dev') {
    missing.push(
      'DATABASE_URL/DB_PASSWORD must not use the local docker-compose default (speccursor_dev)'
    );
  }

  switch (service) {
    case 'ai-service':
      requireSecret(missing, 'ANTHROPIC_API_KEY', resolveAnthropicApiKey(env));
      break;
    case 'github-app':
      requireSecret(missing, 'GITHUB_APP_ID', env['GITHUB_APP_ID']);
      requireSecret(missing, 'GITHUB_PRIVATE_KEY', env['GITHUB_PRIVATE_KEY']);
      requireSecret(
        missing,
        'GITHUB_WEBHOOK_SECRET',
        env['GITHUB_WEBHOOK_SECRET'] || env['WEBHOOK_SECRET']
      );
      if (!hasRedisConfig(env)) {
        missing.push('REDIS_URL (or REDIS_HOST)');
      }
      requireSecret(missing, 'JWT_SECRET', env['JWT_SECRET']);
      break;
    case 'controller':
      if (!hasRedisConfig(env)) {
        missing.push('REDIS_URL (or REDIS_HOST)');
      }
      break;
    default: {
      const _exhaustive: never = service;
      throw new Error(`Unknown service: ${_exhaustive}`);
    }
  }

  return missing;
}

/**
 * Throw MissingSecretsError when staging/production secrets are incomplete.
 * Safe to call from every service `start()` / `main()`.
 */
export function assertServiceSecrets(
  service: SpecCursorService,
  env: NodeJS.ProcessEnv = process.env
): void {
  const missing = requiredSecretsForService(service, env);
  if (missing.length > 0) {
    throw new MissingSecretsError(service, missing);
  }
}

/**
 * Development helper: warn (via returned list) when secrets that will be
 * needed at use sites are absent. Does not throw.
 */
export function listMissingOptionalDevSecrets(
  service: SpecCursorService,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (isDeployedEnvironment(env)) {
    return requiredSecretsForService(service, env);
  }

  const missing: string[] = [];
  switch (service) {
    case 'ai-service':
      if (!isUsableSecret(resolveAnthropicApiKey(env))) {
        missing.push('ANTHROPIC_API_KEY');
      }
      break;
    case 'github-app':
      if (!isUsableSecret(env['GITHUB_APP_ID'])) missing.push('GITHUB_APP_ID');
      if (!isUsableSecret(env['GITHUB_PRIVATE_KEY'])) {
        missing.push('GITHUB_PRIVATE_KEY');
      }
      if (
        !isUsableSecret(env['GITHUB_WEBHOOK_SECRET'] || env['WEBHOOK_SECRET'])
      ) {
        missing.push('GITHUB_WEBHOOK_SECRET');
      }
      break;
    case 'controller':
      break;
    default: {
      const _exhaustive: never = service;
      throw new Error(`Unknown service: ${_exhaustive}`);
    }
  }
  return missing;
}
