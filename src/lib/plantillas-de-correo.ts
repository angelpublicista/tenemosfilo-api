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

export type VariableDePlantilla = { clave: string; descripcion: string; ejemplo: string };

export type ContenidoDePlantilla = {
  subject: string;
  title: string;
  /** HTML sencillo: párrafos, listas, negritas y enlaces. */
  body: string;
  buttonText: string;
};

export type DefinicionDePlantilla = {
  nombre: string;
  descripcion: string;
  /** Cuándo se envía, en palabras del administrador. */
  cuando: string;
  variables: VariableDePlantilla[];
  /** A dónde lleva el botón. Es del código, no se edita. */
  urlDelBoton: () => string;
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

const urlPanel = () => `${env.APP_URL}/dashboard`;
const urlSuscripcion = () => `${env.APP_URL}/dashboard/suscripcion`;

export const PLANTILLAS = {
  bienvenida_anfitrion: {
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
} satisfies Record<string, DefinicionDePlantilla>;

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

function sustituir(texto: string, valores: Record<string, string>, comoHtml: boolean): string {
  return texto.replace(VARIABLE, (_, clave: string) => {
    const v = valores[clave] ?? '';
    return comoHtml ? escaparHtml(v) : v;
  });
}

// ── Lectura y validación ────────────────────────────────────────────────────

export type PlantillaResuelta = ContenidoDePlantilla & { personalizada: boolean; updatedAt: Date | null };

/** La versión vigente: la del administrador si existe, o la del código. */
export async function plantillaVigente(key: ClaveDePlantilla): Promise<PlantillaResuelta> {
  const fila = await prisma.emailTemplate.findUnique({ where: { key } });
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

/** Arma asunto y HTML a partir de un contenido (guardado o borrador) y los valores de las variables. */
export function componer(
  key: ClaveDePlantilla,
  contenido: ContenidoDePlantilla,
  valores: Record<string, string>,
): { subject: string; html: string } {
  const def = PLANTILLAS[key];
  return {
    subject: sustituir(contenido.subject, valores, false),
    html: maquetar(
      sustituir(contenido.title, valores, false),
      limpiarHtml(sustituir(contenido.body, valores, true)),
      sustituir(contenido.buttonText, valores, false),
      def.urlDelBoton(),
    ),
  };
}

/** El correo listo para enviar con la versión vigente de la plantilla. */
export async function armarCorreo(
  key: ClaveDePlantilla,
  valores: Record<string, string>,
): Promise<{ subject: string; html: string }> {
  return componer(key, await plantillaVigente(key), valores);
}

/** Valores de ejemplo para la vista previa y los correos de prueba. */
export const valoresDeEjemplo = (key: ClaveDePlantilla): Record<string, string> =>
  Object.fromEntries(PLANTILLAS[key].variables.map((v) => [v.clave, v.ejemplo]));
