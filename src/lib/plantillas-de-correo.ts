// Plantillas de correo que el administrador puede ver y editar.
//
// Cada plantilla tiene un texto por defecto, aquí en el código, y puede tener
// una versión propia en la tabla EmailTemplate. Si no hay fila se usa la del
// código, así que borrar la fila es "restaurar" y una plantilla nueva funciona
// desde el primer despliegue sin migrar datos.
//
// Lo editable es el asunto, el título de la cabecera, el cuerpo y el texto del
// botón. La maqueta (colores, pie) y el ENLACE del botón son del código: un
// error al editar no puede dejar un correo roto ni apuntando a otra parte.
//
// Los textos llevan variables con la forma {{empresa}}. Solo valen las que cada
// plantilla declara; guardar una desconocida se rechaza, porque saldría tal
// cual en el correo de un cliente.
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';
import { logger } from './logger.js';
import { PLANTILLAS_DE_RESERVA } from './plantillas-de-reserva.js';

export type VariableDePlantilla = {
  clave: string;
  descripcion: string;
  ejemplo: string;
  /**
   * Su valor ya es HTML armado por el codigo (una tabla, una lista): entra al
   * cuerpo sin escapar. Solo vale en el cuerpo; en el asunto, el titulo o el
   * boton se rechaza.
   */
  html?: boolean;
  /** Lo que se pone en la vista previa si el ejemplo no sirve tal cual (variables html). */
  muestra?: string;
};

/** Lo que da identidad al correo de un anfitrion: su logo y su color. */
export type ContextoDeMarca = { logo?: string | null; empresa?: string; colorMarca?: string | null };

export type Maqueta = (p: {
  titulo: string;
  cuerpo: string;
  botonTexto: string;
  botonUrl: string;
  contexto: ContextoDeMarca;
}) => string;

export type ContenidoDePlantilla = {
  subject: string;
  title: string;
  /** HTML sencillo: párrafos, listas, negritas y enlaces. */
  body: string;
  buttonText: string;
};

export type DefinicionDePlantilla = {
  /** Para agrupar la lista del administrador. */
  grupo: string;
  nombre: string;
  descripcion: string;
  /** Cuándo se envía, en palabras del administrador. */
  cuando: string;
  variables: VariableDePlantilla[];
  /** A dónde lleva el botón. Es del código, no se edita. */
  urlDelBoton: () => string;
  /** Maqueta propia; sin ella se usa la de las cuentas y suscripciones. */
  maqueta?: Maqueta;
  defecto: ContenidoDePlantilla;
};

const SALUDO: VariableDePlantilla = {
  clave: 'saludo',
  descripcion: 'Saludo con el nombre, o solo «Hola,» si no se conoce',
  ejemplo: 'Hola Ana,',
};
const EMPRESA: VariableDePlantilla = {
  clave: 'empresa',
  descripcion: 'Nombre de la empresa del anfitrión',
  ejemplo: 'Legado Cacao Experience',
};
const FECHA: VariableDePlantilla = {
  clave: 'fecha',
  descripcion: 'Fecha de vencimiento de la suscripción',
  ejemplo: '20 de noviembre de 2026',
};
const PRECIO: VariableDePlantilla = {
  clave: 'precio',
  descripcion: 'Valor del plan con IVA incluido',
  ejemplo: '$94.010 (IVA incluido)',
};
const ENLACE_AYUDA: VariableDePlantilla = {
  clave: 'enlace_ayuda',
  descripcion: 'Dirección del centro de ayuda',
  ejemplo: 'https://app.tenemosfilo.com/dashboard/ayuda',
};

const GRUPO_CUENTA = 'Cuenta y suscripción';

const urlPanel = () => `${env.APP_URL}/dashboard`;
const urlSuscripcion = () => `${env.APP_URL}/dashboard/suscripcion`;

export const PLANTILLAS = {
  bienvenida_anfitrion: {
    grupo: GRUPO_CUENTA,
    nombre: 'Bienvenida a un anfitrión',
    descripcion: 'Se envía al crear una cuenta de anfitrión.',
    cuando: 'Cuando alguien se registra como anfitrión',
    variables: [SALUDO, ENLACE_AYUDA],
    urlDelBoton: urlPanel,
    defecto: {
      subject: '¡Bienvenido a Tenemos Filo!',
      title: '¡Bienvenido a Tenemos Filo!',
      body: `<p>{{saludo}}</p>
<p>Tu cuenta de anfitrión ya está creada. Para empezar a vender te quedan tres pasos:</p>
<ol>
  <li><strong>Registra tu empresa</strong>: con sus datos se arma el enlace de tu catálogo.</li>
  <li><strong>Activa tu suscripción</strong>, si tu plan la requiere: un solo plan, pago mensual y sin permanencia.</li>
  <li><strong>Crea y publica tus experiencias</strong> en tus sedes y comparte tu catálogo.</li>
</ol>
<p>Si te quedas a medias, entra de nuevo y continuamos donde lo dejaste. También tienes un <a href="{{enlace_ayuda}}">centro de ayuda</a> con guías paso a paso.</p>`,
      buttonText: 'Continuar con mi registro',
    },
  },
  bienvenida: {
    grupo: GRUPO_CUENTA,
    nombre: 'Bienvenida (otros roles)',
    descripcion: 'Se envía al crear una cuenta que no es de anfitrión.',
    cuando: 'Cuando alguien se registra sin ser anfitrión',
    variables: [SALUDO, ENLACE_AYUDA],
    urlDelBoton: urlPanel,
    defecto: {
      subject: '¡Bienvenido a Tenemos Filo!',
      title: '¡Bienvenido a Tenemos Filo!',
      body: `<p>{{saludo}}</p>
<p>Tu cuenta ya está lista. Entra para ver todo lo que puedes hacer en la plataforma.</p>
<p>Si tienes dudas, el <a href="{{enlace_ayuda}}">centro de ayuda</a> tiene guías paso a paso.</p>`,
      buttonText: 'Entrar a mi cuenta',
    },
  },
  suscripcion_activa: {
    grupo: GRUPO_CUENTA,
    nombre: 'Suscripción activa',
    descripcion: 'Se envía cuando la empresa paga su primera suscripción.',
    cuando: 'Con el primer pago de una empresa, en línea o registrado a mano',
    variables: [EMPRESA, FECHA],
    urlDelBoton: urlPanel,
    defecto: {
      subject: 'Tu suscripción está activa',
      title: 'Tu suscripción está activa',
      body: `<p>Hola,</p>
<p>La suscripción de <strong>{{empresa}}</strong> a Tenemos Filo ya está activa hasta el <strong>{{fecha}}</strong>. Ya puedes usar todo el panel.</p>
<p>Lo que sigue: crea tus sedes y experiencias, publícalas y comparte el enlace de tu catálogo.</p>
<p>Es un plan mensual sin permanencia: te avisaremos antes de que venza y tú decides si renuevas.</p>`,
      buttonText: 'Ir a mi panel',
    },
  },
  suscripcion_renovada: {
    grupo: GRUPO_CUENTA,
    nombre: 'Pago de renovación recibido',
    descripcion: 'Se envía cuando una empresa que ya tenía suscripción paga otro mes.',
    cuando: 'Con cada pago después del primero',
    variables: [EMPRESA, FECHA],
    urlDelBoton: urlSuscripcion,
    defecto: {
      subject: 'Recibimos el pago de tu suscripción',
      title: 'Recibimos tu pago',
      body: `<p>Hola,</p>
<p>La suscripción de <strong>{{empresa}}</strong> a Tenemos Filo está al día hasta el <strong>{{fecha}}</strong>.</p>
<p>Gracias por seguir con nosotros.</p>`,
      buttonText: 'Ver mi suscripción',
    },
  },
  recordatorio_siete_dias: {
    grupo: GRUPO_CUENTA,
    nombre: 'Recordatorio: vence en una semana',
    descripcion: 'Aviso a los 7 días o menos del vencimiento.',
    cuando: 'Una vez, cuando faltan 7 días o menos para vencer',
    variables: [EMPRESA, FECHA, PRECIO],
    urlDelBoton: urlSuscripcion,
    defecto: {
      subject: 'Tu suscripción a Tenemos Filo vence en unos días',
      title: 'Tu suscripción está por vencer',
      body: `<p>Hola,</p>
<p>Tu suscripción vence el <strong>{{fecha}}</strong>. Renueva por {{precio}} para no perder el acceso a tu panel.</p>
<p>Empresa: <strong>{{empresa}}</strong></p>`,
      buttonText: 'Renovar mi suscripción',
    },
  },
  recordatorio_un_dia: {
    grupo: GRUPO_CUENTA,
    nombre: 'Recordatorio: vence mañana',
    descripcion: 'Aviso el día antes del vencimiento.',
    cuando: 'Una vez, cuando falta un día o menos para vencer',
    variables: [EMPRESA, FECHA, PRECIO],
    urlDelBoton: urlSuscripcion,
    defecto: {
      subject: 'Tu suscripción a Tenemos Filo vence mañana',
      title: 'Vence mañana',
      body: `<p>Hola,</p>
<p>Tu suscripción vence el <strong>{{fecha}}</strong>. Renueva por {{precio}} y sigue con tu panel sin interrupciones.</p>
<p>Empresa: <strong>{{empresa}}</strong></p>`,
      buttonText: 'Renovar mi suscripción',
    },
  },
  recordatorio_vencida: {
    grupo: GRUPO_CUENTA,
    nombre: 'Aviso: suscripción vencida',
    descripcion: 'Aviso cuando la suscripción ya venció y el panel quedó bloqueado.',
    cuando: 'Una vez, tras el vencimiento',
    variables: [EMPRESA, FECHA, PRECIO],
    urlDelBoton: urlSuscripcion,
    defecto: {
      subject: 'Tu suscripción a Tenemos Filo venció',
      title: 'Tu suscripción venció',
      body: `<p>Hola,</p>
<p>Venció el <strong>{{fecha}}</strong> y tu panel quedó bloqueado. Renueva por {{precio}} y vuelve a entrar al instante.</p>
<p>Empresa: <strong>{{empresa}}</strong></p>`,
      buttonText: 'Renovar mi suscripción',
    },
  },
  invitacion_cuenta: {
    grupo: GRUPO_CUENTA,
    nombre: 'Invitación a una cuenta',
    descripcion: 'Le llega a quien un administrador crea una cuenta, para que elija su contraseña.',
    cuando: 'Cuando un administrador crea una cuenta o reenvía la invitación',
    variables: [SALUDO],
    // El enlace lleva un token de un solo uso: lo pone el codigo en cada envio.
    urlDelBoton: () => `${env.APP_URL}/reset-password`,
    defecto: {
      subject: 'Tu cuenta en Tenemos Filo',
      title: 'Tu cuenta está lista',
      body: `<p>{{saludo}}</p>
<p>Te crearon una cuenta en <strong>Tenemos Filo</strong>. Solo falta que elijas tu contraseña para entrar.</p>
<p style="font-size:13px;color:#6b7280;">El enlace caduca en 7 días y solo puede usarse una vez. Si caduca, pide uno nuevo desde «¿Olvidaste tu contraseña?» en la pantalla de acceso.</p>
<p style="font-size:13px;color:#6b7280;">Si no esperabas este correo, puedes ignorarlo: sin elegir contraseña, la cuenta no se puede usar.</p>`,
      buttonText: 'Elegir mi contraseña',
    },
  },
  restablecer_contrasena: {
    grupo: GRUPO_CUENTA,
    nombre: 'Recuperar contraseña',
    descripcion: 'Se envía a quien pide restablecer su contraseña.',
    cuando: 'Cuando alguien usa «¿Olvidaste tu contraseña?»',
    variables: [],
    urlDelBoton: () => `${env.APP_URL}/reset-password`,
    defecto: {
      subject: 'Recupera tu contraseña - Tenemos Filo',
      title: 'Recuperar contraseña',
      body: `<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
<p>Haz clic en el botón para elegir una contraseña nueva.</p>
<p style="font-size:13px;color:#6b7280;">El enlace caduca en 1 hora y solo puede usarse una vez.</p>
<p style="font-size:13px;color:#6b7280;">Si no solicitaste este cambio, ignora este correo: tu contraseña seguirá igual.</p>`,
      buttonText: 'Cambiar mi contraseña',
    },
  },
  ...PLANTILLAS_DE_RESERVA,
} satisfies Record<string, DefinicionDePlantilla>;

/** Las plantillas como un mapa suelto, para consultar campos opcionales sin pelear con los tipos. */
const definicion = (key: ClaveDePlantilla): DefinicionDePlantilla => PLANTILLAS[key];

export type ClaveDePlantilla = keyof typeof PLANTILLAS;

export const esClaveDePlantilla = (k: string): k is ClaveDePlantilla => k in PLANTILLAS;

// ── Texto ───────────────────────────────────────────────────────────────────

const escaparHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Quita del HTML lo que no tiene sitio en un correo y sí podría hacer daño en
 * la vista previa: scripts, marcos, formularios, manejadores on* y enlaces
 * javascript:. Quien edita es el administrador, así que esto es una red de
 * seguridad y no la defensa principal (la vista previa va en un iframe aislado).
 */
export function limpiarHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Las variables que un texto usa, para validarlas contra las que la plantilla declara. */
export const variablesUsadas = (texto: string): string[] =>
  [...texto.matchAll(VARIABLE)].map((m) => m[1]!);

/**
 * `sinEscapar` son las variables cuyo valor ya es HTML del codigo: en el cuerpo
 * entran tal cual. Todo lo demas se escapa, porque viene de personas (el nombre
 * de quien reserva, por ejemplo).
 */
function sustituir(
  texto: string,
  valores: Record<string, string>,
  comoHtml: boolean,
  sinEscapar: ReadonlySet<string> = new Set(),
): string {
  return texto.replace(VARIABLE, (_, clave: string) => {
    const v = valores[clave] ?? '';
    return comoHtml && !sinEscapar.has(clave) ? escaparHtml(v) : v;
  });
}

const clavesHtml = (key: ClaveDePlantilla): Set<string> =>
  new Set(definicion(key).variables.filter((v) => v.html).map((v) => v.clave));

// ── Lectura y validación ────────────────────────────────────────────────────

export type PlantillaResuelta = ContenidoDePlantilla & { personalizada: boolean; updatedAt: Date | null };

/** La versión vigente: la del administrador si existe, o la del código. */
export async function plantillaVigente(key: ClaveDePlantilla): Promise<PlantillaResuelta> {
  // Un fallo al leer la version del administrador no puede costar el correo:
  // se manda con el texto original, que siempre existe.
  const fila = await prisma.emailTemplate.findUnique({ where: { key } }).catch((err: unknown) => {
    logger.error({ err, key }, 'no se pudo leer la plantilla de correo; se usa el texto original');
    return null;
  });
  if (!fila) return { ...PLANTILLAS[key].defecto, personalizada: false, updatedAt: null };
  return {
    subject: fila.subject,
    title: fila.title,
    body: fila.body,
    buttonText: fila.buttonText,
    personalizada: true,
    updatedAt: fila.updatedAt,
  };
}

/**
 * Comprueba y limpia lo que el administrador quiere guardar. Lanza 400 con un
 * mensaje que dice QUÉ variable sobra, porque «datos inválidos» no ayuda.
 */
export function validarContenido(key: ClaveDePlantilla, c: ContenidoDePlantilla): ContenidoDePlantilla {
  const permitidas = new Set(PLANTILLAS[key].variables.map((v) => v.clave));
  const desconocidas = new Set<string>();
  for (const texto of [c.subject, c.title, c.body, c.buttonText]) {
    for (const v of variablesUsadas(texto)) if (!permitidas.has(v)) desconocidas.add(v);
  }
  if (desconocidas.size > 0) {
    const lista = [...desconocidas].map((v) => `{{${v}}}`).join(', ');
    const validas = [...permitidas].map((v) => `{{${v}}}`).join(', ') || 'ninguna';
    throw BadRequest(`Variables que esta plantilla no tiene: ${lista}. Las disponibles son: ${validas}.`);
  }
  // Las que traen HTML armado solo caben en el cuerpo: en el asunto saldrian
  // como etiquetas sueltas.
  const soloCuerpo = clavesHtml(key);
  const mal = new Set<string>();
  for (const texto of [c.subject, c.title, c.buttonText]) {
    for (const v of variablesUsadas(texto)) if (soloCuerpo.has(v)) mal.add(v);
  }
  if (mal.size > 0) {
    const lista = [...mal].map((v) => `{{${v}}}`).join(', ');
    throw BadRequest(`${lista} solo se puede usar en el cuerpo, no en el asunto, el título ni el botón.`);
  }
  return { ...c, body: limpiarHtml(c.body) };
}

// ── Maquetación ─────────────────────────────────────────────────────────────

function maquetar(titulo: string, cuerpoHtml: string, botonTexto: string, botonUrl: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%"><tr><td align="center">
  <table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#F26726;color:#fff;padding:24px 32px;font-size:22px;font-weight:bold;">${escaparHtml(titulo)}</td></tr>
    <tr><td style="padding:32px;color:#374151;font-size:15px;line-height:1.6;">${cuerpoHtml}
      ${
        botonTexto.trim()
          ? `<p style="margin:28px 0 0;text-align:center;"><a href="${escaparHtml(botonUrl)}" style="background:#F26726;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:bold;display:inline-block;">${escaparHtml(botonTexto)}</a></p>`
          : ''
      }
    </td></tr>
    <tr><td style="padding:16px 32px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center;">Tenemos Filo · experiencias gastronómicas</td></tr>
  </table></td></tr></table></body></html>`;
}

export type OpcionesDeCorreo = {
  /** Destino del boton cuando no es fijo (el enlace con token de una calificacion). */
  botonUrl?: string;
  /** Logo y color del anfitrion, para las plantillas que llevan su marca. */
  contexto?: ContextoDeMarca;
};

/** Arma asunto y HTML a partir de un contenido (guardado o borrador) y los valores de las variables. */
export function componer(
  key: ClaveDePlantilla,
  contenido: ContenidoDePlantilla,
  valores: Record<string, string>,
  opciones: OpcionesDeCorreo = {},
): { subject: string; html: string } {
  const def = definicion(key);
  const titulo = sustituir(contenido.title, valores, false);
  // Se limpia la plantilla antes de rellenarla, no despues: lo que ya entro
  // escapado no debe mutilarse, y lo que escribio el administrador si se revisa.
  const cuerpo = sustituir(limpiarHtml(contenido.body), valores, true, clavesHtml(key));
  const botonTexto = sustituir(contenido.buttonText, valores, false);
  const botonUrl = opciones.botonUrl ?? def.urlDelBoton();
  return {
    subject: sustituir(contenido.subject, valores, false),
    html: def.maqueta
      ? def.maqueta({ titulo, cuerpo, botonTexto, botonUrl, contexto: opciones.contexto ?? {} })
      : maquetar(titulo, cuerpo, botonTexto, botonUrl),
  };
}

/** El correo listo para enviar con la versión vigente de la plantilla. */
export async function armarCorreo(
  key: ClaveDePlantilla,
  valores: Record<string, string>,
  opciones?: OpcionesDeCorreo,
): Promise<{ subject: string; html: string }> {
  return componer(key, await plantillaVigente(key), valores, opciones);
}

/** Valores de ejemplo para la vista previa y los correos de prueba. */
export const valoresDeEjemplo = (key: ClaveDePlantilla): Record<string, string> =>
  Object.fromEntries(definicion(key).variables.map((v) => [v.clave, v.muestra ?? v.ejemplo]));
