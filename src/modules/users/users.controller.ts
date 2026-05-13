import type { Request, Response } from 'express';
import { usersService } from './users.service.js';

export const usersController = {
  async me(req: Request, res: Response) {
    const user = await usersService.getById(req.user!.id);
    res.json({ data: user });
  },

  async list(req: Request, res: Response) {
    const { items, total } = await usersService.list(req.query as never);
    const { page, pageSize } = req.query as { page: number; pageSize: number };
    res.json({ data: items, meta: { total, page, pageSize } });
  },

  async getById(req: Request, res: Response) {
    const user = await usersService.getById(req.params.id);
    res.json({ data: user });
  },

  async update(req: Request, res: Response) {
    const user = await usersService.update(req.params.id, req.body);
    res.json({ data: user });
  },

  async remove(req: Request, res: Response) {
    await usersService.softDelete(req.params.id);
    res.status(204).end();
  },
};
