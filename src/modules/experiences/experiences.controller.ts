import type { Request, Response } from 'express';
import { experiencesService } from './experiences.service.js';
import type {
  CreateExperienceInput,
  ListExperiencesQuery,
  UpdateExperienceInput,
} from './experiences.schemas.js';
import type { ExperienceStatus } from '@prisma/client';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const experiencesController = {
  async list(req: Request, res: Response) {
    const query = q<ListExperiencesQuery>(req);
    const { items, total } = await experiencesService.list(req.user!.companyId, query);
    res.json({
      data: items,
      meta: { total, page: query.page, pageSize: query.limit },
    });
  },

  async featured(req: Request, res: Response) {
    const { limit } = q<{ limit: number }>(req);
    const items = await experiencesService.featured(limit);
    res.json({ data: items });
  },

  async stats(req: Request, res: Response) {
    const { companyId } = p<{ companyId: string }>(req);
    const stats = await experiencesService.statsByCompany(req.user!.companyId, companyId);
    res.json({ data: stats });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const exp = await experiencesService.getById(id, req.user!.companyId);
    res.json({ data: exp });
  },

  async create(req: Request, res: Response) {
    const exp = await experiencesService.create(
      req.user!.companyId,
      req.body as CreateExperienceInput,
    );
    res.status(201).json({ data: exp });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const exp = await experiencesService.update(
      id,
      req.user!.companyId,
      req.body as UpdateExperienceInput,
    );
    res.json({ data: exp });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { status } = req.body as { status: ExperienceStatus };
    const exp = await experiencesService.updateStatus(id, req.user!.companyId, status);
    res.json({ data: exp });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await experiencesService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },
};
