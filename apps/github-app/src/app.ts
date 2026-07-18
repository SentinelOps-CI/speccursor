import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { Webhooks } from '@octokit/webhooks';
import {
  Logger,
  Database,
  Redis,
  createHttpKernel,
} from '@speccursor/shared-utils';
import {
  ConfigManager,
  assertServiceSecrets,
  isDeployedEnvironment,
  isUsableSecret,
  listMissingOptionalDevSecrets,
} from '@speccursor/shared-config';
import { WebhookProcessingService } from './application/webhook-service';
import { RedisJobQueue } from './infrastructure/job-queue';
import { createTriggerRouter, createWebhookRouter } from './routes/webhooks';

export interface GitHubAppDeps {
  logger?: Logger;
  configManager?: ConfigManager;
  database?: Database;
  redis?: Redis;
  skipExternalConnect?: boolean;
  /** Skip startup secret assertion (tests with injected doubles). */
  skipSecretAssertion?: boolean;
}

export interface GitHubApp {
  app: ReturnType<typeof createHttpKernel>['app'];
  logger: Logger;
  database: Database;
  redis: Redis;
  service: WebhookProcessingService;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function resolveWebhookSecret(githubConfig: { webhookSecret: string }): string {
  const fromConfig = githubConfig.webhookSecret?.trim() ?? '';
  const fromEnv =
    process.env['GITHUB_WEBHOOK_SECRET']?.trim() ||
    process.env['WEBHOOK_SECRET']?.trim() ||
    '';
  const secret = fromConfig || fromEnv;
  if (!isUsableSecret(secret)) {
    throw new Error(
      'GITHUB_WEBHOOK_SECRET is required (fail-closed). Set it in the environment; ' +
        'unsigned webhooks are rejected. See docs/environment.md.'
    );
  }
  return secret;
}

function createOctokitFactory(githubConfig: {
  appId: number | null;
  privateKey: string;
}): () => Promise<Octokit> {
  const appId = githubConfig.appId;
  const privateKey = githubConfig.privateKey?.trim() ?? '';

  if (appId == null || !isUsableSecret(privateKey)) {
    return async () => {
      throw new Error(
        'GitHub App credentials not configured (fail-closed): set GITHUB_APP_ID and GITHUB_PRIVATE_KEY'
      );
    };
  }

  const appAuth = createAppAuth({
    appId,
    privateKey,
  });

  return async () => {
    const auth = await appAuth({ type: 'app' });
    return new Octokit({ auth: auth.token });
  };
}

export function createGitHubApp(deps: GitHubAppDeps = {}): GitHubApp {
  if (!deps.skipSecretAssertion) {
    assertServiceSecrets('github-app');
  }

  const configManager = deps.configManager ?? new ConfigManager();
  const config = configManager.getAppConfig();
  const githubConfig = configManager.getGitHubConfig();

  const logger =
    deps.logger ??
    new Logger('github-app', config.monitoring?.logLevel || 'info');

  if (!deps.skipSecretAssertion && !isDeployedEnvironment()) {
    const optional = listMissingOptionalDevSecrets('github-app');
    if (optional.length > 0) {
      logger.warn(
        `GitHub credentials incomplete; API calls will fail closed: ${optional.join(', ')}`
      );
    }
  }

  const database = deps.database ?? new Database(config.database, logger);
  const redis = deps.redis ?? new Redis(config.redis, logger);

  const webhookSecret = resolveWebhookSecret(githubConfig);
  const webhooks = new Webhooks({
    secret: webhookSecret,
  });

  const queue = new RedisJobQueue(redis, logger);
  const service = new WebhookProcessingService(
    queue,
    {
      createOctokit: createOctokitFactory(githubConfig),
    },
    logger
  );

  const { app, errorHandler, notFoundHandler } = createHttpKernel({
    serviceName: 'github-app',
    logger,
    rateLimitMax: 1000,
    corsOrigins:
      process.env.NODE_ENV === 'production'
        ? ['https://github.com', 'https://api.github.com']
        : true,
    readinessChecks: {
      database: () => database.healthCheck(),
      redis: () => redis.healthCheck(),
    },
  });

  app.use(
    '/webhook',
    createWebhookRouter(webhooks, service, logger, webhookSecret)
  );
  app.use('/trigger', createTriggerRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    logger,
    database,
    redis,
    service,
    async start() {
      if (!deps.skipExternalConnect) {
        await redis.connect();
        await database.healthCheck();
      }
      logger.info('GitHub App dependencies ready');
    },
    async stop() {
      await redis.disconnect();
      await database.close();
    },
  };
}
