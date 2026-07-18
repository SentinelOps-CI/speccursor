import type { Pool } from 'pg';

export interface CreateUpgradeInput {
  id: string;
  repository: string;
  ecosystem: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  status: string;
}

export interface ListUpgradesFilter {
  status?: string;
  ecosystem?: string;
  limit: number;
  offset: number;
}

export interface ListUpgradesResult {
  upgrades: UpgradeRow[];
  total: number;
}

export interface UpgradeRow {
  id: string;
  repository: string;
  ecosystem: string;
  package_name: string;
  current_version: string;
  target_version: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

/**
 * Persistence for upgrade records. Uses parameterized SQL only.
 */
export class UpgradeRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateUpgradeInput): Promise<UpgradeRow> {
    const result = await this.pool.query<UpgradeRow>(
      `INSERT INTO upgrades (
         id, repository, ecosystem, package_name, current_version,
         target_version, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        input.id,
        input.repository,
        input.ecosystem,
        input.packageName,
        input.currentVersion,
        input.targetVersion,
        input.status,
      ]
    );
    return result.rows[0]!;
  }

  async findById(id: string): Promise<UpgradeRow | null> {
    const result = await this.pool.query<UpgradeRow>(
      'SELECT * FROM upgrades WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Paginated list with a single round-trip via COUNT(*) OVER ().
   * Avoids a separate COUNT query and never loads the full result set.
   */
  async list(filter: ListUpgradesFilter): Promise<ListUpgradesResult> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.ecosystem) {
      params.push(filter.ecosystem);
      where.push(`ecosystem = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const listParams = [...params, filter.limit, filter.offset];

    const listResult = await this.pool.query<
      UpgradeRow & { total_count: string }
    >(
      `SELECT *, COUNT(*) OVER()::text AS total_count
       FROM upgrades ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams
    );

    const total = Number(listResult.rows[0]?.total_count ?? 0);
    const upgrades = listResult.rows.map(({ total_count: _tc, ...row }) => row);

    return { upgrades, total };
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

export function toUpgradeDto(row: UpgradeRow) {
  return {
    id: row.id,
    repository: row.repository,
    ecosystem: row.ecosystem,
    packageName: row.package_name,
    currentVersion: row.current_version,
    targetVersion: row.target_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}
