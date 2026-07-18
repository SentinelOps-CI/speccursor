/**
 * Queue adapter for upgrade work items.
 * Prefer list-backed queues (LPUSH/RPOP) over key-per-job SET patterns
 * so workers can consume in O(1) without scanning keyspace.
 */
export interface UpgradeQueue {
  enqueue(payload: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

export class RedisUpgradeQueue implements UpgradeQueue {
  constructor(
    private readonly client: {
      lPush: (key: string, value: string) => Promise<number>;
      ping?: () => Promise<string>;
      quit?: () => Promise<unknown>;
      connect?: () => Promise<unknown>;
      isOpen?: boolean;
    },
    private readonly queueKey: string = 'upgrade_queue'
  ) {}

  async enqueue(payload: Record<string, unknown>): Promise<void> {
    await this.client.lPush(this.queueKey, JSON.stringify(payload));
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (this.client.ping) {
        await this.client.ping();
      }
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.client.quit) {
      await this.client.quit();
    }
  }
}
