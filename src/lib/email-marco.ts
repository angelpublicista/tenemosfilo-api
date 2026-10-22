// Maqueta de los correos de reserva: colores, tabla de datos, boton y marco.
//
// Vive aparte de email-reservas.ts porque las plantillas editables
// (plantillas-de-reserva.ts) necesitan la maqueta y email-reservas necesita las
// plantillas: separarla evita que se importen en circulo.
import { env } from '../config/env.js';

export const NARANJA = '#F26726';
export const AZUL = '#334C5D';
export const VERDE = '#16a34a';
export const ROJO = '#dc2626';

/**
 * Colombia, siempre.
 *
 * Sin fijar la zona, la hora sale en la del servidor: en produccion eso es
 * UTC y el correo le diria al comensal que su cena es cinco horas mas
 * tarde. Una reserva mal fechada es peor que no mandar el correo.
 */
const ZONA = 'America/Bogota';

export const fechaLarga = (f: Date) =>
  f.toLocaleDateString('es-CO', {
    timeZone: ZONA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export const hora = (f: Date) =>
  f.toLocaleTimeString('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });

export const dinero = (n: number) =>
  `$${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

export const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/**
 * Escapa lo que viene del usuario antes de meterlo en el HTML.
 *
 * El nombre del cliente y las peticiones especiales son texto libre que
 * cualquiera puede escribir desde el motor de reservas publico. Sin esto,
 * un nombre con etiquetas se ejecutaria dentro del correo del anfitrion.
 */
export function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Blanco o negro, el que se lea sobre ese fondo.
 *
 * El blanco es el de siempre y se respeta: esto es una red de seguridad, no
 * un optimizador de contraste. Solo se pasa a texto oscuro cuando el blanco
 * encima seria ilegible de verdad —por debajo de 3:1, que no alcanza ni para
 * texto grande segun la WCAG—.
 *
 * El maximo contraste matematico pediria texto oscuro sobre el naranja de la
 * plataforma, lo que cambiaria el aspecto de todos los correos que ya se
 * mandan. Aqui solo se interviene con un amarillo o un pastel, que es donde
 * el problema es real. El umbral sale de despejar 1,05 / (L + 0,05) < 3.
 */
export function textoSobre(fondo: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fondo.trim());
  const cifras = m?.[1];
  if (!cifras) return '#ffffff';
  const n = parseInt(cifras, 16);
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L =
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255);
  // El umbral sale de igualar el contraste contra blanco y contra negro.
  return L > 0.30 ? '#111827' : '#ffffff';
}

export type Fila = { etiqueta: string; valor: string };

/**
 * Los datos de la reserva como tabla.
 *
 * Tabla y estilos en linea, no flex ni clases: los clientes de correo
 * —Outlook sobre todo— no soportan CSS moderno y romperian el bloque que
 * justamente tiene que leerse de un vistazo.
 */
export function bloqueDatos(filas: Fila[]): string {
  const cuerpo = filas
    .filter((f) => f.valor)
    .map(
      (f) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%;vertical-align:top;">${esc(
            f.etiqueta,
          )}</td>
          <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;">${f.valor}</td>
        </tr>`,
    )
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                 style="border-collapse:collapse;margin:8px 0 24px;">${cuerpo}</table>`;
}

export function boton(texto: string, url: string, color: string = NARANJA): string {
  return `
    <p style="text-align:center;margin:28px 0 8px;">
      <a href="${esc(url)}"
         style="display:inline-block;background-color:${color};color:${textoSobre(color)};padding:13px 28px;
                text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">
        ${esc(texto)}
      </a>
    </p>`;
}

/**
 * La marca del anfitrion, sobre banda blanca.
 *
 * No va dentro de la cabecera de color porque ese color cambia segun el
 * mensaje —verde si se confirma, rojo si se cancela— y el logo lo pone cada
 * anfitrion: no hay forma de saber si contrastara. Sobre blanco funciona
 * siempre.
 *
 * El alt lleva el nombre de la empresa a proposito: muchos clientes de correo
 * bloquean las imagenes por defecto, y asi lo que se ve en su lugar sigue
 * diciendo de quien es el correo.
 */
function bandaDeMarca(logo: string | null | undefined, empresa: string): string {
  if (!logo) return '';
  return `
            <tr>
              <td style="padding:24px 32px 8px;text-align:center;background-color:#ffffff;">
                <img src="${esc(logo)}" alt="${esc(empresa)}"
                     style="max-height:52px;max-width:200px;height:auto;width:auto;" />
              </td>
            </tr>`;
}

/** Marco comun: marca del anfitrion, cabecera de color, contenido y pie. */
export function marco(opts: {
  titulo: string;
  color: string;
  contenido: string;
  logo?: string | null;
  empresa?: string;
  /** Pie del correo. Los del comensal llevan el de la especificacion. */
  pie?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(opts.titulo)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background-color:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600"
                 style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;
                        font-family:Arial,Helvetica,sans-serif;">
            ${bandaDeMarca(opts.logo, opts.empresa ?? 'Tenemos Filo')}
            <tr>
              <td style="background-color:${opts.color};padding:28px 32px;">
                <h1 style="margin:0;color:${textoSobre(opts.color)};font-size:22px;font-weight:700;">${esc(
                  opts.titulo,
                )}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#374151;font-size:15px;line-height:1.6;">
                ${opts.contenido}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f9fafb;color:#9ca3af;font-size:12px;text-align:center;">
                ${esc(opts.pie ?? 'Tenemos Filo · experiencias gastronómicas')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Pie de todo correo que le llega al comensal. */
export const PIE_DEL_COMENSAL = 'Reserva gestionada con FILO.';

export const PANEL_ANFITRION = `${env.APP_URL}/dashboard/reservations`;
export const PANEL_COMENSAL = `${env.APP_URL}/dashboard/mis-reservas`;
export const PANEL_INGRESOS = `${env.APP_URL}/dashboard/ingresos`;
