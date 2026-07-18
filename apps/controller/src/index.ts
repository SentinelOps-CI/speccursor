import dotenv from 'dotenv';
import { listenAndServe } from '@speccursor/shared-utils';
import { createControllerApp } from './app';

dotenv.config();

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] || 3001);
  const controller = createControllerApp();

  await controller.start();
  await listenAndServe({
    app: controller.app,
    port,
    logger: controller.logger,
    onShutdown: () => controller.stop(),
  });
}

main().catch(err => {
  console.error('Controller failed to start', err);
  process.exit(1);
});
