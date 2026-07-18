import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { asyncHandler } from '@speccursor/shared-utils';
import { ValidationError, ALLOWED_ECOSYSTEMS } from '@speccursor/shared-types';
import type { PatchService } from '../application/patch-service';

function assertValid(req: Request): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Invalid request data', {
      errors: errors.array(),
    });
  }
}

export function createPatchRouter(service: PatchService): Router {
  const router = Router();

  router.post(
    '/',
    body('upgradeId').isUUID(),
    body('originalCode').isString().notEmpty(),
    body('testFailure').isString().notEmpty(),
    body('ecosystem').isIn([...ALLOWED_ECOSYSTEMS]),
    asyncHandler(async (req: Request, res: Response) => {
      assertValid(req);
      const result = await service.createPatch(req.body);
      res.status(202).json(result);
    })
  );

  router.get(
    '/:id',
    param('id').isUUID(),
    asyncHandler(async (req: Request, res: Response) => {
      assertValid(req);
      const result = await service.getPatch(req.params['id']!);
      res.json(result);
    })
  );

  router.get(
    '/',
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString(),
    query('upgradeId').optional().isUUID(),
    asyncHandler(async (req: Request, res: Response) => {
      assertValid(req);
      const listQuery: {
        page?: number;
        limit?: number;
        status?: string;
        upgradeId?: string;
      } = {};
      if (req.query['page']) listQuery.page = Number(req.query['page']);
      if (req.query['limit']) listQuery.limit = Number(req.query['limit']);
      if (typeof req.query['status'] === 'string') {
        listQuery.status = req.query['status'];
      }
      if (typeof req.query['upgradeId'] === 'string') {
        listQuery.upgradeId = req.query['upgradeId'];
      }
      const result = await service.listPatches(listQuery);
      res.json(result);
    })
  );

  return router;
}
