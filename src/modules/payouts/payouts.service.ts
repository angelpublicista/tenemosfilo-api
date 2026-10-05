import { Prisma, type PayoutRole } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type {
  CreatePayoutInput,
  DesgloseQuery,
  ListEarningsQuery,
  ListPayoutsQuery,
} from './payouts.schemas.js';

export type Saldo = {
  companyId: string;
  companyName: string;
  role: PayoutRole;
  /**
   * Quien debe este dinero. null = FILO.
   *
   * Existe desde que un anfitrion puede cobrar con su propia pasarela: ahi el
   * dinero nunca llega a FILO, asi que la comision del revendedor la debe el
   * anfitrion. Sin este campo, las dos deudas se sumarian en una sola cifra y
   * nadie sabria a quien reclamarle.
   */
  payerCompanyId: string | null;
  payerCompanyName: string | null;
  /** Devengado por reservas ya cobradas. */
  accrued: number;
  /** Ya transferido. */
  paid: number;
  /** Lo que falta por dispersar. */
  pending: number;
};

// Solo cuentan las reservas efectivamente cobradas: es dinero que ya esta en
// alguna cuenta. Una cancelada no genera deuda aunque figure como pagada.
const CONDICION_COBRADA = Prisma.sql`"paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'`;

// Las que cobro FILO. Son las unicas de las que FILO puede deber algo: del
// resto nunca vio el dinero.
const COBRO_FILO = Prisma.sql`r."collectedBy" = 'PLATFORM'`;

// Las que cobro el anfitrion directamente en su cuenta.
const COBRO_ANFITRION = Prisma.sql`r."collectedBy" = 'HOST'`;

/** Suma un campo del JSON de pricing. Prisma no agrega dentro de JSON. */
function sumaPricing(campo: string) {
  return Prisma.sql`COALESCE(SUM((pricing ->> ${campo})::numeric), 0)`;
}

/**
 * Nucleo del calculo, compartido por el panel de FILO y por el de cada
 * empresa. Vive en un solo sitio a proposito: si el anfitrion y el admin
 * sumaran distinto, uno de los dos estaria viendo mal su dinero.
 *
 * Con `companyId` se limita a esa empresa; sin el, agrega la plataforma.
 */
async function calcularSaldos(companyId?: string): Promise<{ items: Saldo[]; filoRetained: number }> {
  const soloEmpresaHost = companyId
    ? Prisma.sql`AND r."companyId" = ${companyId}`
    : Prisma.empty;
  const soloEmpresaReseller = companyId
    ? Prisma.sql`AND r."resellerCompanyId" = ${companyId}`
    : Prisma.empty;

  // Una empresa puede aparecer en esto por tres vias: como anfitriona a la que
  // FILO le debe, como revendedora a la que le debe FILO, y como revendedora a
  // la que le debe un anfitrion que cobro directo. El filtro por empresa tiene
  // que alcanzar a las tres o un anfitrion veria su deuda y no su saldo.
  const soloEmpresaPagadora = companyId
    ? Prisma.sql`AND r."companyId" = ${companyId}`
    : Prisma.empty;
  const soloEmpresaEnDeudaDirecta = companyId
    ? Prisma.sql`AND (r."resellerCompanyId" = ${companyId} OR r."companyId" = ${companyId})`
    : Prisma.empty;

  const [comoHost, comoReseller, deudaDelAnfitrion, dispersado, retenido] = await Promise.all([
    prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."companyId"          AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('hostEarnings')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."companyId"
        WHERE ${CONDICION_COBRADA} AND ${COBRO_FILO} ${soloEmpresaHost}
        GROUP BY r."companyId", c."companyName"
      `,
    prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."resellerCompanyId"  AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('resellerCommission')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."resellerCompanyId"
        WHERE ${CONDICION_COBRADA} AND ${COBRO_FILO}
          AND r."resellerCompanyId" IS NOT NULL ${soloEmpresaReseller}
        GROUP BY r."resellerCompanyId", c."companyName"
      `,
    // Lo que un anfitrion le debe a un revendedor por haberle vendido una
    // reserva que el cobro en su propia cuenta. Se agrupa por la pareja: la
    // deuda es de un anfitrion concreto con un revendedor concreto, y sumarlas
    // en un total daria una cifra que nadie sabe a quien reclamar.
    prisma.$queryRaw<
      { companyId: string; companyName: string; payerCompanyId: string; payerCompanyName: string; total: number }[]
    >`
        SELECT r."resellerCompanyId"  AS "companyId",
               rc."companyName"       AS "companyName",
               r."companyId"          AS "payerCompanyId",
               hc."companyName"       AS "payerCompanyName",
               ${sumaPricing('resellerCommission')} AS total
        FROM "Reservation" r
        JOIN "Company" rc ON rc.id = r."resellerCompanyId"
        JOIN "Company" hc ON hc.id = r."companyId"
        WHERE ${CONDICION_COBRADA} AND ${COBRO_ANFITRION}
          AND r."resellerCompanyId" IS NOT NULL ${soloEmpresaEnDeudaDirecta}
        GROUP BY r."resellerCompanyId", rc."companyName", r."companyId", hc."companyName"
      `,
    prisma.payout.groupBy({
      by: ['companyId', 'role', 'payerCompanyId'],
      _sum: { amount: true },
      ...(companyId
        ? { where: { OR: [{ companyId }, { payerCompanyId: companyId }] } }
        : {}),
    }),
    prisma.$queryRaw<{ total: number }[]>`
        SELECT ${sumaPricing('filoCommission')} AS total
        FROM "Reservation" r
        WHERE ${CONDICION_COBRADA} AND ${COBRO_FILO} ${soloEmpresaPagadora}
      `,
  ]);

  const pagadoPor = new Map(
    dispersado.map((d) => [
      `${d.companyId}:${d.role}:${d.payerCompanyId ?? ''}`,
      Number(d._sum.amount ?? 0),
    ]),
  );

  const construir = (
    filas: {
      companyId: string;
      companyName: string;
      total: number;
      payerCompanyId?: string;
      payerCompanyName?: string;
    }[],
    role: PayoutRole,
  ): Saldo[] =>
    filas.map((f) => {
      const accrued = Number(f.total);
      const payerCompanyId = f.payerCompanyId ?? null;
      const paid = pagadoPor.get(`${f.companyId}:${role}:${payerCompanyId ?? ''}`) ?? 0;
      return {
        companyId: f.companyId,
        companyName: f.companyName,
        role,
        payerCompanyId,
        payerCompanyName: f.payerCompanyName ?? null,
        accrued,
        paid,
        pending: accrued - paid,
      };
    });

  const items = [
    ...construir(comoHost, 'HOST'),
    ...construir(comoReseller, 'RESELLER'),
    ...construir(deudaDelAnfitrion, 'RESELLER'),
  ]
    // Las que ya no deben nada y nunca cobraron no aportan informacion.
    .filter((s) => s.accrued > 0 || s.paid > 0)
    .sort((a, b) => b.pending - a.pending);

  return { items, filoRetained: Number(retenido[0]?.total ?? 0) };
}

export const payoutsService = {
  /**
   * Lo que FILO le debe a cada empresa, separado por rol: como anfitriona
   * (sus ingresos) y como revendedora (sus comisiones).
   */
  async balances(): Promise<{ items: Saldo[]; filoRetained: number }> {
    return calcularSaldos();
  },

  /**
   * Lo que ve una empresa de si misma: sus saldos y las transferencias que
   * ya recibio. Nunca acepta un companyId del cliente — se resuelve desde
   * la sesion — para que nadie consulte las cuentas de otro.
   */
  async resumenEmpresa(companyId: string) {
    const [{ items }, payouts] = await Promise.all([
      calcularSaldos(companyId),
      prisma.payout.findMany({
        where: { companyId },
        orderBy: { paidAt: 'desc' },
        take: 50,
        // Sin `createdById` ni `createdByEmail`: quien de FILO registro la
        // transferencia es asunto interno.
        select: { id: true, role: true, amount: true, reference: true, paidAt: true },
      }),
    ]);

    // Lo que le deben y lo que debe son dos cosas distintas y no se pueden
    // sumar en la misma cifra. Una empresa que cobra directo y vende por
    // revendedores aparece en las dos listas, y mezclarlas le diria que tiene
    // saldo a favor justo cuando lo que tiene es una deuda.
    const balances = items.filter((s) => s.companyId === companyId);
    const debts = items.filter((s) => s.payerCompanyId === companyId);

    const suma = (filas: Saldo[], campo: 'accrued' | 'paid' | 'pending') =>
      filas.reduce((acc, s) => acc + s[campo], 0);

    return {
      balances,
      debts,
      payouts,
      totals: {
        accrued: suma(balances, 'accrued'),
        paid: suma(balances, 'paid'),
        pending: suma(balances, 'pending'),
        /** Lo que esta empresa le debe a otras por haber cobrado directo. */
        owed: suma(debts, 'pending'),
      },
    };
  },

  /**
   * Las reservas que componen lo devengado, para que el anfitrion pueda
   * cuadrar el total con reservas concretas en vez de creerse una cifra.
   */
  async ingresosEmpresa(companyId: string, query: ListEarningsQuery) {
    const { page, pageSize, role } = query;

    const where: Prisma.ReservationWhereInput = {
      paymentStatus: 'PAID',
      status: { not: 'CANCELLED' },
      ...(role === 'RESELLER' ? { resellerCompanyId: companyId } : { companyId }),
    };

    const [items, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        orderBy: { reservationDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          reservationNumber: true,
          reservationDate: true,
          participants: true,
          // TR-25. Cuanta gente aparecio, no solo cuanta se vendio: el canal
          // tiene que poder reportarselo a su cliente.
          attendedCount: true,
          status: true,
          pricing: true,
          collectedBy: true,
          experience: { select: { id: true, title: true } },
          company: { select: { id: true, companyName: true } },
        },
      }),
      prisma.reservation.count({ where }),
    ]);

    // El desglose se aplana aqui para no obligar a cada pantalla a saber
    // como esta guardado el JSON de pricing.
    const filas = items.map((r) => {
      const p = (r.pricing ?? {}) as Record<string, unknown>;
      const num = (campo: string) => Number(p[campo] ?? 0);
      return {
        id: r.id,
        reservationNumber: r.reservationNumber,
        reservationDate: r.reservationDate,
        participants: r.participants,
        attendedCount: r.attendedCount,
        status: r.status,
        experienceTitle: r.experience?.title ?? null,
        companyName: r.company?.companyName ?? null,
        // Sin esto la lista no cuadra con el total de arriba: las que cobro el
        // anfitrion por su cuenta ya estan en su banco y FILO no le debe nada
        // por ellas, pero siguen siendo ingresos suyos y tienen que verse.
        collectedBy: r.collectedBy,
        total: num('total'),
        filoCommission: num('filoCommission'),
        resellerCommission: num('resellerCommission'),
        // Segun en calidad de que se mira la reserva: lo que gana el
        // anfitrion o la comision que le queda al revendedor.
        earnings: role === 'RESELLER' ? num('resellerCommission') : num('hostEarnings'),
      };
    });

    return { items: filas, total };
  },

  /**
   * TR-28. Los ingresos del periodo, cortados por donde hay que decidir algo.
   *
   * Cuatro cortes porque son cuatro preguntas distintas que un anfitrion se
   * hace de verdad: como vengo mes a mes, que experiencia me da mas, si lo
   * virtual vale la pena, y cuanto me trae cada canal frente a lo que me
   * cuesta su comision.
   *
   * Se calcula sobre las reservas cobradas del rango, con el mismo criterio
   * que los saldos: si el desglose sumara distinto que el total de arriba,
   * uno de los dos estaria mintiendo.
   */
  async desglose(companyId: string, query: DesgloseQuery) {
    const desde = new Date(query.desde);
    const hasta = new Date(query.hasta);
    // El "hasta" incluye su dia completo: un rango "hasta el 31" que corta a
    // las 00:00 deja fuera todo el 31.
    hasta.setHours(23, 59, 59, 999);
    if (hasta < desde) throw BadRequest('La fecha final no puede ser anterior a la inicial');

    const comoReseller = query.role === 'RESELLER';

    const reservas = await prisma.reservation.findMany({
      where: {
        paymentStatus: 'PAID',
        status: { not: 'CANCELLED' },
        reservationDate: { gte: desde, lte: hasta },
        ...(comoReseller ? { resellerCompanyId: companyId } : { companyId }),
      },
      select: {
        reservationDate: true,
        pricing: true,
        channel: true,
        participants: true,
        experience: { select: { id: true, title: true, experienceType: true } },
        resellerCompany: { select: { id: true, companyName: true } },
      },
    });

    /** Lo que gana quien pregunta, segun en calidad de que mira. */
    const loSuyo = (p: Record<string, unknown>) =>
      Number(p[comoReseller ? 'resellerCommission' : 'hostEarnings'] ?? 0);

    type Fila = {
      clave: string;
      etiqueta: string;
      reservas: number;
      personas: number;
      vendido: number;
      tuyo: number;
      feeDeFilo: number;
      comisionDeCanal: number;
    };

    const acumular = (mapa: Map<string, Fila>, clave: string, etiqueta: string, r: typeof reservas[number]) => {
      const p = (r.pricing ?? {}) as Record<string, unknown>;
      const fila =
        mapa.get(clave) ??
        {
          clave,
          etiqueta,
          reservas: 0,
          personas: 0,
          vendido: 0,
          tuyo: 0,
          feeDeFilo: 0,
          comisionDeCanal: 0,
        };
      fila.reservas += 1;
      fila.personas += r.participants;
      fila.vendido += Number(p.total ?? 0);
      fila.tuyo += loSuyo(p);
      fila.feeDeFilo += Number(p.filoCommission ?? 0);
      fila.comisionDeCanal += Number(p.resellerCommission ?? 0);
      mapa.set(clave, fila);
    };

    const porPeriodo = new Map<string, Fila>();
    const porExperiencia = new Map<string, Fila>();
    const porModalidad = new Map<string, Fila>();
    const porCanal = new Map<string, Fila>();

    const MODALIDAD: Record<string, string> = {
      PRESENTIAL: 'Presencial',
      VIRTUAL: 'Virtual',
      HYBRID: 'Híbrida',
    };
    const CANAL: Record<string, string> = {
      MANUAL: 'Cargada a mano',
      CHECKOUT: 'Catálogo propio',
      CRM: 'Enlace del CRM',
      RESELLER: 'Canal de venta',
    };

    for (const r of reservas) {
      // Por mes: es el periodo en el que se cobra y se dispersa, y el que la
      // gente compara contra el anterior.
      const mes = `${r.reservationDate.getFullYear()}-${String(
        r.reservationDate.getMonth() + 1,
      ).padStart(2, '0')}`;
      acumular(porPeriodo, mes, mes, r);

      acumular(
        porExperiencia,
        r.experience?.id ?? 'sin-experiencia',
        r.experience?.title ?? 'Sin experiencia',
        r,
      );

      const tipo = r.experience?.experienceType ?? 'PRESENTIAL';
      acumular(porModalidad, tipo, MODALIDAD[tipo] ?? tipo, r);

      // El canal, y dentro de "canal de venta" cual: a un anfitrion le
      // importa cuanto le trae cada revendedor, no solo el total de todos.
      if (r.channel === 'RESELLER' && r.resellerCompany) {
        acumular(porCanal, r.resellerCompany.id, r.resellerCompany.companyName, r);
      } else {
        acumular(porCanal, r.channel, CANAL[r.channel] ?? r.channel, r);
      }
    }

    // De mayor a menor por lo que gana quien pregunta, salvo el periodo, que
    // va en orden de tiempo: el mes pasado no es "mas importante" que este.
    const porValor = (a: Fila, b: Fila) => b.tuyo - a.tuyo;
    const lista = (m: Map<string, Fila>) => [...m.values()].sort(porValor);

    return {
      desde,
      hasta,
      role: query.role,
      totales: {
        reservas: reservas.length,
        personas: reservas.reduce((s, r) => s + r.participants, 0),
        vendido: reservas.reduce((s, r) => s + Number((r.pricing as Record<string, unknown>)?.total ?? 0), 0),
        tuyo: reservas.reduce((s, r) => s + loSuyo((r.pricing ?? {}) as Record<string, unknown>), 0),
      },
      porPeriodo: [...porPeriodo.values()].sort((a, b) => a.clave.localeCompare(b.clave)),
      porExperiencia: lista(porExperiencia),
      porModalidad: lista(porModalidad),
      porCanal: lista(porCanal),
    };
  },

  /**
   * Registra una transferencia ya realizada.
   *
   * `payerCompanyId` dice quien pago: sin el, null, paga FILO — que era el
   * unico pagador antes de las pasarelas propias. Con una empresa, es un
   * anfitrion saldando con su revendedor lo que cobro directo.
   */
  async create(input: CreatePayoutInput, actor: { id: string; email: string }) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw NotFound('La empresa indicada no existe');
    if (input.amount <= 0) throw BadRequest('El importe debe ser mayor que cero');

    const pagador = input.payerCompanyId ?? null;
    if (pagador) {
      const existe = await prisma.company.findFirst({
        where: { id: pagador, deletedAt: null },
        select: { id: true },
      });
      if (!existe) throw NotFound('La empresa pagadora no existe');
      if (pagador === input.companyId) {
        throw BadRequest('Una empresa no puede pagarse a sí misma');
      }
    }

    // No dejamos dispersar mas de lo que se debe: seria dinero que nadie
    // cobro. Y se compara contra el saldo DE ESE pagador: lo que debe FILO y
    // lo que debe un anfitrion son deudas distintas con la misma empresa.
    const { items } = await this.balances();
    const saldo = items.find(
      (s) =>
        s.companyId === input.companyId &&
        s.role === input.role &&
        s.payerCompanyId === pagador,
    );
    const pendiente = saldo?.pending ?? 0;
    if (input.amount > pendiente) {
      throw BadRequest(
        `El importe supera el saldo pendiente (${pendiente.toLocaleString('es-CO')}).`,
      );
    }

    return prisma.payout.create({
      data: {
        companyId: input.companyId,
        role: input.role,
        payerCompanyId: pagador,
        amount: input.amount,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
        createdByEmail: actor.email,
        ...(input.paidAt ? { paidAt: new Date(input.paidAt) } : {}),
      },
    });
  },

  async list(query: ListPayoutsQuery) {
    const { page, pageSize, companyId, role } = query;
    const where: Prisma.PayoutWhereInput = {
      ...(companyId && { companyId }),
      ...(role && { role }),
    };

    const [items, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        include: { company: { select: { id: true, companyName: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { paidAt: 'desc' },
      }),
      prisma.payout.count({ where }),
    ]);

    return { items, total };
  },
};
