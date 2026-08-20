// Crea un usuario de prueba por cada rol en la base LOCAL.
//
// Idempotente: se puede correr las veces que quieras. Si el usuario ya
// existe, le resetea la contraseña y el rol al valor esperado.
//
//   npm run db:local:seed
import type { UserRole } from '@prisma/client';
import { dbTarget, env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/lib/password.js';

// Password compartido: son cuentas de desarrollo, la comodidad gana.
// registerSchema exige minimo 8 caracteres.
const PASSWORD = 'dev12345';

const COMPANY_NAME = 'Filo Demo';
const COMPANY_SLUG = 'filo-demo';

type SeedUser = {
  email: string;
  name: string;
  role: UserRole;
  /** true = queda como dueño y miembro de la company demo */
  ownsCompany?: boolean;
};

const USERS: SeedUser[] = [
  { email: 'admin@filo.test', name: 'Admin Demo', role: 'ADMIN' },
  { email: 'host@filo.test', name: 'Host Demo', role: 'HOST', ownsCompany: true },
  { email: 'guest@filo.test', name: 'Guest Demo', role: 'GUEST' },
  { email: 'reseller@filo.test', name: 'Reseller Demo', role: 'RESELLER' },
];

/**
 * Sembrar datos falsos en produccion seria un desastre. Exigimos que la
 * base sea local por partida doble: el selector y el host real de la URL.
 */
function assertBaseLocal() {
  const host = new URL(env.DATABASE_URL).hostname;
  const esLocal = host === 'localhost' || host === '127.0.0.1';

  if (dbTarget === 'production' || !esLocal) {
    console.error(
      `\n  BLOQUEADO: este seed solo corre contra una base local.\n` +
        `  DB_TARGET=${dbTarget}, host=${host}\n`,
    );
    process.exit(1);
  }
}

async function main() {
  assertBaseLocal();
  console.log(`BD: ${dbTarget} -> ${new URL(env.DATABASE_URL).host}\n`);

  const passwordHash = await hashPassword(PASSWORD);
  const creados: Array<{ email: string; rol: string; password: string; empresa: string }> = [];

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { password: passwordHash, role: u.role, name: u.name, isActive: true },
      create: { email: u.email, password: passwordHash, role: u.role, name: u.name },
    });

    let empresa = '—';

    if (u.ownsCompany) {
      // La company necesita dueño, asi que se crea despues del user.
      const company = await prisma.company.upsert({
        where: { slug: COMPANY_SLUG },
        update: { ownerId: user.id },
        create: { companyName: COMPANY_NAME, slug: COMPANY_SLUG, ownerId: user.id },
      });
      // Y el dueño ademas es miembro: sin companyId el front lo manda a
      // /company-setup en vez de al dashboard.
      await prisma.user.update({ where: { id: user.id }, data: { companyId: company.id } });
      empresa = company.companyName;
    }

    creados.push({ email: u.email, rol: u.role, password: PASSWORD, empresa });
  }

  console.log('Usuarios de prueba listos:\n');
  console.table(creados);
  console.log(`\nTodos usan la misma contraseña: ${PASSWORD}\n`);
}

main()
  .catch((err) => {
    console.error('Fallo el seed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
