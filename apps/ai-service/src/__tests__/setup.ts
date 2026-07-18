// Jest setup file
import 'dotenv/config';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.PORT = '3002';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
