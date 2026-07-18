import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import convict from 'convict';
import { z } from 'zod';
import {
  AppConfig,
  DatabaseConfig,
  RedisConfig,
  ClaudeConfig,
  LeanConfig,
  SecurityConfig,
  MonitoringConfig,
} from '@speccursor/shared-types';
import { resolveAnthropicApiKey } from './secrets';

// ============================================================================
// Environment Loading
// ============================================================================

export function loadEnvironment(): void {
  // Load .env file if it exists
  const env = dotenv.config();
  if (env.error) {
    console.warn('No .env file found, using environment variables');
  } else {
    dotenvExpand.expand(env);
  }

  // APP_ENV is the SpecCursor deploy profile; NODE_ENV stays Node semantics.
  if (!process.env['APP_ENV']) {
    const nodeEnv = (process.env['NODE_ENV'] || '').toLowerCase();
    if (
      nodeEnv === 'development' ||
      nodeEnv === 'staging' ||
      nodeEnv === 'production'
    ) {
      process.env['APP_ENV'] = nodeEnv;
    } else {
      process.env['APP_ENV'] = 'development';
    }
  }

  // Prefer canonical Anthropic env for convict's claude.apiKey field.
  if (!process.env['CLAUDE_API_KEY'] && process.env['ANTHROPIC_API_KEY']) {
    process.env['CLAUDE_API_KEY'] = process.env['ANTHROPIC_API_KEY'];
  }
}

// ============================================================================
// Configuration Schema
// ============================================================================

export const configSchema = convict({
  // Application
  app: {
    port: {
      doc: 'The port the server should bind to',
      format: 'port',
      default: 3000,
      env: 'PORT',
    },
    environment: {
      doc: 'Deploy profile (development | staging | production)',
      format: ['development', 'staging', 'production'],
      default: 'development',
      env: 'APP_ENV',
    },
    logLevel: {
      doc: 'The logging level',
      format: ['error', 'warn', 'info', 'debug'],
      default: 'info',
      env: 'LOG_LEVEL',
    },
  },

  // Database
  database: {
    host: {
      doc: 'Database host',
      format: String,
      default: 'localhost',
      env: 'DB_HOST',
    },
    port: {
      doc: 'Database port',
      format: 'port',
      default: 5432,
      env: 'DB_PORT',
    },
    name: {
      doc: 'Database name',
      format: String,
      default: 'speccursor',
      env: 'DB_NAME',
    },
    username: {
      doc: 'Database username',
      format: String,
      default: 'speccursor',
      env: 'DB_USER',
    },
    password: {
      doc: 'Database password',
      format: String,
      default: 'speccursor_dev',
      sensitive: true,
      env: 'DB_PASSWORD',
    },
    ssl: {
      doc: 'Use SSL for database connection',
      format: Boolean,
      default: false,
      env: 'DB_SSL',
    },
    maxConnections: {
      doc: 'Maximum database connections',
      format: 'int',
      default: 10,
      env: 'DB_MAX_CONNECTIONS',
    },
    idleTimeout: {
      doc: 'Database connection idle timeout in seconds',
      format: 'int',
      default: 300,
      env: 'DB_IDLE_TIMEOUT',
    },
  },

  // Redis
  redis: {
    host: {
      doc: 'Redis host',
      format: String,
      default: 'localhost',
      env: 'REDIS_HOST',
    },
    port: {
      doc: 'Redis port',
      format: 'port',
      default: 6379,
      env: 'REDIS_PORT',
    },
    password: {
      doc: 'Redis password',
      format: String,
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD',
    },
    db: {
      doc: 'Redis database number',
      format: 'int',
      default: 0,
      env: 'REDIS_DB',
    },
    keyPrefix: {
      doc: 'Redis key prefix',
      format: String,
      default: 'speccursor:',
      env: 'REDIS_KEY_PREFIX',
    },
  },

  // Claude AI
  claude: {
    apiKey: {
      doc: 'Anthropic API key (set ANTHROPIC_API_KEY; CLAUDE_API_KEY is alias)',
      format: String,
      default: '',
      sensitive: true,
      env: 'CLAUDE_API_KEY',
    },
    model: {
      doc: 'Claude model to use',
      format: String,
      default: 'claude-sonnet-4-20250514',
      env: 'CLAUDE_MODEL',
    },
    maxTokens: {
      doc: 'Maximum tokens for Claude requests',
      format: 'int',
      default: 4096,
      env: 'CLAUDE_MAX_TOKENS',
    },
    temperature: {
      doc: 'Temperature for Claude requests',
      format: Number,
      default: 0.1,
      env: 'CLAUDE_TEMPERATURE',
    },
    timeout: {
      doc: 'Claude API timeout in milliseconds',
      format: 'int',
      default: 30000,
      env: 'CLAUDE_TIMEOUT',
    },
  },

  // Lean Engine
  lean: {
    version: {
      doc: 'Lean version to use',
      format: String,
      default: '4.20.0',
      env: 'LEAN_VERSION',
    },
    timeoutSeconds: {
      doc: 'Lean execution timeout in seconds',
      format: 'int',
      default: 300,
      env: 'LEAN_TIMEOUT',
    },
    memoryLimitMb: {
      doc: 'Lean memory limit in MB',
      format: 'int',
      default: 2048,
      env: 'LEAN_MEMORY_LIMIT',
    },
    mathlibPath: {
      doc: 'Path to Mathlib4',
      format: String,
      default: '/usr/local/lib/lean',
      env: 'LEAN_MATHLIB_PATH',
    },
  },

  // Security
  security: {
    sandboxEnabled: {
      doc: 'Enable sandboxed execution',
      format: Boolean,
      default: true,
      env: 'SANDBOX_ENABLED',
    },
    maxExecutionTime: {
      doc: 'Maximum execution time in seconds',
      format: 'int',
      default: 600,
      env: 'MAX_EXECUTION_TIME',
    },
    memoryLimit: {
      doc: 'Memory limit for sandboxed processes',
      format: String,
      default: '2GB',
      env: 'MEMORY_LIMIT',
    },
    allowedCommands: {
      doc: 'Allowed commands in sandbox',
      format: Array,
      default: [],
      env: 'ALLOWED_COMMANDS',
    },
    jwtSecret: {
      doc: 'JWT secret for token signing (required in staging/production)',
      format: String,
      default: '',
      sensitive: true,
      env: 'JWT_SECRET',
    },
    webhookSecret: {
      doc: 'GitHub webhook secret',
      format: String,
      default: '',
      sensitive: true,
      env: 'WEBHOOK_SECRET',
    },
  },

  // Monitoring
  monitoring: {
    metricsEnabled: {
      doc: 'Enable metrics collection',
      format: Boolean,
      default: true,
      env: 'METRICS_ENABLED',
    },
    tracingEnabled: {
      doc: 'Enable distributed tracing',
      format: Boolean,
      default: true,
      env: 'TRACING_ENABLED',
    },
    prometheusPort: {
      doc: 'Prometheus metrics port',
      format: 'port',
      default: 9090,
      env: 'PROMETHEUS_PORT',
    },
    jaegerEndpoint: {
      doc: 'Jaeger tracing endpoint',
      format: String,
      default: '',
      env: 'JAEGER_ENDPOINT',
    },
  },

  // GitHub
  github: {
    appId: {
      doc: 'GitHub App ID',
      format: (val: unknown) => {
        if (val === null || val === undefined || val === '') return;
        const n = typeof val === 'number' ? val : Number(val);
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error('must be a positive integer when set');
        }
      },
      default: null,
      env: 'GITHUB_APP_ID',
    },
    privateKey: {
      doc: 'GitHub App private key',
      format: String,
      default: '',
      sensitive: true,
      env: 'GITHUB_PRIVATE_KEY',
    },
    webhookSecret: {
      doc: 'GitHub webhook secret',
      format: String,
      default: '',
      sensitive: true,
      env: 'GITHUB_WEBHOOK_SECRET',
    },
  },
});

// ============================================================================
// Configuration Validation
// ============================================================================

export const configValidationSchema = z.object({
  app: z.object({
    port: z.number().min(1).max(65535),
    environment: z.enum(['development', 'staging', 'production']),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  }),
  database: z.object({
    host: z.string().min(1),
    port: z.number().min(1).max(65535),
    name: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    ssl: z.boolean(),
    maxConnections: z.number().min(1).max(100),
    idleTimeout: z.number().min(1).max(3600),
  }),
  redis: z.object({
    host: z.string().min(1),
    port: z.number().min(1).max(65535),
    password: z.string().nullable().or(z.literal('')),
    db: z.number().min(0).max(15),
    keyPrefix: z.string(),
  }),
  claude: z.object({
    apiKey: z.string(), // empty allowed at boot
    model: z.string().min(1),
    maxTokens: z.number().min(1).max(100000),
    temperature: z.number().min(0).max(2),
    timeout: z.number().min(1000).max(300000),
  }),
  lean: z.object({
    version: z.string().min(1),
    timeoutSeconds: z.number().min(1).max(3600),
    memoryLimitMb: z.number().min(128).max(8192),
    mathlibPath: z.string().min(1),
  }),
  security: z.object({
    sandboxEnabled: z.boolean(),
    maxExecutionTime: z.number().min(1).max(3600),
    memoryLimit: z.string().min(1),
    allowedCommands: z.array(z.string()),
    jwtSecret: z.string(), // empty allowed locally; assertServiceSecrets in deploy
    webhookSecret: z.string(), // empty allowed locally
  }),
  monitoring: z.object({
    metricsEnabled: z.boolean(),
    tracingEnabled: z.boolean(),
    prometheusPort: z.number().min(1).max(65535),
    jaegerEndpoint: z.string().nullable().or(z.literal('')),
  }),
  github: z.object({
    appId: z.number().nullable(),
    privateKey: z.string(),
    webhookSecret: z.string(),
  }),
});

// ============================================================================
// Configuration Manager
// ============================================================================

export class ConfigManager {
  // Convict's deep generics blow the TS instantiation limit; keep runtime typed via Zod.
  private config: any;
  private validated: boolean = false;

  constructor() {
    loadEnvironment();
    this.config = configSchema;
    this.validate();
  }

  private validate(): void {
    try {
      this.config.validate({ allowed: 'strict' });

      // Additional validation with Zod
      const configData = this.config.getProperties();
      configValidationSchema.parse(configData);

      this.validated = true;
    } catch (error) {
      console.error('Configuration validation failed:', error);
      if (process.env.NODE_ENV === 'test') {
        throw error;
      }
      process.exit(1);
    }
  }

  getAppConfig(): AppConfig {
    if (!this.validated) {
      throw new Error('Configuration not validated');
    }

    // Convict generics can explode TS instantiation depth; read via properties bag.
    const props = this.config.getProperties() as Record<string, any>;
    const db = props.database;
    const redis = props.redis;
    const claude = props.claude;
    const lean = props.lean;
    const security = props.security;
    const monitoring = props.monitoring;
    const app = props.app;

    return {
      port: app.port,
      environment: app.environment,
      database: {
        host: db.host,
        port: db.port,
        database: db.name,
        username: db.username,
        password: db.password,
        ssl: db.ssl,
        maxConnections: db.maxConnections,
        idleTimeout: db.idleTimeout,
      },
      redis: {
        host: redis.host,
        port: redis.port,
        password: redis.password || undefined,
        db: redis.db,
        keyPrefix: redis.keyPrefix,
      },
      claude: {
        apiKey: claude.apiKey,
        model: claude.model,
        maxTokens: claude.maxTokens,
        temperature: claude.temperature,
        timeout: claude.timeout,
      },
      lean: {
        version: lean.version,
        timeoutSeconds: lean.timeoutSeconds,
        memoryLimitMb: lean.memoryLimitMb,
        mathlibPath: lean.mathlibPath,
      },
      security: {
        sandboxEnabled: security.sandboxEnabled,
        maxExecutionTime: security.maxExecutionTime,
        memoryLimit: security.memoryLimit,
        allowedCommands: security.allowedCommands,
      },
      monitoring: {
        metricsEnabled: monitoring.metricsEnabled,
        tracingEnabled: monitoring.tracingEnabled,
        logLevel: app.logLevel,
        prometheusPort: monitoring.prometheusPort,
        jaegerEndpoint: monitoring.jaegerEndpoint || undefined,
      },
    };
  }

  getDatabaseConfig(): DatabaseConfig {
    const db = this.config.get('database');
    return {
      host: db.host,
      port: db.port,
      database: db.name,
      username: db.username,
      password: db.password,
      ssl: db.ssl,
      maxConnections: db.maxConnections,
      idleTimeout: db.idleTimeout,
    };
  }

  getRedisConfig(): RedisConfig {
    const redis = this.config.get('redis');
    return {
      host: redis.host,
      port: redis.port,
      password: redis.password || undefined,
      db: redis.db,
      keyPrefix: redis.keyPrefix,
    };
  }

  getClaudeConfig(): ClaudeConfig {
    const claude = this.config.get('claude');
    const apiKey = resolveAnthropicApiKey() || (claude.apiKey as string) || '';
    return {
      apiKey,
      model: claude.model,
      maxTokens: claude.maxTokens,
      temperature: claude.temperature,
      timeout: claude.timeout,
    };
  }

  getLeanConfig(): LeanConfig {
    const lean = this.config.get('lean');
    return {
      version: lean.version,
      timeoutSeconds: lean.timeoutSeconds,
      memoryLimitMb: lean.memoryLimitMb,
      mathlibPath: lean.mathlibPath,
    };
  }

  getSecurityConfig(): SecurityConfig {
    const security = this.config.get('security');
    return {
      sandboxEnabled: security.sandboxEnabled,
      maxExecutionTime: security.maxExecutionTime,
      memoryLimit: security.memoryLimit,
      allowedCommands: security.allowedCommands,
    };
  }

  getMonitoringConfig(): MonitoringConfig {
    const monitoring = this.config.get('monitoring');
    return {
      metricsEnabled: monitoring.metricsEnabled,
      tracingEnabled: monitoring.tracingEnabled,
      logLevel: this.config.get('app.logLevel'),
      prometheusPort: monitoring.prometheusPort,
      jaegerEndpoint: monitoring.jaegerEndpoint || undefined,
    };
  }

  getGitHubConfig() {
    const github = this.config.get('github');
    const rawId = github.appId;
    const appId =
      rawId === null || rawId === undefined || rawId === ''
        ? null
        : Number(rawId);
    return {
      appId: Number.isFinite(appId) && appId! > 0 ? appId : null,
      privateKey: github.privateKey || '',
      webhookSecret: github.webhookSecret || '',
    };
  }

  get(key: string): any {
    return this.config.get(key);
  }

  isDevelopment(): boolean {
    return this.config.get('app.environment') === 'development';
  }

  isProduction(): boolean {
    return this.config.get('app.environment') === 'production';
  }

  isStaging(): boolean {
    return this.config.get('app.environment') === 'staging';
  }
}

// ============================================================================
// Environment-Specific Configuration
// ============================================================================

export function getEnvironmentConfig(): Record<string, any> {
  const env = process.env.NODE_ENV || 'development';

  const baseConfig = {
    app: {
      port: 3000,
      environment: env,
      logLevel: 'info',
    },
    database: {
      host: 'localhost',
      port: 5432,
      name: 'speccursor',
      username: 'speccursor',
      password: 'speccursor_dev',
      ssl: false,
      maxConnections: 10,
      idleTimeout: 300,
    },
    redis: {
      host: 'localhost',
      port: 6379,
      password: null,
      db: 0,
      keyPrefix: 'speccursor:',
    },
    claude: {
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.1,
      timeout: 30000,
    },
    lean: {
      version: '4.20.0',
      timeoutSeconds: 300,
      memoryLimitMb: 2048,
      mathlibPath: '/usr/local/lib/lean',
    },
    security: {
      sandboxEnabled: true,
      maxExecutionTime: 600,
      memoryLimit: '2GB',
      allowedCommands: [],
      jwtSecret: '',
      webhookSecret: '',
    },
    monitoring: {
      metricsEnabled: true,
      tracingEnabled: true,
      prometheusPort: 9090,
      jaegerEndpoint: '',
    },
    github: {
      appId: null,
      privateKey: '',
      webhookSecret: '',
    },
  };

  switch (env) {
    case 'production':
      return {
        ...baseConfig,
        app: {
          ...baseConfig.app,
          logLevel: 'warn',
        },
        database: {
          ...baseConfig.database,
          ssl: true,
          maxConnections: 20,
        },
        security: {
          ...baseConfig.security,
          sandboxEnabled: true,
        },
        monitoring: {
          ...baseConfig.monitoring,
          metricsEnabled: true,
          tracingEnabled: true,
        },
      };

    case 'staging':
      return {
        ...baseConfig,
        app: {
          ...baseConfig.app,
          logLevel: 'info',
        },
        database: {
          ...baseConfig.database,
          ssl: true,
          maxConnections: 15,
        },
        security: {
          ...baseConfig.security,
          sandboxEnabled: true,
        },
      };

    case 'development':
    default:
      return {
        ...baseConfig,
        app: {
          ...baseConfig.app,
          logLevel: 'debug',
        },
        security: {
          ...baseConfig.security,
          sandboxEnabled: false,
        },
        monitoring: {
          ...baseConfig.monitoring,
          metricsEnabled: true,
          tracingEnabled: false,
        },
      };
  }
}

// ============================================================================
// Configuration Helpers
// ============================================================================

export function validateRequiredEnvVars(required: string[]): void {
  const missing: string[] = [];

  for (const envVar of required) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

export function getServiceConfig(serviceName: string): Record<string, any> {
  const config = new ConfigManager();
  const baseConfig = config.getAppConfig();

  return {
    ...baseConfig,
    service: serviceName,
    version: process.env.npm_package_version || '0.1.0',
  };
}

export {
  FORBIDDEN_SECRET_PLACEHOLDERS,
  MissingSecretsError,
  assertServiceSecrets,
  isBlank,
  isDeployedEnvironment,
  isForbiddenPlaceholder,
  isUsableSecret,
  listMissingOptionalDevSecrets,
  requiredSecretsForService,
  resolveAnthropicApiKey,
  resolveRuntimeEnvironment,
} from './secrets';
export type { RuntimeEnvironment, SpecCursorService } from './secrets';

// ============================================================================
// Default Export
// ============================================================================

export default ConfigManager;
