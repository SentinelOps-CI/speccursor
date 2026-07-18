import { describe, it, expect } from '@jest/globals';
import {
  FORBIDDEN_SECRET_PLACEHOLDERS,
  MissingSecretsError,
  assertServiceSecrets,
  isDeployedEnvironment,
  isForbiddenPlaceholder,
  isUsableSecret,
  listMissingOptionalDevSecrets,
  requiredSecretsForService,
  resolveAnthropicApiKey,
  resolveRuntimeEnvironment,
} from '../../secrets';

describe('secrets', () => {
  describe('resolveRuntimeEnvironment', () => {
    it('prefers APP_ENV over NODE_ENV', () => {
      expect(
        resolveRuntimeEnvironment({
          APP_ENV: 'staging',
          NODE_ENV: 'production',
        })
      ).toBe('staging');
    });

    it('maps NODE_ENV when APP_ENV unset', () => {
      expect(resolveRuntimeEnvironment({ NODE_ENV: 'production' })).toBe(
        'production'
      );
      expect(resolveRuntimeEnvironment({ NODE_ENV: 'test' })).toBe('test');
      expect(resolveRuntimeEnvironment({})).toBe('development');
    });
  });

  describe('placeholders', () => {
    it('rejects known fake credentials', () => {
      for (const p of FORBIDDEN_SECRET_PLACEHOLDERS) {
        expect(isForbiddenPlaceholder(p)).toBe(true);
        expect(isUsableSecret(p)).toBe(false);
      }
      expect(isUsableSecret('sk-ant-real-looking-key')).toBe(true);
      expect(isUsableSecret('')).toBe(false);
      expect(isUsableSecret(undefined)).toBe(false);
    });
  });

  describe('resolveAnthropicApiKey', () => {
    it('prefers ANTHROPIC_API_KEY over CLAUDE_API_KEY', () => {
      expect(
        resolveAnthropicApiKey({
          ANTHROPIC_API_KEY: ' primary ',
          CLAUDE_API_KEY: 'alias',
        })
      ).toBe('primary');
      expect(resolveAnthropicApiKey({ CLAUDE_API_KEY: 'alias' })).toBe('alias');
      expect(resolveAnthropicApiKey({})).toBe('');
    });
  });

  describe('assertServiceSecrets (deployed)', () => {
    const stagingBase = {
      APP_ENV: 'staging',
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://speccursor:s3curePass@db.internal:5432/speccursor',
      REDIS_URL: 'redis://redis.internal:6379',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      GITHUB_APP_ID: '12345',
      GITHUB_PRIVATE_KEY:
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
      GITHUB_WEBHOOK_SECRET: 'whsec_real',
      JWT_SECRET: 'jwt-real-secret-value',
    };

    it('passes when staging secrets are complete', () => {
      expect(() =>
        assertServiceSecrets('ai-service', stagingBase)
      ).not.toThrow();
      expect(() =>
        assertServiceSecrets('controller', stagingBase)
      ).not.toThrow();
      expect(() =>
        assertServiceSecrets('github-app', stagingBase)
      ).not.toThrow();
    });

    it('fails closed when ANTHROPIC_API_KEY missing for ai-service', () => {
      const env = { ...stagingBase, ANTHROPIC_API_KEY: '' };
      delete (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
      expect(() => assertServiceSecrets('ai-service', env)).toThrow(
        MissingSecretsError
      );
    });

    it('rejects docker-compose default DB password in production', () => {
      const env = {
        ...stagingBase,
        APP_ENV: 'production',
        DATABASE_URL:
          'postgresql://speccursor:speccursor_dev@localhost:5432/speccursor',
      };
      const missing = requiredSecretsForService('controller', env);
      expect(missing.some(m => m.includes('speccursor_dev'))).toBe(true);
    });

    it('rejects placeholder JWT_SECRET for github-app', () => {
      const env = { ...stagingBase, JWT_SECRET: 'your-secret-key' };
      expect(() => assertServiceSecrets('github-app', env)).toThrow(
        /JWT_SECRET/
      );
    });

    it('does not require secrets in development', () => {
      expect(isDeployedEnvironment({ APP_ENV: 'development' })).toBe(false);
      expect(
        requiredSecretsForService('ai-service', { APP_ENV: 'development' })
      ).toEqual([]);
    });

    it('lists missing optional secrets for local DX', () => {
      const missing = listMissingOptionalDevSecrets('ai-service', {
        APP_ENV: 'development',
      });
      expect(missing).toContain('ANTHROPIC_API_KEY');
    });
  });
});
