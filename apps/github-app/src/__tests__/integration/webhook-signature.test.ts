import request from 'supertest';
import { createWebhookSignatureMiddleware } from '../../routes/webhooks';
import { Logger, createHttpKernel } from '@speccursor/shared-utils';
import crypto from 'crypto';

describe('webhook signature middleware', () => {
  const logger = new Logger('webhook-sig-test', 'error');
  const secret = 'test-webhook-secret';

  it('rejects requests without captured rawBody (fail-closed)', async () => {
    const kernel = createHttpKernel({
      serviceName: 'webhook-sig-test',
      logger,
      collectDefaultPrometheusMetrics: false,
    });
    // Intentionally omit rawBody capture to simulate misconfigured parsers.
    kernel.app.use((req, _res, next) => {
      delete (req as { rawBody?: Buffer }).rawBody;
      next();
    });
    kernel.app.post(
      '/webhook',
      createWebhookSignatureMiddleware(secret, logger),
      (_req, res) => res.status(200).json({ ok: true })
    );
    kernel.app.use(kernel.notFoundHandler);
    kernel.app.use(kernel.errorHandler);

    const body = JSON.stringify({ action: 'published' });
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

    const res = await request(kernel.app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${sig}`)
      .send(body)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('accepts valid HMAC over raw body bytes', async () => {
    const kernel = createHttpKernel({
      serviceName: 'webhook-sig-ok',
      logger,
      collectDefaultPrometheusMetrics: false,
    });
    kernel.app.post(
      '/webhook',
      createWebhookSignatureMiddleware(secret, logger),
      (_req, res) => res.status(200).json({ ok: true })
    );

    const body = JSON.stringify({ action: 'published' });
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

    await request(kernel.app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${sig}`)
      .send(body)
      .expect(200);
  });
});
