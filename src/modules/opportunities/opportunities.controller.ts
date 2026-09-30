import type { Request, Response } from 'express';
import { opportunitiesService } from './opportunities.service.js';
import { ventaService } from './opportunities.venta.js';
import type {
  CrearSolicitudInput,
  CreateOpportunityInput,
  ListOpportunitiesQuery,
  UpdateOpportunityInput,
} from './opportunities.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const opportunitiesController = {
  async list(req: Request, res: Response) {
    const items = await opportunitiesService.list(
      req.user!.companyId,
      q<ListOpportunitiesQuery>(req),
    );
    res.json({ data: items });
  },

  async crearPreReserva(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await ventaService.crearPreReserva(
      id, req.user!.companyId, req.user!.id, req.body as never,
    );
    res.status(201).json({ data: r });
  },

  async registrarPago(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { monto } = req.body as { monto: number };
    res.json({ data: await ventaService.registrarPago(id, req.user!.companyId, monto) });
  },

  async autorizarCondicion(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { nota } = req.body as { nota: string };
    res.json({
      data: await ventaService.autorizarCondicionDePago(id, req.user!.companyId, req.user!.id, nota),
    });
  },

  async confirmarVenta(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await ventaService.confirmarVenta(id, req.user!.companyId) });
  },

  async perder(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { motivo, notas } = req.body as { motivo: string; notas?: string };
    res.json({ data: await ventaService.perder(id, req.user!.companyId, motivo, notas) });
  },

  async marcarPropuestaEnviada(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { nota } = (req.body ?? {}) as { nota?: string };
    const o = await opportunitiesService.marcarPropuestaEnviada(id, req.user!.companyId, nota);
    res.json({ data: o });
  },

  async crearSolicitud(req: Request, res: Response) {
    const o = await opportunitiesService.crearSolicitud(
      req.user!.id,
      req.user!.companyId,
      req.body as CrearSolicitudInput,
    );
    res.status(201).json({ data: o });
  },

  async create(req: Request, res: Response) {
    const o = await opportunitiesService.create(
      req.user!.id,
      req.user!.companyId,
      req.body as CreateOpportunityInput,
    );
    res.status(201).json({ data: o });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const o = await opportunitiesService.getById(id);
    res.json({ data: o });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const o = await opportunitiesService.update(
      id,
      req.user!.companyId,
      req.body as UpdateOpportunityInput,
    );
    res.json({ data: o });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await opportunitiesService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },
};
