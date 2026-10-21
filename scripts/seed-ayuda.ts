// Carga los artículos iniciales de la base de conocimiento.
//
// Idempotente y respetuoso: crea los que faltan (por slug) y NO toca los que ya
// existen, así que lo que el administrador haya editado o despublicado se queda
// como está. Se puede correr las veces que haga falta, también en producción.
//
// Lo corre el despliegue justo después de las migraciones (npm run ayuda:cargar).
// En local: npm run ayuda:cargar.
//
// No importa nada de src/: el paquete que sube el despliegue lleva dist/, no
// src/. La base la elige scripts/resolve-db-url.mjs, que inyecta DATABASE_URL.
import { PrismaClient, type UserRole } from '@prisma/client';

const prisma = new PrismaClient();

type Articulo = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  position: number;
  audience: UserRole[];
  body: string;
};

const ARTICULOS: Articulo[] = [
  {
    slug: 'primeros-pasos-como-anfitrion',
    title: 'Primeros pasos como anfitrión',
    summary: 'El orden recomendado para pasar de cuenta nueva a recibir tu primera reserva.',
    category: 'Primeros pasos',
    position: 1,
    audience: ['HOST'],
    body: `Para empezar a vender necesitas cuatro cosas, en este orden:

1. **Completa los datos de tu empresa** en *Mi Empresa*. De ahí sale el enlace de tu catálogo; sin él no puedes compartir nada.
2. **Crea al menos una sede** en *Mis Sedes*. Es el lugar donde se hace la experiencia.
3. **Crea tu primera experiencia** en *Mis Experiencias*: qué se hace, cuánto dura, qué incluye y a qué precio.
4. **Publícala** en *Publicaciones*, eligiendo la sede y el horario en que se ofrece.

Cuando termines, abre *Catálogo digital* para copiar tu enlace y compartirlo.

> Una experiencia en borrador no sale en el catálogo público. Revisa que esté activa.

Si algo no te deja avanzar, el botón de cada pantalla te indica qué falta.`,
  },
  {
    slug: 'crear-una-sede',
    title: 'Cómo crear una sede',
    summary: 'Una sede es el lugar donde ofreces tus experiencias. Puedes tener varias.',
    category: 'Primeros pasos',
    position: 2,
    audience: ['HOST'],
    body: `Una **sede** es un lugar físico donde se hace una experiencia: tu restaurante, una finca, un taller.

## Para crearla

1. Entra a *Mis Sedes* en el menú.
2. Pulsa el botón de crear y completa nombre y dirección.
3. Guarda.

## Para qué sirve

- Una misma experiencia puede ofrecerse en **varias sedes**, cada una con su propio horario y precio. Eso se decide en *Publicaciones*.
- Si **no tienes ninguna sede**, el botón *Publicar experiencia* aparece inactivo y te avisa que primero debes crear una.

Las experiencias a domicilio no usan sede: se hacen donde indique quien reserva.`,
  },
  {
    slug: 'crear-una-experiencia',
    title: 'Cómo crear una experiencia',
    summary: 'La experiencia es la pieza base: qué se hace, cuánto dura y cuánto cuesta.',
    category: 'Experiencias y publicaciones',
    position: 1,
    audience: ['HOST'],
    body: `Una **experiencia** es la pieza que vendes: una cena, una cata, un taller. Se crea una sola vez y se puede reutilizar en varias sedes.

## Para crearla

1. Ve a *Mis Experiencias* y pulsa crear.
2. Escribe título, descripción, duración, capacidad mínima y precio por persona.
3. Sube una **imagen de portada** y, si quieres, más fotos: en el catálogo se muestran como un carrusel cuando hay más de una.
4. Indica si es **a domicilio** o se hace en sede.
5. Guarda.

## Después de crearla

Crearla no la pone a la venta. Para eso hay que **publicarla** (ver *Publicar una experiencia en una sede*). Hasta entonces queda como borrador.`,
  },
  {
    slug: 'publicar-una-experiencia-en-una-sede',
    title: 'Publicar una experiencia en una sede',
    summary: 'Cómo ofrecer la misma experiencia en varias sedes, con condiciones distintas.',
    category: 'Experiencias y publicaciones',
    position: 2,
    audience: ['HOST'],
    body: `Una **publicación** es la pareja *experiencia + sede*. Es la unidad que se vende en tu catálogo.

## Para publicar

1. Entra a *Publicaciones* y pulsa **Publicar experiencia**.
2. Elige la experiencia y la sede.
3. Ajusta las condiciones que cambien en esa sede (modalidad, precio, cupo mínimo, anticipación). Lo que dejes en blanco se **hereda de la experiencia**.
4. Guarda y, con el botón **Horario**, define cuándo se ofrece.

## Reutilizar una experiencia

La misma experiencia puede publicarse en varias sedes: por ejemplo **abierta** (cupos sueltos) en el local del centro y **privada** (el sitio completo para un grupo) en la finca, con otro precio y otro horario.

## Pausar o quitar

- **Pausar** deja de venderla ahí sin perder sus condiciones ni su horario; luego puedes reanudarla.
- **Quitar** la saca del todo y borra sus condiciones. Las reservas ya vendidas no se cancelan.

> Una misma experiencia solo puede tener **una publicación por sede**.`,
  },
  {
    slug: 'por-que-publicar-experiencia-esta-inactivo',
    title: 'El botón «Publicar experiencia» está inactivo',
    summary: 'Las dos razones por las que no te deja publicar y cómo resolverlas.',
    category: 'Experiencias y publicaciones',
    position: 3,
    audience: ['HOST'],
    body: `El botón se apaga cuando falta algo, y debajo te dice qué:

- **No tienes sedes.** Crea una en *Mis Sedes* y vuelve.
- **No tienes experiencias para ubicar en una sede.** Las experiencias a domicilio no llevan sede, así que no cuentan aquí. Crea una experiencia presencial en *Mis Experiencias*.

Si tienes sedes y experiencias presenciales y sigue inactivo, recarga la página. Si persiste, escríbenos.`,
  },
  {
    slug: 'definir-horarios-y-disponibilidad',
    title: 'Horarios y disponibilidad: cuál manda',
    summary: 'Hay cuatro niveles de horario. Gana siempre el más específico.',
    category: 'Experiencias y publicaciones',
    position: 4,
    audience: ['HOST'],
    body: `Tu disponibilidad puede definirse en cuatro niveles. **Gana el más específico**, en este orden:

1. **La experiencia en una sede** — se define en *Publicaciones → Horario*.
2. **La experiencia**, que vale para todas sus sedes.
3. **La sede.**
4. **Tu agenda general.**

## Un error común

Pones un horario en *Disponibilidad* pero en el catálogo ves otro. Casi siempre es que la publicación tiene su propio horario y le está ganando. Revisa *Publicaciones → Horario* de esa experiencia.

Cada franja lleva su propio **cupo** (cuántas personas caben).`,
  },
  {
    slug: 'compartir-tu-catalogo-y-enlaces-individuales',
    title: 'Compartir tu catálogo y cada experiencia',
    summary: 'Un enlace para todo tu catálogo, otro para cada experiencia, y cómo incrustarlo en tu web.',
    category: 'Vender y compartir',
    position: 1,
    audience: ['HOST'],
    body: `Tienes tres formas de llevar clientes a reservar.

## 1. Tu catálogo completo

En *Catálogo digital* encuentras el enlace con todas tus experiencias publicadas. Es del estilo \`/book/tu-empresa\`.

## 2. Una experiencia suelta

Cada publicación tiene su **propio enlace**, que abre directamente esa experiencia en su sede y lista para elegir fecha. Úsalo para una promoción o una publicación en redes.

- Desde *Publicaciones*, usa **Copiar enlace** en la fila de la publicación.
- Desde el catálogo público, cada tarjeta tiene un botón de **compartir**. En el celular abre el menú de compartir; en el computador copia el enlace. Si la experiencia está en varias sedes, te pregunta de cuál.

Una publicación **en pausa** no tiene enlace, porque abriría una página no encontrada.

## 3. Incrustado en tu sitio web

En *Catálogo digital* puedes copiar el código para incrustar el catálogo y registrar los **dominios** donde lo vas a usar.`,
  },
  {
    slug: 'como-te-pagan-las-reservas',
    title: 'Cómo se cobra y cómo te pagan',
    summary: 'Cobra Tenemos Filo por defecto, o conecta tu propia pasarela para recibir el dinero directo.',
    category: 'Pagos y suscripción',
    position: 1,
    audience: ['HOST'],
    body: `En *Pagos* (dentro de Integraciones) decides con qué pasarela se cobran tus experiencias.

## Por defecto: cobra Tenemos Filo

El cliente paga a la plataforma y Tenemos Filo te **dispersa** lo que te corresponde, descontando su comisión.

## Con tu propia pasarela

Si conectas la tuya, el dinero **entra directo a tu cuenta**. La comisión de la plataforma sobre esas ventas se te cobra después, como una comisión por cobrar.

## Dónde ves tu dinero

En *Mis ingresos* aparecen tus reservas pagadas. Mientras un cliente no complete el pago, la reserva no se muestra ahí.

Puedes exigir el pago para confirmar la reserva. En ese caso el cupo **no se retiene** hasta que se cobra.`,
  },
  {
    slug: 'suscripcion-de-anfitrion',
    title: 'Tu suscripción',
    summary: 'Un solo plan, pago mensual y sin permanencia. Qué pasa si vence.',
    category: 'Pagos y suscripción',
    position: 2,
    audience: ['HOST'],
    body: `Tenemos Filo tiene **un solo plan**, de pago mensual y **sin permanencia**: pagas mes a mes y dejas de renovar cuando quieras.

## Cómo pagar

1. Entra a *Suscripción*.
2. Pulsa pagar. Te llevamos al checkout de Wompi.
3. Al volver, la página confirma el pago sola; toma unos segundos, así que no la cierres.

Cada pago compra **30 días** y se suman a los que ya te queden, así que pagar antes de tiempo no pierde nada. El valor se muestra con el IVA aparte.

## Si vence

Cuando la suscripción es exigida y vence, el panel se cierra hasta que renueves. Si tu empresa tiene una exención, no se te cobra.`,
  },
  {
    slug: 'canales-de-venta-opentable',
    title: 'Canales de venta: OpenTable',
    summary: 'La carga en OpenTable es asistida: te preparamos el contenido y tú lo pegas en su panel.',
    category: 'Vender y compartir',
    position: 2,
    audience: ['HOST'],
    body: `OpenTable no permite crear fichas desde fuera: su API está reservada a socios con contrato y solo cubre reservas y disponibilidad. Por eso la carga es **asistida**.

## Cómo funciona

1. En *Canales de venta*, busca tu experiencia y pulsa **Preparar**.
2. Si faltan datos, te los listamos con un enlace para completarlos.
3. Copia el contenido (campo por campo o con **Copiar todo**) y pégalo en tu panel de OpenTable.
4. Vuelve y registra la experiencia como **publicada**, con el enlace de la ficha si lo tienes.

Llevamos el registro de dónde quedó publicada cada experiencia. Si la retiras de OpenTable, quítala también aquí.`,
  },
  {
    slug: 'primeros-pasos-como-revendedor',
    title: 'Primeros pasos como revendedor',
    summary: 'Comparte las experiencias de la plataforma y gana comisión por cada reserva.',
    category: 'Primeros pasos',
    position: 3,
    audience: ['RESELLER'],
    body: `Como revendedor compartes experiencias de **todos los anfitriones** de la plataforma y ganas una comisión por cada reserva que llegue por ti.

## Tu catálogo

En *Mi catálogo* tienes tu enlace. Se actualiza solo: cuando un anfitrión publica una experiencia nueva, aparece ahí sin que hagas nada.

## Compartir una sola experiencia

En la misma pantalla, **Enlace de cada experiencia** lista cada publicación con su enlace propio. Cópialo para compartir una experiencia por redes o WhatsApp. La reserva queda atribuida a ti igual que con el enlace general.

## Cómo se atribuyen las ventas

Toda reserva que entre por tu enlace o por tu iframe queda atribuida a ti y genera tu comisión automáticamente. El cobro lo procesa Tenemos Filo.

- *Ventas de mi canal*: lo vendido y quién apareció.
- *Mis ingresos*: tus comisiones.

Si no ves tu enlace, tu cuenta todavía no tiene una empresa asociada: escríbenos y la vinculamos.`,
  },
  {
    slug: 'comisiones-del-revendedor',
    title: 'Mis comisiones',
    summary: 'Dónde ver lo que has ganado y qué cuenta como venta de tu canal.',
    category: 'Pagos y suscripción',
    position: 3,
    audience: ['RESELLER'],
    body: `Tu comisión se genera con cada reserva atribuida a tu canal, es decir, que entró por tu enlace o tu iframe.

- En *Ventas de mi canal* ves la operación: qué se vendió y quién reservó.
- En *Mis ingresos* ves el dinero cobrado. Una reserva aparece ahí cuando el cliente completa el pago.

El porcentaje o valor de la comisión lo define la plataforma. Si algo no cuadra, escríbenos con el número de la reserva.`,
  },
  {
    slug: 'hacer-una-reserva-como-comensal',
    title: 'Cómo reservar una experiencia',
    summary: 'Elige una experiencia, la fecha y confirma tu reserva.',
    category: 'Reservas',
    position: 1,
    audience: ['GUEST'],
    body: `1. Abre el enlace del catálogo que te compartieron.
2. Pulsa **Ver más** para conocer una experiencia o **Reservar** para ir directo.
3. Elige la sede (si hay varias), la fecha y la hora.
4. Completa tus datos y confirma.

Si el anfitrión exige pago, completa el pago para confirmar: **hasta entonces otra persona puede tomar tu lugar**.

Con tu reserva recibes un **código**; te lo pedirán al llegar.

Puedes ver tus reservas en *Mis reservas*.`,
  },
  {
    slug: 'acceso-con-api-y-asistentes-mcp',
    title: 'Claves de API y asistentes (MCP)',
    summary: 'Conecta tus sistemas o un asistente de IA a tu cuenta, y cómo revocar el acceso.',
    category: 'Integraciones',
    position: 1,
    audience: ['HOST', 'RESELLER'],
    body: `## Claves de API

En *Claves de API* generas claves para que otro sistema consulte o cree información en tu cuenta. **Guárdala al crearla**: por seguridad solo se muestra una vez.

## Asistentes por MCP

Con la integración MCP puedes conectar un asistente de IA para que actúe en tu nombre. Desde su pantalla copias la dirección del servidor y la pegas en el asistente.

## Revocar el acceso

Si revocas una clave o desconectas un asistente, **deja de poder entrar a tu cuenta en el momento**. Para volver a usarlo tendrás que conectarlo de nuevo.

Trata las claves como contraseñas: no las compartas ni las subas a repositorios públicos.`,
  },
];

async function main() {
  let creados = 0;
  for (const a of ARTICULOS) {
    const ya = await prisma.helpArticle.findUnique({ where: { slug: a.slug }, select: { id: true } });
    if (ya) continue;
    await prisma.helpArticle.create({ data: { ...a, isPublished: true } });
    creados += 1;
  }
  console.log(`Base de conocimiento: ${creados} creados, ${ARTICULOS.length - creados} ya existían.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
