import express, {
  Express,
  Request,
  Response,
  NextFunction,
  RequestHandler,
  ErrorRequestHandler,
} from 'express';
// express namespace used for Request augmentation in verify callback
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { register, collectDefaultMetrics, Registry } from 'prom-client';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { SpecCursorError } from '@speccursor/shared-types';

/** Minimal logger surface required by the HTTP kernel (avoids circular imports). */
export interface HttpLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
}

export interface HttpKernelOptions {
  serviceName: string;
  logger: HttpLogger;
  /** When true, Express trusts X-Forwarded-* from reverse proxies. */
  trustProxy?: boolean | number | string;
  corsOrigins?: string[] | boolean;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  /** Paths excluded from rate limiting (defaults include health/metrics). */
  rateLimitSkipPaths?: string[];
  jsonLimit?: string;
  metricsRegistry?: Registry;
  collectDefaultPrometheusMetrics?: boolean;
  /** Extra readiness checks keyed by dependency name. */
  readinessChecks?: Record<string, () => Promise<boolean>>;
}

export interface HttpKernel {
  app: Express;
  metricsRegistry: Registry;
  correlationIdMiddleware: RequestHandler;
  errorHandler: ErrorRequestHandler;
  notFoundHandler: RequestHandler;
}

const DEFAULT_SKIP_PATHS = new Set(['/health', '/ready', '/metrics']);

/**
 * Shared Express bootstrap: security headers, CORS, compression, rate limits,
 * correlation IDs, health/ready/metrics, and consistent error envelopes.
 */
export function createHttpKernel(options: HttpKernelOptions): HttpKernel {
  const {
    serviceName,
    logger,
    trustProxy = 1,
    corsOrigins,
    rateLimitWindowMs = 15 * 60 * 1000,
    rateLimitMax = 100,
    rateLimitSkipPaths = [],
    jsonLimit = '10mb',
    metricsRegistry = register,
    collectDefaultPrometheusMetrics = true,
    readinessChecks = {},
  } = options;

  const skipPaths = new Set([...DEFAULT_SKIP_PATHS, ...rateLimitSkipPaths]);

  if (collectDefaultPrometheusMetrics) {
    try {
      collectDefaultMetrics({
        register: metricsRegistry,
        prefix: `${serviceName.replace(/-/g, '_')}_`,
      });
    } catch {
      // Registry may already have default metrics in tests / hot reload.
    }
  }

  const app = express();
  app.set('trust proxy', trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  app.use(
    cors({
      origin:
        corsOrigins ??
        (process.env.ALLOWED_ORIGINS
          ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
          : process.env.NODE_ENV === 'production'
            ? false
            : true),
      credentials: true,
    })
  );

  app.use(compression());
  app.use(
    rateLimit({
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many requests',
        code: 'RATE_LIMITED',
      },
      skip: req => skipPaths.has(req.path),
    })
  );

  app.use(
    express.json({
      limit: jsonLimit,
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody =
          Buffer.from(buf);
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: jsonLimit }));

  const correlationIdMiddleware: RequestHandler = (req, res, next) => {
    const incoming =
      (req.headers['x-correlation-id'] as string | undefined) ||
      (req.headers['x-request-id'] as string | undefined);
    const correlationId =
      incoming && incoming.length <= 128 ? incoming : randomUUID();
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  };

  app.use(correlationIdMiddleware);

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info('http_request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
        correlationId: (req as Request & { correlationId?: string })
          .correlationId,
        ip: req.ip,
      });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      service: serviceName,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/ready', async (_req, res) => {
    const checks: Record<string, { status: 'healthy' | 'unhealthy' }> = {};
    let ready = true;

    for (const [name, check] of Object.entries(readinessChecks)) {
      try {
        const ok = await check();
        checks[name] = { status: ok ? 'healthy' : 'unhealthy' };
        if (!ok) ready = false;
      } catch {
        checks[name] = { status: 'unhealthy' };
        ready = false;
      }
    }

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: serviceName,
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } catch (err) {
      logger.error('Failed to render metrics', err as Error);
      res.status(500).end();
    }
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const correlationId = (req as Request & { correlationId?: string })
      .correlationId;

    if (err instanceof SpecCursorError) {
      logger.warn('Handled application error', {
        code: err.code,
        message: err.message,
        correlationId,
        path: req.path,
      });
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        correlationId,
        details: err.details,
      });
      return;
    }

    logger.error('Unhandled error', err as Error, {
      correlationId,
      path: req.path,
      method: req.method,
    });

    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      correlationId,
    });
  };

  const notFoundHandler: RequestHandler = (req, res) => {
    res.status(404).json({
      error: 'Not found',
      code: 'NOT_FOUND',
      path: req.path,
      correlationId: (req as Request & { correlationId?: string })
        .correlationId,
    });
  };

  return {
    app,
    metricsRegistry,
    correlationIdMiddleware,
    errorHandler,
    notFoundHandler,
  };
}

export interface ListenOptions {
  app: Express;
  port: number;
  logger: HttpLogger;
  onShutdown?: () => Promise<void>;
}

/**
 * Start HTTP server with SIGTERM/SIGINT graceful shutdown.
 */
export async function listenAndServe(options: ListenOptions): Promise<Server> {
  const { app, port, logger, onShutdown } = options;

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.on('error', reject);
  });

  logger.info('HTTP server listening', { port });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);

    server.close(async closeErr => {
      if (closeErr) {
        logger.error('Error closing HTTP server', closeErr);
      }
      try {
        if (onShutdown) await onShutdown();
      } catch (err) {
        logger.error('Error during shutdown hooks', err as Error);
      }
      process.exit(closeErr ? 1 : 0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return server;
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
