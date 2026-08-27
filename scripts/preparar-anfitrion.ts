// Prepara a un anfitrion que ya existe: le crea empresa, sede y experiencias
// publicadas, listas para reservar.
//
// Un HOST sin empresa no puede hacer nada en el panel: casi todo cuelga de
// ella. Este script cubre ese hueco sin tocar la cuenta —ni su contraseña ni
// su rol— y es idempotente: si algo ya existe, lo reutiliza.
//
// Uso:
//   EMAIL=alguien@correo.com npx tsx scripts/preparar-anfitrion.ts
//   EMAIL=... EMPRESA="Sabores de Bogota" CIUDAD=Bogota npx tsx scripts/...
//   EMAIL=... SIN_EXPERIENCIAS=1 npx tsx scripts/...   (solo empresa y sede)
import { Prisma } from '@prisma/client';
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

const EMAIL = process.env.EMAIL?.trim() ?? '';
const EMPRESA = process.env.EMPRESA?.trim() || 'Sabores de Bogotá';
const CIUDAD = process.env.CIUDAD?.trim() || 'Bogotá';
const CON_EXPERIENCIAS = !process.env.SIN_EXPERIENCIAS;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Un slug libre: los de las experiencias son unicos en toda la plataforma. */
async function slugLibre(tabla: 'company' | 'experience', base: string) {
  let candidato = slugify(base) || 'sin-nombre';
  let i = 1;
  const existe = async (s: string) =>
    tabla === 'company'
      ? !!(await prisma.company.findUnique({ where: { slug: s }, select: { id: true } }))
      : !!(await prisma.experience.findUnique({ where: { slug: s }, select: { id: true } }));
  while (await existe(candidato)) {
    i += 1;
    candidato = `${slugify(base)}-${i}`;
  }
  return candidato;
}

// Restaurante: comidas y cenas, cerrado los lunes.
const HORARIO = {
  monday: { isActive: false, timeSlots: [] },
  tuesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  wednesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  thursday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  friday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '23:00' }] },
  saturday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '23:00' }] },
  sunday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '17:00' }] },
};

const EXPERIENCIAS = [
  {
    title: 'Ruta de sabores en La Candelaria',
    description:
      'Recorrido a pie por el centro histórico con seis paradas de comida: fritanga, tamal, obleas y chocolate santafereño. Guía local incluido.',
    categories: ['Ruta gastronómica', 'Cultural'],
    duration: 180,
    capacity: 15,
    minCapacity: 2,
    basePrice: 145000,
    includes: ['Guía local', 'Seis degustaciones', 'Bebida en cada parada'],
    addons: [{ name: 'Fotografía del recorrido', price: 80000, priceType: 'total' }],
  },
  {
    title: 'Cata de cafés de origen',
    description:
      'Cata guiada de cinco cafés colombianos de distintas regiones, con un barista que explica altura, proceso y tueste. Te llevas una bolsa del que más te guste.',
    categories: ['Cata', 'Café'],
    duration: 90,
    capacity: 12,
    minCapacity: 2,
    basePrice: 95000,
    includes: ['Cinco cafés de origen', 'Bolsa de 250 g para llevar'],
    addons: [{ name: 'Método de preparación en casa', price: 120000, priceType: 'per_person' }],
  },
];

async function main() {
  if (!EMAIL.includes('@')) {
    console.error('Falta EMAIL. Ejemplo:\n  EMAIL=alguien@correo.com npx tsx scripts/preparar-anfitrion.ts');
    process.exit(1);
  }
  console.log(`Base: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}\n`);

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, email: true, role: true, companyId: true, isActive: true, deletedAt: true },
  });
  if (!user) throw new Error(`No existe ningun usuario con el correo ${EMAIL}.`);
  if (!user.isActive || user.deletedAt) throw new Error(`${EMAIL} esta inactivo o borrado.`);
  if (user.role !== 'HOST' && user.role !== 'ADMIN') {
    throw new Error(`${EMAIL} tiene rol ${user.role}. Solo un HOST necesita empresa propia.`);
  }

  // ─── Empresa ──────────────────────────────────────────────────────────────
  let empresaId = user.companyId;
  if (empresaId) {
    const suya = await prisma.company.findUnique({
      where: { id: empresaId },
      select: { companyName: true },
    });
    console.log(`· Ya tenia empresa: "${suya?.companyName}". Se reutiliza.`);
  } else {
    const empresa = await prisma.company.create({
      data: {
        ownerId: user.id,
        companyName: EMPRESA,
        slug: await slugLibre('company', EMPRESA),
        companyEmail: user.email,
        tagline: 'Experiencias gastronómicas en ' + CIUDAD,
        description: 'Cocina local y recorridos de sabor para grupos pequeños.',
      },
      select: { id: true, slug: true },
    });
    empresaId = empresa.id;
    // Sin companyId en el usuario, su sesion no sabe sobre que empresa opera
    // y el panel le responde como si no tuviera ninguna.
    await prisma.user.update({ where: { id: user.id }, data: { companyId: empresa.id } });
    console.log(`· Empresa "${EMPRESA}" creada (/${empresa.slug}) y asignada a ${EMAIL}.`);
  }

  // ─── Sede ─────────────────────────────────────────────────────────────────
  let sede = await prisma.location.findFirst({
    where: { companyId: empresaId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (sede) {
    console.log(`· Ya tenia sede: "${sede.name}". Se reutiliza.`);
  } else {
    sede = await prisma.location.create({
      data: {
        companyId: empresaId,
        name: 'Sede Principal',
        isMain: true,
        address: { street: 'Carrera 7 #12-45', city: CIUDAD, state: 'Cundinamarca', country: 'Colombia' },
        capacity: { minGuests: 2, maxGuests: 20 },
      },
      select: { id: true, name: true },
    });
    console.log('· Sede creada.');
  }

  if (!CON_EXPERIENCIAS) {
    console.log('\nSIN_EXPERIENCIAS: no se crea ninguna.');
    return;
  }

  // ─── Experiencias ─────────────────────────────────────────────────────────
  let creadas = 0;
  for (const e of EXPERIENCIAS) {
    const yaEsta = await prisma.experience.findFirst({
      where: { companyId: empresaId, title: e.title, deletedAt: null },
      select: { id: true },
    });
    if (yaEsta) {
      console.log(`· "${e.title}" ya existia.`);
      continue;
    }

    const exp = await prisma.experience.create({
      data: {
        companyId: empresaId,
        title: e.title,
        slug: await slugLibre('experience', e.title),
        description: e.description,
        categories: e.categories,
        duration: e.duration,
        capacity: e.capacity,
        minCapacity: e.minCapacity,
        basePrice: new Prisma.Decimal(e.basePrice),
        currency: 'COP',
        experienceType: 'PRESENTIAL',
        presentialCity: CIUDAD,
        includes: e.includes as Prisma.InputJsonValue,
        addons: e.addons as Prisma.InputJsonValue,
        // ACTIVE, no DRAFT: en borrador no sale en el catalogo publico ni la
        // ofrece el motor de reservas, que es justo lo que se quiere probar.
        status: 'ACTIVE',
        locations: { connect: [{ id: sede.id }] },
      },
      select: { id: true },
    });

    // Sin disponibilidad el motor no ofrece horarios: la experiencia se veria
    // en el catalogo pero no se podria completar ninguna reserva.
    await prisma.availability.create({
      data: {
        name: `Horario · ${e.title}`,
        locationId: sede.id,
        weeklySchedule: HORARIO as Prisma.InputJsonValue,
        minimumNotice: 120,
        isMain: creadas === 0,
        experiences: { connect: [{ id: exp.id }] },
      },
    });
    creadas += 1;
    console.log(`· "${e.title}" publicada, con horarios.`);
  }

  const empresa = await prisma.company.findUnique({
    where: { id: empresaId },
    select: { slug: true },
  });
  console.log(`\nListo. Catalogo publico: ${env.APP_URL}/book/${empresa?.slug}`);
}

main()
  .catch((err) => {
    console.error('\nFallo:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
