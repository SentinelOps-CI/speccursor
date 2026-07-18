import { createControllerApp } from '../../app';
import { UpgradeService } from '../../application/upgrade-service';

describe('Controller module exports', () => {
  it('exposes createControllerApp factory', () => {
    expect(typeof createControllerApp).toBe('function');
  });

  it('exposes UpgradeService', () => {
    expect(typeof UpgradeService).toBe('function');
  });
});
