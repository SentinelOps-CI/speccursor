import { Octokit } from '@octokit/rest';
import type { Logger } from '@speccursor/shared-utils';
import {
  extractPackageName,
  isDependencyFile,
  isDependencyRelease,
} from '../domain/dependency';

export {
  extractPackageName,
  isDependencyFile,
  isDependencyRelease,
} from '../domain/dependency';

export interface JobQueue {
  enqueue(jobType: string, payload: Record<string, unknown>): Promise<void>;
}

export interface GitHubAuthFactory {
  createOctokit(): Promise<Octokit>;
}

export class WebhookProcessingService {
  constructor(
    private readonly queue: JobQueue,
    private readonly auth: GitHubAuthFactory,
    private readonly logger: Logger
  ) {}

  async processRelease(payload: {
    repository: { full_name: string };
    release: {
      tag_name: string;
      name?: string | null;
      body?: string | null;
      html_url?: string;
    };
  }): Promise<void> {
    const { repository, release } = payload;
    if (!isDependencyRelease(release)) {
      this.logger.debug('Ignoring non-dependency release', {
        repository: repository.full_name,
        tag: release.tag_name,
      });
      return;
    }

    const packageName = extractPackageName(release);
    await this.queue.enqueue('upgrade', {
      type: 'upgrade',
      repository: repository.full_name,
      release: release.tag_name,
      packageName,
      releaseUrl: release.html_url,
      createdAt: new Date().toISOString(),
    });

    this.logger.info('Queued upgrade from release', {
      repository: repository.full_name,
      packageName,
      release: release.tag_name,
    });
  }

  async processPullRequest(payload: {
    repository: { full_name: string };
    pull_request: { number: number };
  }): Promise<void> {
    const repository = payload.repository.full_name;
    const prNumber = payload.pull_request.number;

    const hasDeps = await this.checkForDependencyChanges(repository, prNumber);
    if (!hasDeps) {
      this.logger.debug('PR has no dependency file changes', {
        repository,
        prNumber,
      });
      return;
    }

    await this.queue.enqueue('analysis', {
      type: 'analysis',
      repository,
      prNumber,
      createdAt: new Date().toISOString(),
    });

    this.logger.info('Queued analysis for dependency PR', {
      repository,
      prNumber,
    });
  }

  async createManualUpgrade(input: {
    repository: string;
    packageName: string;
    currentVersion: string;
    targetVersion: string;
  }): Promise<void> {
    await this.queue.enqueue('upgrade', {
      type: 'upgrade',
      repository: input.repository,
      packageName: input.packageName,
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      release: `${input.packageName}@${input.targetVersion}`,
      createdAt: new Date().toISOString(),
    });
  }

  private async checkForDependencyChanges(
    repository: string,
    prNumber: number
  ): Promise<boolean> {
    try {
      const [owner, repo] = repository.split('/');
      if (!owner || !repo) return false;

      const octokit = await this.auth.createOctokit();
      // Paginate files — avoids truncating large PRs (listFiles defaults to 30).
      // Early-exit as soon as one dependency file is found to avoid full cost.
      for await (const response of octokit.paginate.iterator(
        octokit.pulls.listFiles,
        {
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        }
      )) {
        if (response.data.some(file => isDependencyFile(file.filename))) {
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.error(
        'Error checking for dependency changes',
        error as Error,
        { repository, prNumber }
      );
      return false;
    }
  }
}
