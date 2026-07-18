// Jest setup file
import 'dotenv/config';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
// Convict deploy profile is development|staging|production (not test).
process.env.APP_ENV = 'development';

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
