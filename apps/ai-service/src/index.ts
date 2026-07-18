import dotenv from 'dotenv';
import { listenAndServe } from '@speccursor/shared-utils';
import { createAiServiceApp } from './app';

dotenv.config();

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] || 3002);
  const service = createAiServiceApp();
  await service.start();
  await listenAndServe({
    app: service.app,
    port,
    logger: service.logger,
    onShutdown: () => service.stop(),
  });
}

main().catch(err => {
  console.error('AI service failed to start', err);
  process.exit(1);
});
