// Datos de ejemplo para tener la plataforma usable en local: sedes,
// disponibilidad, experiencias con contenido, reservas en varios estados,
// CRM y ajustes.
//
// Se ejecuta DESPUES de seed-dev-users.ts (necesita usuarios y empresas) y
// es idempotente: se puede correr las veces que haga falta.
//
//   npm run db:local:seed
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

/** Sembrar datos falsos en produccion seria un desastre. */
function assertBaseLocal() {
  const host = new URL(env.DATABASE_URL).hostname;
  if (dbTarget === 'production' || !(host === 'localhost' || host === '127.0.0.1')) {
    console.error(`\n  BLOQUEADO: solo contra una base local. DB_TARGET=${dbTarget}, host=${host}\n`);
    process.exit(1);
  }
}

/** Horario de martes a domingo, mañana y noche. */
const HORARIO_RESTAURANTE = {
  monday: { isActive: false, timeSlots: [] },
  tuesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  wednesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  thursday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  friday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '23:00' }] },
  saturday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '23:00' }] },
  sunday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '17:00' }] },
};

/** Taller de fin de semana, solo mañanas. */
const HORARIO_TALLER = {
  monday: { isActive: false, timeSlots: [] },
  tuesday: { isActive: false, timeSlots: [] },
  wednesday: { isActive: false, timeSlots: [] },
  thursday: { isActive: true, timeSlots: [{ startTime: '10:00', endTime: '13:00' }] },
  friday: { isActive: true, timeSlots: [{ startTime: '10:00', endTime: '13:00' }] },
  saturday: { isActive: true, timeSlots: [{ startTime: '09:00', endTime: '13:00' }] },
  sunday: { isActive: false, timeSlots: [] },
};

/** Fecha futura a N dias, a una hora concreta. */
function enDias(dias: number, hora = 19): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d;
}

function pricing(total: number, opts: { conReseller?: boolean } = {}) {
  const filo = Math.round(total * 0.1);
  const reseller = opts.conReseller ? Math.round(total * 0.05) : 0;
  return {
    basePrice: total / 2,
    subtotal: total,
    addons: [],
    addonsTotal: 0,
    discount: 0,
    tax: 0,
    filoCommission: filo,
    resellerCommission: reseller,
    commission: filo + reseller,
    total,
    hostEarnings: total - filo - reseller,
  };
}

async function main() {
  assertBaseLocal();
  console.log(`BD: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}\n`);

  const filo = await prisma.company.findUnique({ where: { slug: 'filo-demo' } });
  const cocina = await prisma.company.findUnique({ where: { slug: 'cocina-dos' } });
  if (!filo || !cocina) {
    console.error('  Faltan las empresas base. Corre primero seed-dev-users.');
    process.exit(1);
  }

  const resumen: Record<string, number> = {};

  // ─── Ajustes de plataforma ───────────────────────────────────────────────
  //
  // Las llaves de Wompi son de relleno: sirven para que el checkout aparezca
  // y se pueda recorrer el flujo completo en local, pero la firma que generan
  // NO la acepta Wompi. Para probar contra el sandbox real hay que pegar las
  // llaves de la cuenta en /dashboard/admin/ajustes.
  const comisiones = {
    filoCommissionType: 'PERCENT' as const,
    filoCommissionValue: 10,
    resellerCommissionType: 'PERCENT' as const,
    resellerCommissionValue: 5,
  };
  const wompiRelleno = {
    wompiEnabled: true,
    wompiEnvironment: 'SANDBOX' as const,
    wompiPublicKey: 'pub_test_REEMPLAZAR',
    wompiIntegritySecret: 'test_integrity_REEMPLAZAR',
    wompiEventsSecret: 'test_events_REEMPLAZAR',
  };
  // Si ya hay llaves puestas a mano, el seed no las pisa: volver a sembrar
  // datos de ejemplo no debe costarte la configuracion del sandbox.
  const previos = await prisma.platformSettings.findUnique({ where: { id: 'default' } });
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    update: { ...comisiones, ...(previos?.wompiPublicKey ? {} : wompiRelleno) },
    create: { id: 'default', ...comisiones, ...wompiRelleno },
  });
  resumen['Comisiones (10% FILO / 5% reseller) + Wompi sandbox'] = 1;

  // ─── Sedes ───────────────────────────────────────────────────────────────
  const sedes = [
    {
      companyId: filo.id,
      name: 'Sede Chapinero',
      isMain: true,
      address: { street: 'Calle 63 #11-20', city: 'Bogotá', state: 'Cundinamarca', country: 'Colombia' },
      capacity: { minGuests: 2, maxGuests: 40 },
    },
    {
      companyId: filo.id,
      name: 'Sede Usaquén',
      isMain: false,
      address: { street: 'Carrera 6 #117-30', city: 'Bogotá', state: 'Cundinamarca', country: 'Colombia' },
      capacity: { minGuests: 2, maxGuests: 20 },
    },
    {
      companyId: cocina.id,
      name: 'Taller Laureles',
      isMain: true,
      address: { street: 'Circular 4 #70-15', city: 'Medellín', state: 'Antioquia', country: 'Colombia' },
      capacity: { minGuests: 4, maxGuests: 12 },
    },
  ];

  const sedesCreadas: Record<string, string> = {};
  for (const s of sedes) {
    const existente = await prisma.location.findFirst({
      where: { companyId: s.companyId, name: s.name },
    });
    const sede = existente
      ? await prisma.location.update({ where: { id: existente.id }, data: { ...s, deletedAt: null } })
      : await prisma.location.create({ data: s });
    sedesCreadas[s.name] = sede.id;
  }
  resumen['Sedes'] = sedes.length;

  // ─── Experiencias con contenido ──────────────────────────────────────────
  const cena = await prisma.experience.findUniqueOrThrow({ where: { slug: 'cena-en-filo-demo' } });
  const taller = await prisma.experience.findUniqueOrThrow({ where: { slug: 'taller-en-cocina-dos' } });

  await prisma.experience.update({
    where: { id: cena.id },
    data: {
      description:
        'Cena de cinco tiempos con maridaje, preparada frente a los comensales por nuestro chef. Incluye una copa de bienvenida.',
      categories: ['Gastronomía', 'Maridaje'],
      experienceType: 'PRESENTIAL',
      presentialCity: 'Bogotá',
      addons: [
        { name: 'Maridaje premium', price: 45000, priceType: 'per_person', description: 'Vinos de autor' },
        { name: 'Torta de celebración', price: 60000, priceType: 'total', description: 'Para cumpleaños' },
      ],
      locations: { set: [{ id: sedesCreadas['Sede Chapinero']! }, { id: sedesCreadas['Sede Usaquén']! }] },
    },
  });

  await prisma.experience.update({
    where: { id: taller.id },
    data: {
      description:
        'Taller práctico de cocina de autor: cuatro horas, tres platos y todo lo que prepares te lo llevas.',
      categories: ['Taller', 'Cocina de autor'],
      experienceType: 'PRESENTIAL',
      presentialCity: 'Medellín',
      addons: [{ name: 'Delantal de regalo', price: 35000, priceType: 'per_person' }],
      locations: { set: [{ id: sedesCreadas['Taller Laureles']! }] },
    },
  });
  resumen['Experiencias enriquecidas'] = 2;

  // ─── Disponibilidad ──────────────────────────────────────────────────────
  // Sin esto el motor de reservas no ofrece horarios y no se puede reservar.
  const calendarios = [
    {
      name: 'Horario Chapinero',
      locationId: sedesCreadas['Sede Chapinero']!,
      weeklySchedule: HORARIO_RESTAURANTE,
      minimumNotice: 120,
      experienceId: cena.id,
    },
    {
      name: 'Horario Usaquén',
      locationId: sedesCreadas['Sede Usaquén']!,
      weeklySchedule: HORARIO_RESTAURANTE,
      minimumNotice: 120,
      experienceId: cena.id,
    },
    {
      name: 'Horario Taller',
      locationId: sedesCreadas['Taller Laureles']!,
      weeklySchedule: HORARIO_TALLER,
      minimumNotice: 1440,
      experienceId: taller.id,
    },
  ];

  for (const c of calendarios) {
    const existente = await prisma.availability.findFirst({ where: { name: c.name } });
    const cal = existente
      ? await prisma.availability.update({
          where: { id: existente.id },
          data: {
            weeklySchedule: c.weeklySchedule,
            minimumNotice: c.minimumNotice,
            locationId: c.locationId,
            isActive: true,
            deletedAt: null,
          },
        })
      : await prisma.availability.create({
          data: {
            name: c.name,
            locationId: c.locationId,
            weeklySchedule: c.weeklySchedule,
            bufferTime: 30,
            minimumNotice: c.minimumNotice,
            blockedDates: [],
            isMain: true,
          },
        });
    await prisma.experience.update({
      where: { id: c.experienceId },
      data: { availabilities: { connect: { id: cal.id } } },
    });
  }
  resumen['Calendarios de disponibilidad'] = calendarios.length;

  // ─── Reservas en varios estados ──────────────────────────────────────────
  await prisma.reservation.deleteMany({ where: { reservationNumber: { startsWith: 'DEMO-' } } });

  const reservas = [
    { n: 'DEMO-001', exp: cena.id, comp: filo.id, sede: 'Sede Chapinero', dias: 5, estado: 'CONFIRMED', pago: 'PAID', personas: 4, total: 400000, reseller: null },
    { n: 'DEMO-002', exp: cena.id, comp: filo.id, sede: 'Sede Usaquén', dias: 9, estado: 'PENDING', pago: 'PENDING', personas: 2, total: 200000, reseller: null },
    { n: 'DEMO-003', exp: cena.id, comp: filo.id, sede: 'Sede Chapinero', dias: -6, estado: 'COMPLETED', pago: 'PAID', personas: 6, total: 600000, reseller: cocina.id },
    { n: 'DEMO-004', exp: taller.id, comp: cocina.id, sede: 'Taller Laureles', dias: 12, estado: 'CONFIRMED', pago: 'PAID', personas: 8, total: 800000, reseller: null },
    { n: 'DEMO-005', exp: taller.id, comp: cocina.id, sede: 'Taller Laureles', dias: 3, estado: 'CANCELLED', pago: 'REFUNDED', personas: 2, total: 200000, reseller: null },
  ] as const;

  const clientes = ['Ana Restrepo', 'Carlos Gómez', 'Lucía Marín', 'Andrés Peña', 'Sofía Duque'];

  for (const [i, r] of reservas.entries()) {
    await prisma.reservation.create({
      data: {
        reservationNumber: r.n,
        experienceId: r.exp,
        companyId: r.comp,
        resellerCompanyId: r.reseller,
        locationId: sedesCreadas[r.sede]!,
        client: {
          name: clientes[i]!,
          email: `${clientes[i]!.split(' ')[0]!.toLowerCase()}@ejemplo.com`,
          phone: `+57 30${i} 555 00${i}${i}`,
        },
        clientType: 'GUEST',
        source: r.reseller ? 'BOOKING_ENGINE' : 'MANUAL',
        reservationDate: enDias(r.dias),
        duration: 120,
        participants: r.personas,
        status: r.estado,
        paymentStatus: r.pago,
        pricing: pricing(r.total, { conReseller: !!r.reseller }),
        paymentMethod: r.pago === 'PAID' ? 'WOMPI' : null,
      },
    });
  }
  resumen['Reservas (varios estados)'] = reservas.length;

  // ─── CRM del anfitrion ───────────────────────────────────────────────────
  const empresasCrm = [
    { companyName: 'Eventos Andinos SAS', email: 'contacto@eventosandinos.co', phone: '+57 1 742 1100' },
    { companyName: 'Hotel La Candelaria', email: 'reservas@lacandelaria.co', phone: '+57 1 555 8899' },
  ];
  for (const e of empresasCrm) {
    const existente = await prisma.crmCompany.findFirst({
      where: { hostCompanyId: filo.id, companyName: e.companyName },
    });
    if (!existente) {
      await prisma.crmCompany.create({
        data: { hostCompanyId: filo.id, companyName: e.companyName, email: e.email, phone: e.phone, tags: ['corporativo'] },
      });
    }
  }
  resumen['Empresas CRM'] = empresasCrm.length;

  const contactos = [
    { firstName: 'María', lastName: 'Torres', email: 'maria.torres@eventosandinos.co', phone: '+57 310 555 1122' },
    { firstName: 'Julián', lastName: 'Ospina', email: 'julian@lacandelaria.co', phone: '+57 311 555 3344' },
    { firstName: 'Valentina', lastName: 'Ríos', email: 'valentina.rios@ejemplo.com', phone: '+57 312 555 5566' },
  ];
  for (const c of contactos) {
    const existente = await prisma.contact.findFirst({
      where: { hostCompanyId: filo.id, email: c.email },
    });
    if (!existente) {
      await prisma.contact.create({
        data: { hostCompanyId: filo.id, ...c, status: 'ACTIVE', tags: ['lead'] },
      });
    }
  }
  resumen['Contactos CRM'] = contactos.length;

  const oportunidades = [
    { name: 'Cena de fin de año — Eventos Andinos', stage: 'PROPOSAL', value: 4500000 },
    { name: 'Taller para equipo de Hotel La Candelaria', stage: 'NEGOTIATION', value: 2800000 },
    { name: 'Maridaje mensual corporativo', stage: 'PROSPECTING', value: 1200000 },
  ] as const;
  for (const o of oportunidades) {
    const existente = await prisma.opportunity.findFirst({
      where: { hostCompanyId: filo.id, name: o.name },
    });
    if (!existente) {
      await prisma.opportunity.create({
        data: {
          hostCompanyId: filo.id,
          name: o.name,
          stage: o.stage,
          status: 'OPEN',
          value: o.value,
          currency: 'COP',
          tags: [],
        },
      });
    }
  }
  resumen['Oportunidades CRM'] = oportunidades.length;

  console.log('Datos de ejemplo listos:\n');
  console.table(
    Object.entries(resumen).map(([que, cuantos]) => ({ 'qué': que, 'cuántos': cuantos })),
  );
}

main()
  .catch((e) => {
    console.error('Fallo el seed de datos:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
