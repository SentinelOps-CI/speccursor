import { Pool } from 'pg';
import { createClient } from 'redis';
import { Logger, createHttpKernel } from '@speccursor/shared-utils';
import { assertServiceSecrets } from '@speccursor/shared-config';
import { UpgradeRepository } from './infrastructure/upgrade-repository';
import { RedisUpgradeQueue } from './infrastructure/upgrade-queue';
import { UpgradeService } from './application/upgrade-service';
import { createUpgradeRouter } from './routes/upgrades';

export interface ControllerDeps {
  logger?: Logger;
  pool?: Pool;
  redisUrl?: string;
  /** When false, skip connecting Redis (useful for tests with injected doubles). */
  connectRedis?: boolean;
  /** Skip startup secret assertion (tests with injected doubles). */
  skipSecretAssertion?: boolean;
}

export interface ControllerApp {
  app: ReturnType<typeof createHttpKernel>['app'];
  logger: Logger;
  repository: UpgradeRepository;
  queue: RedisUpgradeQueue;
  service: UpgradeService;
  redisClient: ReturnType<typeof createClient>;
  pool: Pool;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function resolveDatabaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL']?.trim();
  if (fromEnv) return fromEnv;
  return 'postgresql://speccursor:speccursor_dev@localhost:5432/speccursor';
}

export function createControllerApp(deps: ControllerDeps = {}): ControllerApp {
  const logger =
    deps.logger ?? new Logger('controller', process.env['LOG_LEVEL'] || 'info');

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

  const redisUrl =
    deps.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redisClient = createClient({ url: redisUrl });

  const repository = new UpgradeRepository(pool);
  const queue = new RedisUpgradeQueue(redisClient);
  const service = new UpgradeService(repository, queue, logger);

  const { app, errorHandler, notFoundHandler } = createHttpKernel({
    serviceName: 'controller',
    logger,
    rateLimitMax: 100,
    readinessChecks: {
      database: () => repository.healthCheck(),
      redis: () => queue.healthCheck(),
    },
  });

  app.use('/api/v1/upgrades', createUpgradeRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    logger,
    repository,
    queue,
    service,
    redisClient,
    pool,
    async start() {
      if (!deps.skipSecretAssertion) {
        assertServiceSecrets('controller');
      }
      await pool.query('SELECT 1');
      if (deps.connectRedis !== false && !redisClient.isOpen) {
        await redisClient.connect();
      }
      logger.info('Controller dependencies ready');
    },
    async stop() {
      await repository.close();
      if (redisClient.isOpen) {
        await redisClient.quit();
      }
    },
  };
}
