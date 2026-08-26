// Arranque de una base recien migrada: crea el administrador y, si se pide,
// contenido de ejemplo para que el panel no aparezca vacio.
//
// Existe aparte de scripts/seed-dev-*.ts porque aquellos estan BLOQUEADOS
// contra produccion, y con razon: usan una contraseña fija ('dev12345')
// compartida por todas las cuentas. Eso vale en local y seria una puerta
// abierta en una API publica.
//
// Aqui, en cambio:
//   - Cada cuenta recibe una contraseña aleatoria distinta.
//   - Nunca se pisa un usuario existente; si ya esta, se informa y se sigue.
//   - Las credenciales salen por stdout en JSON, para redirigirlas a un
//     archivo en vez de dejarlas en el historial de la terminal.
//
// Uso:
//   ADMIN_EMAIL=tu@correo.com npx tsx scripts/bootstrap-produccion.ts > credenciales.json
//   ADMIN_EMAIL=tu@correo.com CON_EJEMPLOS=no npx tsx scripts/bootstrap-produccion.ts
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

/** Solo se escribe por stderr: stdout queda limpio para el JSON. */
const aviso = (...a: unknown[]) => console.error(...a);

/** 24 bytes en base64url: 32 caracteres sin ambiguedades ni escapes. */
const generarPassword = () => randomBytes(24).toString('base64url');

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const HORARIO_RESTAURANTE = {
  monday: { isActive: false, timeSlots: [] },
  tuesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  wednesday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  thursday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '22:00' }] },
  friday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '15:00' }, { startTime: '19:00', endTime: '23:00' }] },
  saturday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '23:00' }] },
  sunday: { isActive: true, timeSlots: [{ startTime: '12:00', endTime: '17:00' }] },
};

type Credencial = { rol: string; email: string; password: string; nota?: string };

async function crearUsuario(
  email: string,
  name: string,
  role: 'ADMIN' | 'HOST',
): Promise<{ id: string; credencial: Credencial }> {
  const existente = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    aviso(`  · ${email} ya existia: no se toca su contraseña.`);
    return { id: existente.id, credencial: { rol: role, email, password: '(sin cambios)', nota: 'ya existia' } };
  }

  const password = generarPassword();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: await hashPassword(password),
      role,
      isActive: true,
      // Se da por verificado: lo crea un administrador a mano, no alguien
      // registrandose. Sin esto tendria que pasar por un correo que hoy
      // depende de que el dominio este verificado en ZeptoMail.
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  aviso(`  · ${email} creado (${role}).`);
  return { id: user.id, credencial: { rol: role, email, password } };
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail || !adminEmail.includes('@')) {
    aviso('Falta ADMIN_EMAIL. Ejemplo:\n  ADMIN_EMAIL=tu@correo.com npx tsx scripts/bootstrap-produccion.ts');
    process.exit(1);
  }
  const conEjemplos = (process.env.CON_EJEMPLOS ?? 'si').toLowerCase() !== 'no';

  aviso(`Base: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}`);
  aviso('Creando cuentas...');

  const credenciales: Credencial[] = [];

  const admin = await crearUsuario(adminEmail, 'Administrador', 'ADMIN');
  credenciales.push(admin.credencial);

  if (!conEjemplos) {
    aviso('\nCON_EJEMPLOS=no: no se crea contenido de ejemplo.');
    console.log(JSON.stringify({ credenciales }, null, 2));
    return;
  }

  // ─── Empresa de ejemplo ───────────────────────────────────────────────────
  const dominio = adminEmail.split('@')[1]!;
  const hostEmail = `demo@${dominio}`;
  const host = await crearUsuario(hostEmail, 'Anfitrión Demo', 'HOST');
  credenciales.push(host.credencial);

  const NOMBRE_EMPRESA = 'Cocina Demo';
  let empresa = await prisma.company.findFirst({ where: { companyName: NOMBRE_EMPRESA } });
  if (!empresa) {
    empresa = await prisma.company.create({
      data: {
        ownerId: host.id,
        companyName: NOMBRE_EMPRESA,
        slug: slug(NOMBRE_EMPRESA),
        companyEmail: hostEmail,
        tagline: 'Experiencias gastronómicas de autor',
        description: 'Empresa de ejemplo creada al poner en marcha la plataforma.',
      },
    });
    // El anfitrion opera desde esta empresa: sin companyId, su sesion no
    // sabria sobre que empresa esta trabajando.
    await prisma.user.update({ where: { id: host.id }, data: { companyId: empresa.id } });
    aviso(`  · Empresa "${NOMBRE_EMPRESA}" creada.`);
  } else {
    aviso(`  · Empresa "${NOMBRE_EMPRESA}" ya existia.`);
  }

  // ─── Sede ─────────────────────────────────────────────────────────────────
  let sede = await prisma.location.findFirst({ where: { companyId: empresa.id } });
  if (!sede) {
    sede = await prisma.location.create({
      data: {
        companyId: empresa.id,
        name: 'Sede Principal',
        isMain: true,
        address: { street: 'Calle 63 #11-20', city: 'Bogotá', state: 'Cundinamarca', country: 'Colombia' },
        capacity: { minGuests: 2, maxGuests: 30 },
      },
    });
    aviso('  · Sede creada.');
  }

  // ─── Experiencias ─────────────────────────────────────────────────────────
  const experiencias = [
    {
      title: 'Cena de maridaje',
      description: 'Cena de cinco tiempos con maridaje, preparada frente a los comensales. Incluye copa de bienvenida.',
      categories: ['Gastronomía', 'Maridaje'],
      duration: 150,
      capacity: 20,
      minCapacity: 2,
      basePrice: new Prisma.Decimal(180000),
      addons: [
        { name: 'Maridaje premium', price: 45000, priceType: 'per_person', description: 'Vinos de autor' },
        { name: 'Torta de celebración', price: 60000, priceType: 'total' },
      ],
    },
    {
      title: 'Taller de cocina de autor',
      description: 'Taller práctico de cuatro horas: tres platos y todo lo que prepares te lo llevas.',
      categories: ['Taller', 'Cocina de autor'],
      duration: 240,
      capacity: 12,
      minCapacity: 4,
      basePrice: new Prisma.Decimal(220000),
      addons: [{ name: 'Delantal de regalo', price: 35000, priceType: 'per_person' }],
    },
  ];

  let creadas = 0;
  for (const e of experiencias) {
    const s = slug(e.title);
    if (await prisma.experience.findUnique({ where: { slug: s }, select: { id: true } })) continue;

    const exp = await prisma.experience.create({
      data: {
        companyId: empresa.id,
        title: e.title,
        slug: s,
        description: e.description,
        categories: e.categories,
        duration: e.duration,
        capacity: e.capacity,
        minCapacity: e.minCapacity,
        basePrice: e.basePrice,
        currency: 'COP',
        experienceType: 'PRESENTIAL',
        presentialCity: 'Bogotá',
        addons: e.addons as Prisma.InputJsonValue,
        // ACTIVE, no DRAFT: en borrador no aparece en el catalogo publico y
        // el motor de reservas no la ofrece, que es justo lo que se quiere
        // poder probar.
        status: 'ACTIVE',
        locations: { connect: [{ id: sede.id }] },
      },
    });

    // Sin disponibilidad el motor no ofrece horarios y no se puede reservar:
    // el catalogo se veria, pero no se podria completar una reserva.
    await prisma.availability.create({
      data: {
        name: `Horario · ${e.title}`,
        locationId: sede.id,
        weeklySchedule: HORARIO_RESTAURANTE as Prisma.InputJsonValue,
        minimumNotice: 120,
        isMain: creadas === 0,
        experiences: { connect: [{ id: exp.id }] },
      },
    });
    creadas += 1;
  }
  aviso(`  · Experiencias creadas: ${creadas} (con su disponibilidad).`);

  aviso('\nListo. Las credenciales van por stdout.');
  console.log(
    JSON.stringify(
      {
        generado: new Date().toISOString(),
        base: new URL(env.DATABASE_URL).host,
        credenciales,
        aviso: 'Cambia estas contraseñas tras el primer acceso y borra este archivo.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    aviso('\nFallo:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
