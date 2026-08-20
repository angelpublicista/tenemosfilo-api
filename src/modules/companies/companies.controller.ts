import type { Request, Response } from 'express';
import { companiesService } from './companies.service.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type {
  CreateCompanyInput,
  ListCompaniesQuery,
  UpdateCompanyInput,
} from './companies.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;

export const companiesController = {
  async create(req: Request, res: Response) {
    const input = req.body as CreateCompanyInput;
    const esAdmin = req.user!.role === 'ADMIN';

    // Un ADMIN administra la plataforma, no opera un negocio dentro de ella:
    // las empresas que crea son siempre de un anfitrion. Si quiere las suyas,
    // debe crearse un usuario con perfil de anfitrion.
    if (esAdmin) {
      if (!input.ownerId) {
        throw BadRequest(
          'Indica el anfitrión dueño de la empresa. Un administrador no puede ser dueño; ' +
            'si necesitas experiencias propias, crea un usuario con rol Anfitrión.',
        );
      }
      await companiesService.assertPuedeSerDuenio(input.ownerId);
    }

    // Fuera del caso ADMIN el dueño es siempre quien crea, aunque el body
    // traiga otro ownerId.
    const ownerId = esAdmin ? input.ownerId! : req.user!.id;
    const company = await companiesService.create(ownerId, input);
    res.status(201).json({ data: company });
  },

  async getMine(req: Request, res: Response) {
    // req.user.companyId es la empresa en la que se esta operando: la del
    // token, o la que dejo applyActingCompany si vino la cabecera. Hay que
    // resolver por ahi y no por el usuario en BD, porque si no:
    //   - al ADMIN le devolvia null (no pertenece a ninguna) y las pantallas
    //     de anfitrion lo mandaban a /company-setup;
    //   - a un HOST con varias le devolvia siempre la primera, ignorando la
    //     que acababa de elegir en el selector.
    // El fallback cubre tokens antiguos que no traigan companyId.
    const company =
      (await companiesService.getByIdOrNull(req.user!.companyId)) ??
      (req.user!.role === 'ADMIN' ? null : await companiesService.getByUser(req.user!.id));
    res.json({ data: company });
  },

  /** Empresas entre las que puede moverse quien llama (para el selector). */
  async listMine(req: Request, res: Response) {
    const items = await companiesService.listAccessible(req.user!.id);
    res.json({ data: items });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.getById(id);
    res.json({ data: company });
  },

  async getBySlug(req: Request, res: Response) {
    const { slug } = p<{ slug: string }>(req);
    const company = await companiesService.getBySlug(slug);
    res.json({ data: company });
  },

  async getByOwner(req: Request, res: Response) {
    const { userId } = p<{ userId: string }>(req);
    const company = await companiesService.getByOwner(userId);
    if (!company) throw NotFound('Sin company para este owner');
    res.json({ data: company });
  },

  async list(req: Request, res: Response) {
    const query = req.query as unknown as ListCompaniesQuery;
    const { items, total } = await companiesService.list(query);
    res.json({
      data: items,
      meta: { total, page: query.page, pageSize: query.pageSize },
    });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.update(
      id,
      req.user!.id,
      req.body as UpdateCompanyInput,
      { isAdmin: req.user!.role === 'ADMIN' },
    );
    res.json({ data: company });
  },

  /** DELETE /companies/:id -> soft-delete. PATCH .../restore lo revierte. */
  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.setDeleted(id, true);
    res.json({ data: company });
  },

  async restore(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.setDeleted(id, false);
    res.json({ data: company });
  },

  async associateMe(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const result = await companiesService.associateUser(req.user!.id, id);
    res.json({ data: result });
  },
};
