import { RateLimiter, SecurityUtils, Logger } from '../../index';

describe('RateLimiter', () => {
  const logger = new Logger('rate-test', 'error');

  it('allows traffic under the limit and blocks over it', async () => {
    const limiter = new RateLimiter(logger, 100);
    expect(await limiter.checkLimit('ip:1', 2, 60_000)).toBe(true);
    expect(await limiter.checkLimit('ip:1', 2, 60_000)).toBe(true);
    expect(await limiter.checkLimit('ip:1', 2, 60_000)).toBe(false);
  });

  it('reports remaining correctly', async () => {
    const limiter = new RateLimiter(logger, 100);
    await limiter.checkLimit('ip:2', 5, 60_000);
    expect(await limiter.getRemaining('ip:2', 5)).toBe(4);
  });
});

describe('SecurityUtils.verifySignature', () => {
  it('accepts matching HMAC signatures', () => {
    const secret = 'test-secret';
    const payload = '{"ok":true}';
    const crypto = require('crypto');
    const sig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    expect(SecurityUtils.verifySignature(payload, sig, secret)).toBe(true);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(SecurityUtils.verifySignature('{}', 'ab', 'secret')).toBe(false);
  });
});
