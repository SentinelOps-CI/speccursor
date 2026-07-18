import dotenv from 'dotenv';
import { listenAndServe } from '@speccursor/shared-utils';
import { ConfigManager } from '@speccursor/shared-config';
import { createGitHubApp } from './app';

dotenv.config();

async function main(): Promise<void> {
  const configManager = new ConfigManager();
  const config = configManager.getAppConfig();
  const githubApp = createGitHubApp({ configManager });

  await githubApp.start();
  await listenAndServe({
    app: githubApp.app,
    port: config.port,
    logger: githubApp.logger,
    onShutdown: () => githubApp.stop(),
  });
}

main().catch(err => {
  console.error('GitHub App failed to start', err);
  process.exit(1);
});
