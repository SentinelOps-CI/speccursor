import { Pool } from 'pg';
import { Logger, createHttpKernel } from '@speccursor/shared-utils';
import {
  assertServiceSecrets,
  listMissingOptionalDevSecrets,
  resolveAnthropicApiKey,
} from '@speccursor/shared-config';
import { PatchRepository } from './infrastructure/patch-repository';
import { AnthropicPatchClient } from './infrastructure/claude-client';
import { PatchService } from './application/patch-service';
import { createPatchRouter } from './routes/patches';
import type { ClaudePatchClient } from './infrastructure/claude-client';

export interface AiServiceDeps {
  logger?: Logger;
  pool?: Pool;
  claude?: ClaudePatchClient;
  /** Skip startup secret assertion (tests with injected doubles). */
  skipSecretAssertion?: boolean;
}

export interface AiServiceApp {
  app: ReturnType<typeof createHttpKernel>['app'];
  logger: Logger;
  repository: PatchRepository;
  service: PatchService;
  pool: Pool;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function resolveDatabaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL']?.trim();
  if (fromEnv) return fromEnv;
  // Local docker-compose default only — staging/production assertServiceSecrets rejects it.
  return 'postgresql://speccursor:speccursor_dev@localhost:5432/speccursor';
}

export function createAiServiceApp(deps: AiServiceDeps = {}): AiServiceApp {
  const logger =
    deps.logger ?? new Logger('ai-service', process.env['LOG_LEVEL'] || 'info');

  const pool =
    deps.pool ??
    new Pool({
      connectionString: resolveDatabaseUrl(),
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
      options: '-c search_path=speccursor,public',
      ssl:
        process.env['DB_SSL'] === 'true'
          ? {
              rejectUnauthorized:
                process.env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false',
            }
          : undefined,
    });

  const repository = new PatchRepository(pool);
  const claude = deps.claude ?? new AnthropicPatchClient(logger);
  const service = new PatchService(repository, claude, logger);

  const { app, errorHandler, notFoundHandler } = createHttpKernel({
    serviceName: 'ai-service',
    logger,
    rateLimitMax: 50,
    readinessChecks: {
      database: () => repository.healthCheck(),
    },
  });

  app.use('/api/v1/patches', createPatchRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    logger,
    repository,
    service,
    pool,
    async start() {
      if (!deps.skipSecretAssertion) {
        assertServiceSecrets('ai-service');
        const optional = listMissingOptionalDevSecrets('ai-service');
        if (optional.length > 0) {
          logger.warn(
            `Optional secrets missing (patch generation will fail closed): ${optional.join(', ')}`
          );
        }
      }
      await pool.query('SELECT 1');
      if (!resolveAnthropicApiKey()) {
        logger.warn(
          'ANTHROPIC_API_KEY not set; AI patch generation will fail closed at request time'
        );
      }
      logger.info('AI service dependencies ready');
    },
    async stop() {
      await repository.close();
    },
  };
}
