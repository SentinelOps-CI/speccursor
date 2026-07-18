import { Logger } from '../../index';

describe('Logger', () => {
  it('creates a logger with service metadata', () => {
    const logger = new Logger('shared-utils-test', 'error');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('accepts structured metadata without throwing', () => {
    const logger = new Logger('shared-utils-test', 'error');
    expect(() => logger.info('hello', { ok: true })).not.toThrow();
    expect(() =>
      logger.error('boom', new Error('x'), { code: 'TEST' })
    ).not.toThrow();
  });
});
