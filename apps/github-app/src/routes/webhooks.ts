import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';
import { asyncHandler, SecurityUtils } from '@speccursor/shared-utils';
import type { Logger } from '@speccursor/shared-utils';
import { ValidationError } from '@speccursor/shared-types';
import type { WebhookProcessingService } from '../application/webhook-service';

export function createWebhookSignatureMiddleware(
  webhookSecret: string,
  logger: Logger
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      logger.warn('Missing webhook signature', { url: req.url });
      res
        .status(401)
        .json({ error: 'Missing signature', code: 'UNAUTHORIZED' });
      return;
    }

    const rawBodyBuf = (req as Request & { rawBody?: Buffer }).rawBody;
    // Fail closed: recomputing JSON.stringify(req.body) breaks HMAC because
    // key order / whitespace will not match GitHub's exact payload bytes.
    if (!rawBodyBuf || rawBodyBuf.length === 0) {
      logger.warn('Missing raw webhook body for signature verification', {
        url: req.url,
      });
      res.status(401).json({
        error: 'Raw body required for signature verification',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const rawBody = rawBodyBuf.toString('utf8');
    const signatureWithoutPrefix = signature.replace(/^sha256=/, '');
    const valid = SecurityUtils.verifySignature(
      rawBody,
      signatureWithoutPrefix,
      webhookSecret
    );

    if (!valid) {
      logger.warn('Invalid webhook signature', { url: req.url });
      res
        .status(401)
        .json({ error: 'Invalid signature', code: 'UNAUTHORIZED' });
      return;
    }

    next();
  };
}

export function createWebhookRouter(
  webhooks: Webhooks,
  service: WebhookProcessingService,
  logger: Logger,
  webhookSecret: string
): Router {
  const router = Router();

  webhooks.on('release.published', async event => {
    try {
      await service.processRelease(event.payload as never);
    } catch (error) {
      logger.error('Error processing release webhook', error as Error);
    }
  });

  webhooks.on('pull_request.opened', async event => {
    try {
      await service.processPullRequest(event.payload as never);
    } catch (error) {
      logger.error('Error processing PR opened webhook', error as Error);
    }
  });

  webhooks.on('pull_request.synchronize', async event => {
    try {
      await service.processPullRequest(event.payload as never);
    } catch (error) {
      logger.error('Error processing PR sync webhook', error as Error);
    }
  });

  router.post(
    '/',
    createWebhookSignatureMiddleware(webhookSecret, logger),
    createNodeMiddleware(webhooks, { path: '/' })
  );

  return router;
}

export function createTriggerRouter(service: WebhookProcessingService): Router {
  const router = Router();

  router.post(
    '/upgrade',
    body('repository').isString().notEmpty(),
    body('packageName').isString().notEmpty(),
    body('currentVersion').isString().notEmpty(),
    body('targetVersion').isString().notEmpty(),
    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Invalid request data', {
          errors: errors.array(),
        });
      }

      await service.createManualUpgrade(req.body);
      res.json({
        success: true,
        message: 'Upgrade job created successfully',
      });
    })
  );

  return router;
}
