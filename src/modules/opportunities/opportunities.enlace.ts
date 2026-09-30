// Lo que cierra el circulo de una experiencia abierta, y los datos fiscales.
//
// Una abierta no se aparta ni se cotiza: se reserva. Desde la oportunidad hay
// dos caminos —crear la reserva uno mismo o mandarle el enlace al cliente— y
// los dos tienen que llegar a la misma reserva, colgada de la oportunidad,
// para que el panel de venta siga sirviendo.
//
// Los datos de facturacion viven aparte a proposito: no se piden al abrir el
// lead, se piden cuando hay venta. Pedirle el NIT y la direccion a quien
// acaba de escribir por WhatsApp es la forma mas rapida de perderlo.
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { crearSeguimientoDePropuesta, retirarSeguimientos } from '../../lib/seguimientos.js';
import { ajustesDeOperacion, conComisiones, verificarAforo } from '../reservations/reservations.service.js';
import { pasarelaDe } from '../../lib/pasarela.js';
import { logger } from '../../lib/logger.js';

/** Los datos con los que se emite una factura. */
export interface DatosDeFacturacion {
  businessName?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
}

async function oportunidadDe(id: string, companyId: string | null | undefined) {
  if (!companyId) throw Forbidden('No tienes una company asociada');
  const o = await prisma.opportunity.findFirst({
    where: { id, hostCompanyId: companyId, deletedAt: null },
    include: {
      contact: true,
      crmCompany: true,
      reservations: { where: { status: { notIn: ['CANCELLED'] } } },
    },
  });
  if (!o) throw NotFound('Oportunidad no encontrada');
  return o;
}

/** Vacia de verdad: `{ address: {} }` no son datos de facturacion. */
function hayDatos(d: DatosDeFacturacion | null | undefined): boolean {
  if (!d) return false;
  return Boolean(d.businessName || d.documentNumber || d.address?.street);
}

export const enlaceService = {
  /**
   * CRM-32. Crear la reserva de una abierta desde la oportunidad.
   *
   * Entra como PENDING y no como confirmada: una abierta se confirma con el
   * pago completo (CRM-17), y eso lo comprueba `confirmarVenta`. Crearla ya
   * confirmada seria darla por vendida sin haber cobrado.
   */
  async crearReserva(
    id: string,
    companyId: string | null | undefined,
    input: {
      experienceId: string;
      locationId?: string;
      reservationDate: string;
      participants: number;
      total: number;
      duration?: number;
    },
  ) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');
    if (o.reservations.length) throw BadRequest('Esta oportunidad ya tiene una reserva');

    const exp = await prisma.experience.findFirst({
      where: { id: input.experienceId, companyId: companyId!, deletedAt: null },
      select: { id: true, duration: true },
    });
    if (!exp) throw BadRequest('La experiencia no es de tu empresa');

    // "Con disponibilidad" no es un decorado del requisito: una reserva
    // cargada desde el CRM ocupa el mismo aforo que una del catalogo, y sin
    // esta comprobacion el comercial sobrevende sin enterarse.
    const { bloquearLleno, exigePago } = await ajustesDeOperacion(companyId!);
    await verificarAforo(
      exp.id, new Date(input.reservationDate), input.participants, bloquearLleno, exigePago,
    );

    const quienCobra = (await pasarelaDe(companyId!))?.quienCobra ?? 'PLATFORM';
    const pricing = await conComisiones(exp.id, { total: input.total } as never, false, quienCobra);

    const reserva = await prisma.reservation.create({
      data: {
        reservationNumber: `OPO-${Date.now().toString().slice(-6)}-${randomBytes(2)
          .toString('hex')
          .toUpperCase()}`,
        companyId: companyId!,
        experienceId: exp.id,
        locationId: input.locationId ?? null,
        opportunityId: o.id,
        reservationDate: new Date(input.reservationDate),
        duration: input.duration ?? exp.duration ?? 60,
        participants: input.participants,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        client: {
          name: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || 'Cliente',
          email: o.contact?.email ?? null,
          phone: o.contact?.phone ?? null,
        } as Prisma.InputJsonValue,
        collectedBy: quienCobra,
        pricing,
        source: 'MANUAL',
      },
    });

    await prisma.opportunity.update({
      where: { id: o.id },
      data: { stage: 'NEGOTIATION' },
    });

    return reserva;
  },

  /**
   * CRM-32/33. El enlace de reserva con lo que ya sabemos del cliente.
   *
   * Se devuelve un token opaco y no los datos en la URL: un enlace se
   * reenvia, se pega en un chat y acaba en sitios que nadie previo. El token
   * se canjea en `GET /public/solicitud/:token`, que solo responde mientras
   * la oportunidad siga abierta.
   *
   * Mandar el enlace es, en una abierta, enviar la propuesta (CRM-10): es lo
   * que el cliente necesita para decidir. Por eso mueve la etapa y crea su
   * seguimiento.
   */
  async generarEnlaceDeReserva(id: string, companyId: string | null | undefined) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');

    const host = await prisma.company.findUnique({
      where: { id: o.hostCompanyId },
      select: { slug: true, id: true },
    });
    const destino = host?.slug || host?.id;
    if (!destino) throw BadRequest('Tu empresa no tiene catálogo publicado');

    // Se reutiliza el que ya exista: si se regenerara en cada clic, el
    // enlace que el cliente ya tiene dejaria de funcionar.
    const token = o.bookingToken ?? randomBytes(24).toString('base64url');
    const ahora = new Date();

    await prisma.opportunity.update({
      where: { id: o.id },
      data: {
        bookingToken: token,
        bookingTokenAt: o.bookingTokenAt ?? ahora,
        proposalSentAt: o.proposalSentAt ?? ahora,
        ...(o.stage === 'PROSPECTING' || o.stage === 'QUALIFICATION'
          ? { stage: 'PROPOSAL' as const }
          : {}),
      },
    });

    // Se traga sus propios errores: un seguimiento no puede tumbar la
    // generacion del enlace.
    if (!o.proposalSentAt) await crearSeguimientoDePropuesta(o.id, o.contactId);

    return { url: `${env.APP_URL}/book/${destino}?solicitud=${token}`, token };
  },

  /**
   * CRM-33. Lo que el motor publico puede saber del cliente por su token.
   *
   * La proyeccion es explicita y corta: esto lo pide un navegador sin sesion.
   * Sale lo que el propio cliente escribiria en el formulario y nada mas — ni
   * notas internas, ni valor, ni etapa.
   */
  async datosDelEnlace(token: string) {
    const o = await prisma.opportunity.findFirst({
      where: { bookingToken: token, deletedAt: null },
      select: {
        id: true,
        status: true,
        contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        experiences: { select: { experienceId: true }, take: 1 },
      },
    });
    // Un enlace de una venta ya cerrada no sirve, y decir "existe pero esta
    // cerrada" es contar algo de un cliente ajeno a quien tenga el token.
    if (!o || o.status !== 'OPEN') throw NotFound('Este enlace ya no está disponible');

    return {
      nombre: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || '',
      email: o.contact?.email ?? '',
      telefono: o.contact?.phone ?? '',
      experienceId: o.experiences[0]?.experienceId ?? null,
    };
  },

  /**
   * CRM-31. Los datos de facturacion, con lo que ya haya.
   *
   * Orden de preferencia: lo que se congelo al vender, lo de la empresa del
   * CRM, y por ultimo el contacto. Asi nadie vuelve a teclear un NIT que ya
   * esta en el sistema.
   */
  async facturacion(id: string, companyId: string | null | undefined) {
    const o = await oportunidadDe(id, companyId);
    const reserva = o.reservations[0];
    const congelados = reserva?.billingData as DatosDeFacturacion | null;
    if (hayDatos(congelados)) return { datos: congelados!, origen: 'venta' as const };

    if (o.crmCompany) {
      return {
        datos: {
          businessName: o.crmCompany.businessName || o.crmCompany.companyName,
          documentType: o.crmCompany.documentType,
          documentNumber: o.crmCompany.documentNumber,
          email: o.crmCompany.email,
          phone: o.crmCompany.phone,
          address: (o.crmCompany.address ?? null) as DatosDeFacturacion['address'],
        },
        origen: 'empresa' as const,
      };
    }

    return {
      datos: {
        businessName: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || null,
        documentType: null,
        documentNumber: null,
        email: o.contact?.email ?? null,
        phone: o.contact?.phone ?? null,
        address: (o.contact?.address ?? null) as DatosDeFacturacion['address'],
      },
      origen: 'contacto' as const,
    };
  },

  /**
   * Guardar los datos de facturacion.
   *
   * Se escriben en dos sitios y no es duplicar por duplicar: en la reserva
   * quedan congelados para la factura de esta venta, y en la empresa o el
   * contacto quedan vivos para que la proxima venta no los vuelva a pedir.
   */
  async guardarFacturacion(
    id: string,
    companyId: string | null | undefined,
    datos: DatosDeFacturacion,
  ) {
    const o = await oportunidadDe(id, companyId);

    const reserva = o.reservations[0];
    if (reserva) {
      await prisma.reservation.update({
        where: { id: reserva.id },
        data: { billingData: datos as unknown as Prisma.InputJsonValue },
      });
    }

    if (o.crmCompanyId) {
      await prisma.crmCompany.update({
        where: { id: o.crmCompanyId },
        data: {
          businessName: datos.businessName ?? undefined,
          documentType: datos.documentType ?? undefined,
          documentNumber: datos.documentNumber ?? undefined,
          ...(datos.address ? { address: datos.address as Prisma.InputJsonValue } : {}),
        },
      });
    } else if (o.contactId && datos.address) {
      await prisma.contact.update({
        where: { id: o.contactId },
        data: { address: datos.address as Prisma.InputJsonValue },
      });
    }

    return { datos, guardadoEnLaReserva: Boolean(reserva) };
  },
};

/**
 * CRM-18. La venta que se cierra sola porque el cliente pago en linea.
 *
 * Cuando la reserva salio del enlace de una oportunidad y la pasarela cobra,
 * la venta esta hecha: nadie tiene que entrar al CRM a declararlo. Dejarla
 * abierta llenaria el panel de pendientes de ventas ya cobradas.
 *
 * Se traga sus errores a proposito: la llama el webhook de la pasarela, y un
 * fallo aqui no puede hacer que Wompi reintente un pago ya procesado.
 */
export async function cerrarVentaPorPagoEnLinea(opportunityId: string): Promise<void> {
  try {
    const o = await prisma.opportunity.findFirst({
      where: { id: opportunityId, status: 'OPEN', deletedAt: null },
      select: { id: true },
    });
    if (!o) return;
    await prisma.opportunity.update({
      where: { id: o.id },
      data: { stage: 'CLOSED_WON', status: 'WON', actualCloseDate: new Date() },
    });
    await retirarSeguimientos(o.id);
  } catch (err) {
    logger.error({ err, opportunityId }, 'no se pudo cerrar la oportunidad tras el pago');
  }
}

/** Para que la confirmacion de venta pueda avisar de lo que falta. */
export { hayDatos as hayDatosDeFacturacion };
