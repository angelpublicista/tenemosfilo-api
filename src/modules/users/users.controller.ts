import type { Request, Response } from 'express';
import { authService } from '../auth/auth.service.js';
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
    const input = req.body as CreateUserInput;
    const user = await usersService.create(input);

    // Si el admin no fijo contraseña, la cuenta nace inaccesible y hay que
    // invitar a su titular a elegir una. Se espera al envio —a diferencia de
    // los avisos de reserva— para poder decir en la respuesta si el correo
    // salio: quien acaba de crear la cuenta necesita saber si la persona va
    // a recibir el enlace o si tiene que buscar otra via.
    const invitado = input.password ? false : await authService.enviarInvitacion(user.id);

    res.status(201).json({
      data: user,
      meta: { invitacionEnviada: invitado },
    });
  },

  /**
   * Reenviar la invitacion.
   *
   * Emite un enlace nuevo e invalida el anterior. Sirve tambien para quien ya
   * tiene contraseña: el enlace le permite fijar otra, que es lo mismo que
   * hace la recuperacion. No se comprueba si la cuenta ya se activo porque
   * negarselo no protegeria de nada y dejaria al admin sin salida.
   */
  async reinvitar(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const enviado = await authService.enviarInvitacion(id);
    if (!enviado) {
      return res.status(502).json({
        error: {
          code: 'INVITE_NOT_SENT',
          message: 'No se pudo enviar la invitación. Revisa que la cuenta esté activa y el correo configurado.',
        },
      });
    }
    res.json({ data: { invitacionEnviada: true } });
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
