import type { Pool } from 'pg';

export interface CreatePatchInput {
  id: string;
  upgradeId: string;
  patchType: string;
  status: string;
  originalCode: string;
}

export interface PatchRow {
  id: string;
  upgrade_id: string;
  patch_type: string;
  status: string;
  original_code: string | null;
  patched_code: string | null;
  diff_output: string | null;
  confidence_score: string | number | null;
  claude_response: unknown;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

export interface ListPatchesFilter {
  status?: string;
  upgradeId?: string;
  limit: number;
  offset: number;
}

export class PatchRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreatePatchInput): Promise<PatchRow> {
    const result = await this.pool.query<PatchRow>(
      `INSERT INTO ai_patches (
         id, upgrade_id, patch_type, status, original_code, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [
        input.id,
        input.upgradeId,
        input.patchType,
        input.status,
        input.originalCode,
      ]
    );
    return result.rows[0]!;
  }

  async findById(id: string): Promise<PatchRow | null> {
    const result = await this.pool.query<PatchRow>(
      'SELECT * FROM ai_patches WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  async markGenerating(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_patches SET status = 'generating', updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async markCompleted(
    id: string,
    data: {
      patchedCode: string;
      diffOutput: string;
      confidenceScore: number;
      claudeResponse: unknown;
    }
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ai_patches
       SET status = 'completed',
           patched_code = $1,
           diff_output = $2,
           confidence_score = $3,
           claude_response = $4,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $5`,
      [
        data.patchedCode,
        data.diffOutput,
        data.confidenceScore,
        JSON.stringify(data.claudeResponse),
        id,
      ]
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_patches
       SET status = 'failed', error_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorMessage, id]
    );
  }

  async list(
    filter: ListPatchesFilter
  ): Promise<{ patches: PatchRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.upgradeId) {
      params.push(filter.upgradeId);
      where.push(`upgrade_id = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const listParams = [...params, filter.limit, filter.offset];
    const listResult = await this.pool.query<
      PatchRow & { total_count: string }
    >(
      `SELECT *, COUNT(*) OVER()::text AS total_count
       FROM ai_patches ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    );

    const total = Number(listResult.rows[0]?.total_count ?? 0);
    const patches = listResult.rows.map(({ total_count: _tc, ...row }) => row);

    return { patches, total };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function toPatchDto(row: PatchRow) {
  return {
    id: row.id,
    upgradeId: row.upgrade_id,
    patchType: row.patch_type,
    status: row.status,
    originalCode: row.original_code,
    patchedCode: row.patched_code,
    diffOutput: row.diff_output,
    confidenceScore:
      row.confidence_score === null || row.confidence_score === undefined
        ? null
        : Number(row.confidence_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}
