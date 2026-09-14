import type { Request, Response } from 'express';
import { menusService } from './menus.service.js';
import type { CreateMenuInput, ListMenusQuery, UpdateMenuInput } from './menus.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const menusController = {
  async list(req: Request, res: Response) {
    const crossCompany = req.user!.role === 'RESELLER';
    const items = await menusService.list(req.user!.companyId, q<ListMenusQuery>(req), {
      crossCompany,
    });
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const menu = await menusService.create(req.user!.companyId, req.body as CreateMenuInput);
    res.status(201).json({ data: menu });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const crossCompany = req.user!.role === 'RESELLER';
    const menu = await menusService.getById(id, req.user!.companyId, { crossCompany });
    res.json({ data: menu });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const menu = await menusService.update(id, req.user!.companyId, req.body as UpdateMenuInput);
    res.json({ data: menu });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await menusService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },
};
