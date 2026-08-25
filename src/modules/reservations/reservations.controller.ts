import type { Request, Response } from 'express';
import { reservationsService } from './reservations.service.js';
import type {
  CancelInput,
  CreateReservationInput,
  ListReservationsQuery,
  RescheduleInput,
  UpdateReservationInput,
} from './reservations.schemas.js';
import type { PaymentStatus, ReservationStatus } from '@prisma/client';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

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
      req.body as CreateReservationInput,
      { asReseller },
    );
    res.status(201).json({ data: r });
  },

  async createPublic(req: Request, res: Response) {
    // Endpoint sin auth; el body NO debe permitir status/paymentStatus arbitrarios
    const r = await reservationsService.createPublic(req.body as CreateReservationInput);
    res.status(201).json({ data: r });
  },

  async mias(req: Request, res: Response) {
    const items = await reservationsService.mias(req.user!.id, req.user!.email);
    res.json({ data: items });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.getById(id);
    res.json({ data: r });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.update(
      id,
      req.user!.companyId,
      req.body as UpdateReservationInput,
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

  async reschedule(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await reservationsService.reschedule(
      id,
      req.user!.companyId,
      req.body as RescheduleInput,
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
