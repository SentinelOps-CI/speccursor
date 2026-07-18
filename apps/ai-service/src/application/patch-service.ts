import { v4 as uuidv4 } from 'uuid';
import {
  NotFoundError,
  ValidationError,
  isAllowedEcosystem,
} from '@speccursor/shared-types';
import type { Logger } from '@speccursor/shared-utils';
import {
  PatchRepository,
  toPatchDto,
} from '../infrastructure/patch-repository';
import {
  buildUnifiedDiff,
  type ClaudePatchClient,
} from '../infrastructure/claude-client';

export interface CreatePatchRequest {
  upgradeId: string;
  originalCode: string;
  testFailure: string;
  ecosystem: string;
}

export class PatchService {
  constructor(
    private readonly repository: PatchRepository,
    private readonly claude: ClaudePatchClient,
    private readonly logger: Logger
  ) {}

  async createPatch(input: CreatePatchRequest) {
    this.assertCreateInput(input);

    const patchId = uuidv4();
    await this.repository.create({
      id: patchId,
      upgradeId: input.upgradeId,
      patchType: 'ai-generated',
      status: 'generating',
      originalCode: input.originalCode,
    });

    // Fire-and-forget generation; status is polled via GET.
    void this.generateInBackground(patchId, input);

    return {
      id: patchId,
      status: 'generating',
      message: 'AI patch generation started',
    };
  }

  async getPatch(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError('Patch', id);
    return toPatchDto(row);
  }

  async listPatches(query: {
    page?: number;
    limit?: number;
    status?: string;
    upgradeId?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const filter: {
      status?: string;
      upgradeId?: string;
      limit: number;
      offset: number;
    } = { limit, offset };
    if (query.status) filter.status = query.status;
    if (query.upgradeId) filter.upgradeId = query.upgradeId;

    const { patches, total } = await this.repository.list(filter);

    return {
      patches: patches.map(toPatchDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
        hasNext: offset + patches.length < total,
        hasPrevious: page > 1,
      },
    };
  }

  /** Exposed for deterministic unit/integration tests. */
  async generateInBackground(
    patchId: string,
    input: CreatePatchRequest
  ): Promise<void> {
    try {
      await this.repository.markGenerating(patchId);
      const result = await this.claude.generatePatch({
        ecosystem: input.ecosystem,
        originalCode: input.originalCode,
        testFailure: input.testFailure,
      });

      const diffOutput = buildUnifiedDiff(
        input.originalCode,
        result.patchedCode
      );

      await this.repository.markCompleted(patchId, {
        patchedCode: result.patchedCode,
        diffOutput,
        confidenceScore: result.confidenceScore,
        claudeResponse: result.raw,
      });

      this.logger.info('AI patch generation completed', {
        patchId,
        confidenceScore: result.confidenceScore,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Error generating AI patch', error as Error, {
        patchId,
      });
      await this.repository.markFailed(patchId, message);
    }
  }

  private assertCreateInput(input: CreatePatchRequest): void {
    if (!input.upgradeId) {
      throw new ValidationError('upgradeId is required');
    }
    if (!input.originalCode?.trim()) {
      throw new ValidationError('originalCode is required');
    }
    if (!input.testFailure?.trim()) {
      throw new ValidationError('testFailure is required');
    }
    if (!isAllowedEcosystem(input.ecosystem)) {
      throw new ValidationError('Invalid ecosystem', {
        ecosystem: input.ecosystem,
      });
    }
  }
}
