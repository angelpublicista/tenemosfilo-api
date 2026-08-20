import type { Request, Response } from 'express';
import { auditService } from './audit.service.js';
import type { ListAuditQuery } from './audit.schemas.js';

const q = <T,>(req: Request) => req.query as unknown as T;

export const auditController = {
  async list(req: Request, res: Response) {
    const query = q<ListAuditQuery>(req);
    const { items, total } = await auditService.list(query);
    res.json({
      data: items,
      meta: { total, page: query.page, pageSize: query.pageSize },
    });
  },
};
