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


type SeedUser = {
  email: string;
  name: string;
  role: UserRole;
  /**
   * Si esta, el user queda como titular y miembro de esta empresa. Sin
   * `experiencia` no se le crea ninguna: es el caso de un canal de venta,
   * que no cocina, solo revende lo de otros.
   */
  empresa?: { nombre: string; slug: string; experiencia?: string; expSlug?: string };
};

// Dos empresas a proposito: con una sola no se distingue si el panel de
// administracion realmente ve toda la plataforma o solo la del usuario.
const USERS: SeedUser[] = [
  { email: 'admin@filo.test', name: 'Admin Demo', role: 'ADMIN' },
  {
    email: 'host@filo.test',
    name: 'Host Demo',
    role: 'HOST',
    empresa: {
      nombre: 'Filo Demo',
      slug: 'filo-demo',
      experiencia: 'Cena en Filo Demo',
      expSlug: 'cena-en-filo-demo',
    },
  },
  {
    email: 'host2@filo.test',
    name: 'Host Dos',
    role: 'HOST',
    empresa: {
      nombre: 'Cocina Dos',
      slug: 'cocina-dos',
      experiencia: 'Taller en Cocina Dos',
      expSlug: 'taller-en-cocina-dos',
    },
  },
  { email: 'guest@filo.test', name: 'Guest Demo', role: 'GUEST' },
  {
    email: 'reseller@filo.test',
    name: 'Reseller Demo',
    role: 'RESELLER',
    // Empresa propia y sin experiencias: un canal de venta no cocina,
    // revende lo de los anfitriones. Es titular, asi que administra su
    // marca — que es la que ve el cliente en su catalogo /r/canal-andino.
    empresa: { nombre: 'Canal Andino', slug: 'canal-andino' },
  },
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

    if (u.empresa) {
      // La company necesita dueño, asi que se crea despues del user.
      const company = await prisma.company.upsert({
        where: { slug: u.empresa.slug },
        update: { ownerId: user.id, companyName: u.empresa.nombre, deletedAt: null },
        create: { companyName: u.empresa.nombre, slug: u.empresa.slug, ownerId: user.id },
      });
      // Y el dueño ademas es miembro: sin companyId el front lo manda a
      // /company-setup en vez de al dashboard.
      await prisma.user.update({ where: { id: user.id }, data: { companyId: company.id } });

      // Una experiencia activa por empresa, para que las pantallas no salgan
      // vacias y se note la diferencia entre ver "lo mio" y ver "todo".
      // Con duracion y capacidad: sin ellas el motor de reservas no deja
      // pasar del primer paso.
      if (u.empresa.experiencia && u.empresa.expSlug) {
      const datosExperiencia = {
        title: u.empresa.experiencia,
        status: 'ACTIVE' as const,
        deletedAt: null,
        basePrice: 100000,
        duration: 120,
        capacity: 10,
        minCapacity: 1,
      };
      await prisma.experience.upsert({
        where: { slug: u.empresa.expSlug },
        update: datosExperiencia,
        create: { ...datosExperiencia, slug: u.empresa.expSlug, companyId: company.id },
      });
      }

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
