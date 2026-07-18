import * as fc from 'fast-check';
import { UpgradeService } from '../../application/upgrade-service';
import type { UpgradeRepository } from '../../infrastructure/upgrade-repository';
import type { UpgradeQueue } from '../../infrastructure/upgrade-queue';
import { Logger } from '@speccursor/shared-utils';
import { ValidationError } from '@speccursor/shared-types';

function memoryRepo(): UpgradeRepository {
  const rows = new Map<string, any>();
  return {
    async create(input) {
      const row = {
        id: input.id,
        repository: input.repository,
        ecosystem: input.ecosystem,
        package_name: input.packageName,
        current_version: input.currentVersion,
        target_version: input.targetVersion,
        status: input.status,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        error_message: null,
      };
      rows.set(input.id, row);
      return row;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list(filter) {
      const all = [...rows.values()];
      return {
        upgrades: all.slice(filter.offset, filter.offset + filter.limit),
        total: all.length,
      };
    },
    async healthCheck() {
      return true;
    },
    async close() {},
  } as UpgradeRepository;
}

describe('UpgradeService properties', () => {
  const logger = new Logger('prop-test', 'error');
  const queue: UpgradeQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    healthCheck: async () => true,
    close: async () => undefined,
  };
  const service = new UpgradeService(memoryRepo(), queue, logger);

  it('rejects empty required fields for any ecosystem string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('node', 'rust', 'python', 'go', 'lean', 'dockerfile'),
        async ecosystem => {
          await expect(
            service.createUpgrade({
              repository: '',
              ecosystem,
              packageName: '',
              currentVersion: '',
              targetVersion: '',
            })
          ).rejects.toBeInstanceOf(ValidationError);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('list pagination never returns more rows than limit', async () => {
    for (let i = 0; i < 5; i++) {
      await service.createUpgrade({
        repository: `org/repo-${i}`,
        ecosystem: 'node',
        packageName: `pkg-${i}`,
        currentVersion: '1.0.0',
        targetVersion: '1.0.1',
      });
    }

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async limit => {
        const result = await service.listUpgrades({ page: 1, limit });
        expect(result.upgrades.length).toBeLessThanOrEqual(limit);
        expect(result.pagination.limit).toBe(limit);
      }),
      { numRuns: 10 }
    );
  });
});
