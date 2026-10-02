// Cifra las llaves de Wompi de la propia plataforma que quedaron en claro.
//
// Las credenciales de los anfitriones nacieron cifradas; las nuestras son
// anteriores al cifrado y se quedaron en texto plano en la base. Con ellas se
// cobra dinero de verdad, asi que un volcado de la base para depurar o una
// copia de seguridad mal guardada bastaba para cobrar en nombre de FILO.
//
// Es idempotente: lo que ya esta cifrado se deja como esta. La llave publica
// NO se toca: viaja al navegador y cifrarla no protegeria nada.
//
// Va contra `dist/` y no contra `src/` —y por eso es .mjs y no .ts— porque
// tiene que poder correr EN LA INSTANCIA: la llave maestra de produccion no
// sale de alli, y cifrar con otra dejaria los cobros ilegibles.
//
// Uso en la instancia:
//   cd /srv/tenemosfilo-api/current && node scripts/cifrar-llaves-de-la-plataforma.mjs
//
// Uso en local (contra la base local, despues de `npm run build`):
//   node scripts/cifrar-llaves-de-la-plataforma.mjs
import { prisma } from '../dist/config/prisma.js';
import { cifrar, estaCifrado, hayLlaveDeCifrado } from '../dist/lib/cripto.js';

const CAMPOS = ['wompiPrivateKey', 'wompiIntegritySecret', 'wompiEventsSecret'];

async function main() {
  if (!hayLlaveDeCifrado()) {
    console.error('Falta CREDENTIALS_KEY (64 caracteres hexadecimales). Sin ella no hay nada que hacer.');
    process.exit(1);
  }

  const a = await prisma.platformSettings.findUnique({ where: { id: 'default' } });
  if (!a) {
    console.log('No hay ajustes de plataforma todavia: nada que cifrar.');
    return;
  }

  const cambios = {};
  for (const campo of CAMPOS) {
    const valor = a[campo];
    if (!valor) {
      console.log(`  ${campo}: vacio`);
      continue;
    }
    if (estaCifrado(valor)) {
      console.log(`  ${campo}: ya estaba cifrado`);
      continue;
    }
    cambios[campo] = cifrar(valor);
    console.log(`  ${campo}: se cifra`);
  }

  if (Object.keys(cambios).length === 0) {
    console.log('\nNo habia nada en claro.');
    return;
  }

  await prisma.platformSettings.update({ where: { id: 'default' }, data: cambios });
  console.log(`\nListo: ${Object.keys(cambios).length} cifradas.`);
  console.log('Si alguna vez cambia CREDENTIALS_KEY, hay que volver a escribirlas a mano.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
