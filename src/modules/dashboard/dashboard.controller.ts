import type { Request, Response } from 'express';
import { dashboardService } from './dashboard.service.js';
import type { ActivitiesQuery, StatsQuery } from './dashboard.schemas.js';

const q = <T,>(req: Request) => req.query as unknown as T;

export const dashboardController = {
  async stats(req: Request, res: Response) {
    const { companyId } = q<StatsQuery>(req);
    const stats = await dashboardService.stats(req.user!.companyId, companyId);
    res.json({ data: stats });
  },

  async activities(req: Request, res: Response) {
    const { companyId, limit } = q<ActivitiesQuery>(req);
    const items = await dashboardService.recentActivities(req.user!.companyId, companyId, limit);
    res.json({ data: items });
  },
};
