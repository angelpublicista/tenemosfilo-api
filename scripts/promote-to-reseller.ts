import { PrismaClient } from '@prisma/client';

// Cambia el role del usuario a RESELLER. Usa este script despues de correr
// `prisma migrate dev` para el cambio que agrega RESELLER al enum UserRole.
const TARGET_EMAIL = process.argv[2] ?? 'host@tenemosfilo.com';

async function main() {
  const prisma = new PrismaClient();

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
