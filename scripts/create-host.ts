import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
// Usa el cliente compartido en vez de `new PrismaClient()`: asi respeta
// DB_TARGET y no depende de que DATABASE_URL exista en el proceso.
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

// Datos del HOST a crear. Cambialos si vas a correr el script de nuevo
// para otro tenant de prueba.
const HOST_EMAIL = 'host@tenemosfilo.com';
const HOST_NAME = 'Host Demo';
const COMPANY_NAME = 'Tenemos Filo Demo';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function uniqueCompanySlug(prisma: PrismaClient, base: string) {
  let candidate = slugify(base) || 'company';
  let i = 1;
  while (await prisma.company.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    i += 1;
    candidate = `${slugify(base)}-${i}`;
  }
  return candidate;
}

async function main() {
  console.log(`BD: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}`);

  const existing = await prisma.user.findUnique({ where: { email: HOST_EMAIL } });
  if (existing) {
    throw new Error(`Ya existe un usuario con email ${HOST_EMAIL}. Borralo o usa otro email.`);
  }

  // Password aleatorio fuerte (24 bytes base64url ~ 32 chars)
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);

  const slug = await uniqueCompanySlug(prisma, COMPANY_NAME);

  // 1) Crear user HOST (todavia sin companyId).
  // 2) Crear Company con ownerId = user.id.
  // 3) Actualizar user.companyId para que el JWT sintetico/real apunte ahi.
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: HOST_EMAIL,
        name: HOST_NAME,
        password: passwordHash,
        role: 'HOST',
        isActive: true,
        emailVerified: new Date(),
      },
    });

    const company = await tx.company.create({
      data: {
        ownerId: user.id,
        companyName: COMPANY_NAME,
        slug,
      },
    });

    const linked = await tx.user.update({
      where: { id: user.id },
      data: { companyId: company.id },
      select: { id: true, email: true, name: true, role: true, companyId: true },
    });

    return { user: linked, company };
  });

  console.log('\nUsuario HOST creado:');
  console.table([
    {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      companyId: result.user.companyId,
    },
  ]);

  console.log('\nCompany creada:');
  console.table([
    {
      id: result.company.id,
      companyName: result.company.companyName,
      slug: result.company.slug,
      ownerId: result.company.ownerId,
    },
  ]);

  console.log('\n=== Credenciales (guardalas; el password no se vuelve a mostrar) ===');
  console.log(`  Email:    ${HOST_EMAIL}`);
  console.log(`  Password: ${password}`);
  console.log('======================================================================\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fallo al crear el HOST:', err);
  process.exit(1);
});
