import { createGitHubApp } from '../../app';
import { isDependencyFile } from '../../application/webhook-service';

describe('GitHub App module exports', () => {
  it('exposes createGitHubApp factory', () => {
    expect(typeof createGitHubApp).toBe('function');
  });

  it('classifies dependency files', () => {
    expect(isDependencyFile('pnpm-lock.yaml')).toBe(true);
  });
});
