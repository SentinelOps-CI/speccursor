import {
  buildUnifiedDiff,
  extractJsonObject,
} from '../../infrastructure/claude-client';
import { PatchService } from '../../application/patch-service';
import type { PatchRepository } from '../../infrastructure/patch-repository';
import type { ClaudePatchClient } from '../../infrastructure/claude-client';
import { Logger } from '@speccursor/shared-utils';
import { createHttpKernel } from '@speccursor/shared-utils';
import { createPatchRouter } from '../../routes/patches';
import request from 'supertest';

function memoryRepo(): PatchRepository {
  const rows = new Map<string, any>();
  return {
    async create(input) {
      const row = {
        id: input.id,
        upgrade_id: input.upgradeId,
        patch_type: input.patchType,
        status: input.status,
        original_code: input.originalCode,
        patched_code: null,
        diff_output: null,
        confidence_score: null,
        claude_response: null,
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
    async markGenerating(id) {
      const row = rows.get(id);
      if (row) row.status = 'generating';
    },
    async markCompleted(id, data) {
      const row = rows.get(id);
      if (!row) return;
      row.status = 'completed';
      row.patched_code = data.patchedCode;
      row.diff_output = data.diffOutput;
      row.confidence_score = data.confidenceScore;
      row.claude_response = data.claudeResponse;
      row.completed_at = new Date();
    },
    async markFailed(id, errorMessage) {
      const row = rows.get(id);
      if (!row) return;
      row.status = 'failed';
      row.error_message = errorMessage;
    },
    async list(filter) {
      const all = [...rows.values()];
      return {
        patches: all.slice(filter.offset, filter.offset + filter.limit),
        total: all.length,
      };
    },
    async healthCheck() {
      return true;
    },
    async close() {},
  } as PatchRepository;
}

describe('claude-client helpers', () => {
  it('extracts JSON from fenced responses', () => {
    const parsed = extractJsonObject(
      'Here you go:\n```json\n{"patchedCode":"x","confidenceScore":0.9}\n```'
    );
    expect(parsed.patchedCode).toBe('x');
  });

  it('builds a unified diff', () => {
    const diff = buildUnifiedDiff('const a = 1;\n', 'const a = 2;\n');
    expect(diff).toContain('---');
    expect(diff).toContain('+++');
  });
});

describe('AI patch routes (integration)', () => {
  const logger = new Logger('ai-test', 'error');
  const repo = memoryRepo();
  const claude: ClaudePatchClient = {
    generatePatch: jest.fn().mockResolvedValue({
      patchedCode: 'fixed()',
      explanation: 'ok',
      confidenceScore: 0.8,
      raw: { patchedCode: 'fixed()' },
    }),
  };
  const service = new PatchService(repo, claude, logger);

  const kernel = createHttpKernel({
    serviceName: 'ai-service-test',
    logger,
    collectDefaultPrometheusMetrics: false,
  });
  kernel.app.use('/api/v1/patches', createPatchRouter(service));
  kernel.app.use(kernel.notFoundHandler);
  kernel.app.use(kernel.errorHandler);
  const app = kernel.app;

  it('starts patch generation and returns 202', async () => {
    const res = await request(app)
      .post('/api/v1/patches')
      .send({
        upgradeId: '11111111-1111-4111-8111-111111111111',
        originalCode: 'broken()',
        testFailure: 'AssertionError',
        ecosystem: 'node',
      })
      .expect(202);

    expect(res.body.status).toBe('generating');
    expect(res.body.id).toBeDefined();

    // Allow background task to settle
    await new Promise(r => setTimeout(r, 50));
    const fetched = await request(app)
      .get(`/api/v1/patches/${res.body.id}`)
      .expect(200);
    expect(['generating', 'completed']).toContain(fetched.body.status);
  });

  it('rejects invalid patch payloads', async () => {
    await request(app)
      .post('/api/v1/patches')
      .send({ upgradeId: 'not-a-uuid', originalCode: '' })
      .expect(400);
  });
});
