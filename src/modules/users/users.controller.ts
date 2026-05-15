import type { Request, Response } from 'express';
import { usersService } from './users.service.js';
import type { ListUsersQuery, UpdateUserInput } from './users.schemas.js';

// Helpers: el middleware validate() ya parseo y reasigno req.query/params/body
// con los datos validados por zod. Aca solo recuperamos el tipo correcto.
const q = <T,>(req: Request) => req.query as unknown as T;
const p = <T,>(req: Request) => req.params as unknown as T;

export const usersController = {
  async me(req: Request, res: Response) {
    const user = await usersService.getById(req.user!.id);
    res.json({ data: user });
  },

  async list(req: Request, res: Response) {
    const query = q<ListUsersQuery>(req);
    const { items, total } = await usersService.list(query);
    res.json({
      data: items,
      meta: { total, page: query.page, pageSize: query.pageSize },
    });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const user = await usersService.getById(id);
    res.json({ data: user });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    // Solo self-update o admin. Sin esto cualquier user autenticado podria
    // modificar a otro user.
    if (id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Solo puedes actualizar tu propio perfil' },
      });
    }
    const user = await usersService.update(id, req.body as UpdateUserInput);
    res.json({ data: user });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await usersService.softDelete(id);
    res.status(204).end();
  },
};
