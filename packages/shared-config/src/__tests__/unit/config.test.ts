import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ConfigManager } from '../../index';

describe('ConfigManager', () => {
  const previous = {
    APP_ENV: process.env['APP_ENV'],
    NODE_ENV: process.env['NODE_ENV'],
    GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
    REDIS_PASSWORD: process.env['REDIS_PASSWORD'],
    JAEGER_ENDPOINT: process.env['JAEGER_ENDPOINT'],
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    CLAUDE_API_KEY: process.env['CLAUDE_API_KEY'],
  };

  beforeEach(() => {
    process.env['APP_ENV'] = 'development';
    process.env['NODE_ENV'] = 'test';
    delete process.env['GITHUB_APP_ID'];
    delete process.env['REDIS_PASSWORD'];
    delete process.env['JAEGER_ENDPOINT'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['CLAUDE_API_KEY'];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads and validates default development config', () => {
    const configManager = new ConfigManager();
    const app = configManager.getAppConfig();
    expect(app.port).toBeGreaterThan(0);
    expect(app.environment).toBe('development');
    expect(app.database.host).toBeTruthy();
    expect(app.redis.host).toBeTruthy();
    expect(app.claude.model).toContain('claude');
  });

  it('exposes typed subsystem getters', () => {
    const configManager = new ConfigManager();
    expect(configManager.getDatabaseConfig().database).toBeTruthy();
    expect(configManager.getRedisConfig().port).toBeGreaterThan(0);
    expect(configManager.getClaudeConfig().maxTokens).toBeGreaterThan(0);
    expect(configManager.getLeanConfig().version).toBe('4.20.0');
    expect(configManager.getSecurityConfig().sandboxEnabled).toBeDefined();
    expect(configManager.getMonitoringConfig().metricsEnabled).toBe(true);
    expect(configManager.getGitHubConfig().appId).toBeNull();
  });

  it('prefers ANTHROPIC_API_KEY for Claude config', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-from-anthropic';
    const mgr = new ConfigManager();
    expect(mgr.getClaudeConfig().apiKey).toBe('sk-from-anthropic');
  });

  it('reports environment helpers', () => {
    const configManager = new ConfigManager();
    expect(configManager.isDevelopment()).toBe(true);
    expect(configManager.isProduction()).toBe(false);
    expect(configManager.isStaging()).toBe(false);
  });
});
