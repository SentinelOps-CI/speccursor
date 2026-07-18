import request from 'supertest';
import { UpgradeService } from '../../application/upgrade-service';
import type { UpgradeRepository } from '../../infrastructure/upgrade-repository';
import type { UpgradeQueue } from '../../infrastructure/upgrade-queue';
import { Logger } from '@speccursor/shared-utils';
import { ValidationError, NotFoundError } from '@speccursor/shared-types';

function createMemoryRepo(): UpgradeRepository {
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
      let all = [...rows.values()];
      if (filter.status) all = all.filter(r => r.status === filter.status);
      if (filter.ecosystem)
        all = all.filter(r => r.ecosystem === filter.ecosystem);
      const total = all.length;
      const upgrades = all.slice(filter.offset, filter.offset + filter.limit);
      return { upgrades, total };
    },
    async healthCheck() {
      return true;
    },
    async close() {},
  } as UpgradeRepository;
}

describe('Controller upgrade routes (integration)', () => {
  const logger = new Logger('controller-test', 'error');
  const repo = createMemoryRepo();
  const queue: UpgradeQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UpgradeService(repo, queue, logger);
  let app: import('express').Express;

  beforeAll(() => {
    const { createUpgradeRouter } = require('../../routes/upgrades');
    const { createHttpKernel } = require('@speccursor/shared-utils');
    const kernel = createHttpKernel({
      serviceName: 'controller-test',
      logger,
      collectDefaultPrometheusMetrics: false,
    });
    kernel.app.use('/api/v1/upgrades', createUpgradeRouter(service));
    kernel.app.use(kernel.notFoundHandler);
    kernel.app.use(kernel.errorHandler);
    app = kernel.app;
  });

  it('GET /health returns healthy', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('controller-test');
  });

  it('rejects invalid create payloads', async () => {
    const res = await request(app)
      .post('/api/v1/upgrades')
      .send({ repository: '', ecosystem: 'nope' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('creates and fetches an upgrade', async () => {
    const created = await request(app)
      .post('/api/v1/upgrades')
      .send({
        repository: 'acme/widgets',
        ecosystem: 'node',
        packageName: 'left-pad',
        currentVersion: '1.0.0',
        targetVersion: '1.0.1',
      })
      .expect(201);

    expect(created.body.id).toBeDefined();
    expect(created.body.status).toBe('pending');
    expect(queue.enqueue).toHaveBeenCalled();

    const fetched = await request(app)
      .get(`/api/v1/upgrades/${created.body.id}`)
      .expect(200);
    expect(fetched.body.packageName).toBe('left-pad');
  });

  it('lists upgrades with accurate total', async () => {
    const res = await request(app).get('/api/v1/upgrades?limit=10').expect(200);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.upgrades)).toBe(true);
  });
});

describe('UpgradeService unit', () => {
  const logger = new Logger('svc-test', 'error');
  const repo = createMemoryRepo();
  const queue: UpgradeQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    healthCheck: async () => true,
    close: async () => undefined,
  };
  const service = new UpgradeService(repo, queue, logger);

  it('throws ValidationError for bad ecosystem', async () => {
    await expect(
      service.createUpgrade({
        repository: 'a/b',
        ecosystem: 'cobol',
        packageName: 'x',
        currentVersion: '1',
        targetVersion: '2',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError for missing upgrade', async () => {
    await expect(
      service.getUpgrade('00000000-0000-4000-8000-000000000099')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
