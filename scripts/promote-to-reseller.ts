// Usa el cliente compartido en vez de `new PrismaClient()`: asi respeta
// DB_TARGET y no depende de que DATABASE_URL exista en el proceso.
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

// Unica via para dar el rol RESELLER: /auth/register no lo acepta porque
// otorga acceso entre empresas.
const TARGET_EMAIL = process.argv[2] ?? 'host@tenemosfilo.com';

async function main() {
  console.log(`BD: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}`);

  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(`No existe un usuario con email ${TARGET_EMAIL}`);
  }
  if (user.role === 'RESELLER') {
    console.log(`El usuario ${TARGET_EMAIL} ya es RESELLER. Nada que hacer.`);
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'RESELLER' },
    select: { id: true, email: true, name: true, role: true, companyId: true },
  });

  console.log('\nRole actualizado:');
  console.table([updated]);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fallo al promover:', err);
  process.exit(1);
});
