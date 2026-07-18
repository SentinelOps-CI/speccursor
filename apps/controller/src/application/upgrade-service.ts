import { v4 as uuidv4 } from 'uuid';
import {
  NotFoundError,
  ValidationError,
  isAllowedEcosystem,
} from '@speccursor/shared-types';
import type { Logger } from '@speccursor/shared-utils';
import {
  UpgradeRepository,
  toUpgradeDto,
} from '../infrastructure/upgrade-repository';
import type { UpgradeQueue } from '../infrastructure/upgrade-queue';

export interface CreateUpgradeRequest {
  repository: string;
  ecosystem: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
}

export class UpgradeService {
  constructor(
    private readonly repository: UpgradeRepository,
    private readonly queue: UpgradeQueue,
    private readonly logger: Logger
  ) {}

  async createUpgrade(input: CreateUpgradeRequest) {
    this.assertCreateInput(input);

    const upgradeId = uuidv4();
    const row = await this.repository.create({
      id: upgradeId,
      repository: input.repository.trim(),
      ecosystem: input.ecosystem,
      packageName: input.packageName.trim(),
      currentVersion: input.currentVersion.trim(),
      targetVersion: input.targetVersion.trim(),
      status: 'pending',
    });

    await this.queue.enqueue({
      upgradeId,
      repository: input.repository,
      ecosystem: input.ecosystem,
      packageName: input.packageName,
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
    });

    this.logger.info('Upgrade request created', {
      upgradeId,
      repository: input.repository,
      ecosystem: input.ecosystem,
    });

    return {
      id: row.id,
      status: row.status,
      message: 'Upgrade request created successfully',
    };
  }

  async getUpgrade(id: string) {
    if (!id) {
      throw new ValidationError('Upgrade id is required');
    }
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundError('Upgrade', id);
    }
    return toUpgradeDto(row);
  }

  async listUpgrades(query: {
    page?: number | undefined;
    limit?: number | undefined;
    status?: string | undefined;
    ecosystem?: string | undefined;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const filter: {
      status?: string;
      ecosystem?: string;
      limit: number;
      offset: number;
    } = { limit, offset };
    if (query.status) filter.status = query.status;
    if (query.ecosystem) filter.ecosystem = query.ecosystem;

    const { upgrades, total } = await this.repository.list(filter);

    return {
      upgrades: upgrades.map(toUpgradeDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: offset + upgrades.length < total,
        hasPrevious: page > 1,
      },
    };
  }

  private assertCreateInput(input: CreateUpgradeRequest): void {
    const missing: string[] = [];
    if (!input.repository?.trim()) missing.push('repository');
    if (!input.packageName?.trim()) missing.push('packageName');
    if (!input.currentVersion?.trim()) missing.push('currentVersion');
    if (!input.targetVersion?.trim()) missing.push('targetVersion');
    if (!input.ecosystem || !isAllowedEcosystem(input.ecosystem)) {
      missing.push('ecosystem');
    }
    if (missing.length) {
      throw new ValidationError('Invalid upgrade request', { missing });
    }
  }
}
