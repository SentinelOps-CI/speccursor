import type { Redis, Logger } from '@speccursor/shared-utils';
import type { JobQueue } from '../application/webhook-service';

/**
 * List-backed job queue. Prefer LPUSH over SET-with-timestamp keys so
 * consumers do not need KEYS/SCAN (O(N) over redis keyspace).
 */
export class RedisJobQueue implements JobQueue {
  constructor(
    private readonly redis: Pick<Redis, 'lPush'>,
    private readonly logger: Logger,
    private readonly keyPrefix: string = 'speccursor:jobs'
  ) {}

  async enqueue(
    jobType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const key = `${this.keyPrefix}:${jobType}`;
    await this.redis.lPush(key, JSON.stringify(payload));
    this.logger.debug('Job enqueued', { jobType, key });
  }
}
