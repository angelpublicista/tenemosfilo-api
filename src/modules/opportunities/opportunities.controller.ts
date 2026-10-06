import type { Request, Response } from 'express';
import { opportunitiesService } from './opportunities.service.js';
import { ventaService } from './opportunities.venta.js';
import { enlaceService, type DatosDeFacturacion } from './opportunities.enlace.js';
import { agendaService } from './opportunities.agenda.js';
import type {
  CrearSolicitudInput,
  CreateOpportunityInput,
  ListOpportunitiesQuery,
  UpdateOpportunityInput,
} from './opportunities.schemas.js';

/** El final del dia de una fecha "YYYY-MM-DD", o la fecha tal cual si trae hora. */
function finDelDia(v: string): Date {
  const d = new Date(v);
  if (v.length <= 10) d.setHours(23, 59, 59, 999);
  return d;
}

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

  // TR-15. Cerrar como ganada cuando lo decide quien lleva la venta, que es
  // lo que hace falta desde que confirmar una reserva ya no la cierra sola.
  async cerrarGanada(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await ventaService.cerrarGanada(id, req.user!.companyId) });
  },

  async perder(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { motivo, notas } = req.body as { motivo: string; notas?: string };
    res.json({ data: await ventaService.perder(id, req.user!.companyId, motivo, notas) });
  },

  async agenda(req: Request, res: Response) {
    const { desde, hasta } = q<{ desde: string; hasta: string }>(req);
    res.json({
      data: await agendaService.enRango(
        req.user!.companyId,
        new Date(desde),
        // "hasta el 14" incluye el 14 entero. Con la fecha a secas se
        // interpretaba como su 00:00, asi que una cotizacion de las ocho de la
        // tarde de ese dia se quedaba fuera del calendario que la pedia.
        finDelDia(hasta),
      ),
    });
  },

  async crearReserva(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await enlaceService.crearReserva(id, req.user!.companyId, req.body as never);
    res.status(201).json({ data: r });
  },

  async enlaceDeReserva(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await enlaceService.generarEnlaceDeReserva(id, req.user!.companyId) });
  },

  async facturacion(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await enlaceService.facturacion(id, req.user!.companyId) });
  },

  async guardarFacturacion(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({
      data: await enlaceService.guardarFacturacion(
        id, req.user!.companyId, req.body as DatosDeFacturacion,
      ),
    });
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
    const o = await opportunitiesService.getById(id, req.user!.id);
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
