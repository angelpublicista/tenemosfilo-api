import type { Request, Response } from 'express';
import { usersService } from './users.service.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.schemas.js';

// Helpers: el middleware validate() ya parseo y reasigno req.query/params/body
// con los datos validados por zod. Aca solo recuperamos el tipo correcto.
const q = <T,>(req: Request) => req.query as unknown as T;
const p = <T,>(req: Request) => req.params as unknown as T;

export const usersController = {
  async me(req: Request, res: Response) {
    const user = await usersService.getById(req.user!.id);
    res.json({ data: user });
  },

  async create(req: Request, res: Response) {
    const user = await usersService.create(req.body as CreateUserInput);
    res.status(201).json({ data: user });
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
    const esAdmin = req.user!.role === 'ADMIN';

    // Solo self-update o admin. Sin esto cualquier user autenticado podria
    // modificar a otro user.
    if (id !== req.user!.id && !esAdmin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Solo puedes actualizar tu propio perfil' },
      });
    }

    let input = req.body as UpdateUserInput;

    // Editarse a uno mismo es cambiar el nombre o el telefono, no el rol
    // ni la empresa ni si la cuenta esta activa. Sin este filtro, cualquier
    // usuario podia mandar { role: 'ADMIN' } sobre su propio perfil y
    // quedarse con la plataforma entera. Se descartan en silencio en vez
    // de fallar: quien edita su perfil desde la aplicacion no los manda, y
    // quien los manda a mano no merece una guia de que probar despues.
    if (!esAdmin) {
      const { role, companyId, isActive, ...propios } = input;
      void role;
      void companyId;
      void isActive;
      input = propios;
    }

    const user = await usersService.update(id, input);
    res.json({ data: user });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await usersService.softDelete(id);
    res.status(204).end();
  },
};
