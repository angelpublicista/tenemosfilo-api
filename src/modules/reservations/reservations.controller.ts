import type { Request, Response } from 'express';
import { reservationsService } from './reservations.service.js';
import type {
  CancelInput,
  CargoAdicionalInput,
  DeMiCanalQuery,
  CreateReservationInput,
  ListReservationsQuery,
  ReembolsoInput,
  RescheduleInput,
  UpdateReservationInput,
} from './reservations.schemas.js';
import type { PaymentStatus, ReservationStatus } from '@prisma/client';
import { BadRequest } from '../../lib/errors.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

/**
 * La clave de idempotencia que manda quien vende (TR-43).
 *
 * Va en cabecera y no en el cuerpo porque no es un dato de la reserva: es
 * una propiedad de la llamada. Asi se usa en la industria —`Idempotency-Key`
 * de Stripe— y asi lo espera quien integra.
 *
 * Se acota el largo: es una clave, no un sitio donde guardar texto.
 */
function claveDeIdempotencia(req: Request): string | undefined {
  const v = req.header('idempotency-key')?.trim();
  if (!v) return undefined;
  if (v.length > 200) throw BadRequest('La clave de idempotencia es demasiado larga.');
  return v;
}

export const reservationsController = {
  async list(req: Request, res: Response) {
    const query = q<ListReservationsQuery>(req);
    const { items, total } = await reservationsService.list(req.user!.companyId, query);
    res.json({ data: items, meta: { total, page: query.page, pageSize: query.limit } });
  },

  async create(req: Request, res: Response) {
    const asReseller = req.user!.role === 'RESELLER';
    const r = await reservationsService.create(
      req.user!.companyId,
      { ...(req.body as CreateReservationInput), idempotencyKey: claveDeIdempotencia(req) },
      { asReseller },
    );
    res.status(201).json({ data: r });
  },

  async createPublic(req: Request, res: Response) {
    // Endpoint sin auth; el body NO debe permitir status/paymentStatus arbitrarios
    const r = await reservationsService.createPublic({
      ...(req.body as CreateReservationInput),
      idempotencyKey: claveDeIdempotencia(req),
    });
    res.status(201).json({ data: r });
  },

  // TR-25. Lo que vendio este canal, con la asistencia de cada reserva.
  async deMiCanal(req: Request, res: Response) {
    const { items, total, resumen } = await reservationsService.deMiCanal(
      req.user!.companyId,
      q<DeMiCanalQuery>(req),
    );
    res.json({ data: items, meta: { total, resumen } });
  },

  async mias(req: Request, res: Response) {
    const items = await reservationsService.mias(req.user!.id, req.user!.email);
    res.json({ data: items });
  },

  /**
   * El anfitrion valida el codigo que le enseña el cliente en la puerta.
   *
   * Un 404 aqui no es un fallo: significa que esa venta no entro por FILO, y
   * es la unica forma de enterarse.
   */
  async validarCodigo(req: Request, res: Response) {
    const { codigo } = req.body as { codigo: string };
    const r = await reservationsService.validarCodigo(codigo, {
      companyId: req.user!.companyId,
      role: req.user!.role,
      id: req.user!.id,
    });
    res.json({ data: r.reserva, meta: { yaHabiaLlegado: r.yaHabiaLlegado } });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.getById(id, {
      companyId: req.user!.companyId,
      role: req.user!.role,
    });
    res.json({ data: r });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.update(
      id,
      req.user!.companyId,
      req.body as UpdateReservationInput,
      // Quien lo hizo, para el historial. Por email y no por id: el registro
      // tiene que seguir contando lo que paso aunque el usuario se borre.
      { id: req.user!.id, email: req.user!.email },
    );
    res.json({ data: r });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { status } = req.body as { status: ReservationStatus };
    const r = await reservationsService.updateStatus(id, req.user!.companyId, status);
    res.json({ data: r });
  },

  async updatePaymentStatus(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { paymentStatus } = req.body as { paymentStatus: PaymentStatus };
    const r = await reservationsService.updatePaymentStatus(id, req.user!.companyId, paymentStatus);
    res.json({ data: r });
  },

  async cancel(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.cancel(id, req.user!.companyId, req.body as CancelInput);
    res.json({ data: r });
  },

  // TR-30. Devolver dinero de una reserva que sigue en pie. Ajusta la venta
  // y la base del fee, no solo apunta el numero.
  async reembolsar(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.registrarReembolso(
      id,
      req.user!.companyId,
      req.body as ReembolsoInput,
    );
    res.json({ data: r });
  },

  async marcarReembolsoPagado(req: Request, res: Response) {
    const { id, refundId } = p<{ id: string; refundId: string }>(req);
    const r = await reservationsService.marcarReembolsoPagado(id, req.user!.companyId, refundId);
    res.json({ data: r });
  },

  async reembolsos(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await reservationsService.reembolsosDe(id, req.user!.companyId) });
  },

  // TR-12. Un cargo adicional acordado despues de vender. El precio original
  // no se toca; esto suma aparte.
  async cargoAdicional(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.registrarCargoAdicional(
      id,
      req.user!.companyId,
      req.body as CargoAdicionalInput,
      { id: req.user!.id, email: req.user!.email },
    );
    res.json({ data: r });
  },

  /**
   * TR-27. El canal actualiza su propia venta.
   *
   * Hace falta porque no hay sincronizacion con la plataforma del revendedor:
   * su cliente le cancela o le cambia la fecha a EL, y si no puede reflejarlo
   * aqui, el anfitrion guarda una mesa para gente que ya no viene.
   *
   * Queda constancia de que el cambio vino del canal, no del anfitrion: en el
   * historial se ve quien lo hizo.
   */
  async updateDeMiCanal(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.update(
      id,
      req.user!.companyId,
      req.body as UpdateReservationInput,
      { id: req.user!.id, email: req.user!.email },
      { comoCanal: true },
    );
    res.json({ data: r });
  },

  async cancelarDeMiCanal(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.cancel(
      id,
      req.user!.companyId,
      // El canal cancela en nombre de su cliente: es el comensal quien se cae,
      // no el anfitrion, y de eso depende el reembolso.
      { ...(req.body as CancelInput), cancelledBy: 'client' },
      { comoCanal: true },
    );
    res.json({ data: r });
  },

  // TR-39. Que le fue pasando a esta reserva.
  async historial(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    res.json({ data: await reservationsService.historialDe(id, req.user!.companyId) });
  },

  async reschedule(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.reschedule(
      id,
      req.user!.companyId,
      req.body as RescheduleInput,
      { id: req.user!.id, email: req.user!.email },
    );
    res.json({ data: r });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await reservationsService.remove(id, req.user!.companyId);
    res.status(204).end();
  },

  async stats(req: Request, res: Response) {
    const { companyId } = p<{ companyId: string }>(req);
    const stats = await reservationsService.statsByCompany(req.user!.companyId, companyId);
    res.json({ data: stats });
  },
};
