// Crea la empresa que representa a la plataforma y la deja apuntada en los
// ajustes.
//
// Filo no es solo el intermediario: tambien vende por su propio canal, y esas
// reservas se le atribuyen como revendedora. Para eso necesita una empresa
// propia de la que cuelguen sus claves API y sus liquidaciones.
//
// Lo que este script NO hace, a proposito: asignar esa empresa a los usuarios
// ADMIN. Media aplicacion filtra por la empresa del usuario cuando la tiene
// —las reservas, por ejemplo— asi que darsela les cambiaria la vista global
// del panel por la de una empresa concreta. Los admins siguen sin companyId;
// la relacion vive en PlatformSettings.
//
// Uso:
//   npx tsx scripts/crear-empresa-plataforma.ts
//   NOMBRE="Tenemos Filo" CORREO=hola@tenemosfilo.com npx tsx scripts/...
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

const NOMBRE = process.env.NOMBRE?.trim() || 'Tenemos Filo';
const CORREO = process.env.CORREO?.trim() || '';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function main() {
  console.log(`Base: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}`);

  const ajustes = await prisma.platformSettings.findUnique({
    where: { id: 'default' },
    select: { platformCompanyId: true },
  });

  if (ajustes?.platformCompanyId) {
    const ya = await prisma.company.findUnique({
      where: { id: ajustes.platformCompanyId },
      select: { companyName: true },
    });
    if (ya) {
      console.log(`Ya estaba configurada: "${ya.companyName}". No se toca nada.`);
      return;
    }
    console.log('Los ajustes apuntaban a una empresa que ya no existe; se rehace.');
  }

  // El titular tiene que ser alguien: se usa el admin mas antiguo. Es un
  // requisito del modelo (toda empresa tiene dueño), no una decision sobre
  // quien manda: la plataforma se administra por rol, no por titularidad.
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error('No hay ningun ADMIN activo al que asignar la titularidad.');

  const existente = await prisma.company.findFirst({
    where: { companyName: NOMBRE, deletedAt: null },
    select: { id: true },
  });

  const empresa =
    existente ??
    (await prisma.company.create({
      data: {
        ownerId: admin.id,
        companyName: NOMBRE,
        slug: slugify(NOMBRE),
        companyEmail: CORREO || null,
        tagline: 'Experiencias gastronómicas',
      },
      select: { id: true },
    }));

  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    update: { platformCompanyId: empresa.id },
    create: { id: 'default', platformCompanyId: empresa.id },
  });

  console.log(`Empresa "${NOMBRE}" ${existente ? 'reutilizada' : 'creada'}.`);
  console.log(`Titular: ${admin.email}`);
  console.log('Apuntada en los ajustes como empresa de la plataforma.');
  console.log('\nLos usuarios ADMIN siguen sin empresa propia, para conservar la vista global.');
}

main()
  .catch((err) => {
    console.error('\nFallo:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
