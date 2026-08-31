// Plantillas de los correos de reserva.
//
// Viven aparte de email.ts porque ese archivo es el transporte —como se
// entrega un correo— y este es el contenido. Cambiar el proveedor de envio
// no deberia obligar a tocar los textos, ni al reves.
//
// El mismo hecho se le cuenta distinto a cada quien: al comensal le importa
// SU plan, al anfitrion le importa a quien tiene que atender, y al admin le
// importa que la plataforma esta vendiendo. Por eso hay una plantilla por
// audiencia y no una sola con condicionales.
import { env } from '../config/env.js';

const NARANJA = '#F26726';
const AZUL = '#334C5D';
const VERDE = '#16a34a';
const ROJO = '#dc2626';

/**
 * Colombia, siempre.
 *
 * Sin fijar la zona, la hora sale en la del servidor: en produccion eso es
 * UTC y el correo le diria al comensal que su cena es cinco horas mas
 * tarde. Una reserva mal fechada es peor que no mandar el correo.
 */
const ZONA = 'America/Bogota';

const fechaLarga = (f: Date) =>
  f.toLocaleDateString('es-CO', {
    timeZone: ZONA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const hora = (f: Date) =>
  f.toLocaleTimeString('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });

const dinero = (n: number) =>
  `$${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/**
 * Escapa lo que viene del usuario antes de meterlo en el HTML.
 *
 * El nombre del cliente y las peticiones especiales son texto libre que
 * cualquiera puede escribir desde el motor de reservas publico. Sin esto,
 * un nombre con etiquetas se ejecutaria dentro del correo del anfitrion.
 */
function esc(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type DatosCorreoReserva = {
  reservationNumber: string;
  experienceTitle: string;
  empresaNombre: string;
  reservationDate: Date;
  participants: number;
  clienteNombre: string;
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  lugar?: string | null;
  peticiones?: string | null;
  total?: number;
  /**
   * Logo del anfitrion de la experiencia reservada. El correo lo manda Filo,
   * pero quien presta el servicio es el anfitrion: es su marca la que el
   * comensal reconoce. Si no tiene logo, se queda su nombre en el texto.
   */
  logoEmpresa?: string | null;
};

type Fila = { etiqueta: string; valor: string };

/**
 * Los datos de la reserva como tabla.
 *
 * Tabla y estilos en linea, no flex ni clases: los clientes de correo
 * —Outlook sobre todo— no soportan CSS moderno y romperian el bloque que
 * justamente tiene que leerse de un vistazo.
 */
function bloqueDatos(filas: Fila[]): string {
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

function boton(texto: string, url: string): string {
  return `
    <p style="text-align:center;margin:28px 0 8px;">
      <a href="${esc(url)}"
         style="display:inline-block;background-color:${NARANJA};color:#ffffff;padding:13px 28px;
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
function marco(opts: {
  titulo: string;
  color: string;
  contenido: string;
  logo?: string | null;
  empresa?: string;
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
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(
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
                Tenemos Filo · experiencias gastronómicas
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const PANEL_ANFITRION = `${env.APP_URL}/dashboard/reservations`;
const PANEL_COMENSAL = `${env.APP_URL}/dashboard/mis-reservas`;

const datosDelPlan = (d: DatosCorreoReserva): Fila[] => [
  { etiqueta: 'Experiencia', valor: esc(d.experienceTitle) },
  { etiqueta: 'Fecha', valor: `${esc(fechaLarga(d.reservationDate))}, ${esc(hora(d.reservationDate))}` },
  { etiqueta: 'Personas', valor: esc(personas(d.participants)) },
  { etiqueta: 'Lugar', valor: esc(d.lugar ?? '') },
  { etiqueta: 'Código', valor: esc(d.reservationNumber) },
];

// ---------------------------------------------------------------------------
// Reserva nueva
// ---------------------------------------------------------------------------

/** Al comensal: confirmacion de que su solicitud entro y que sigue. */
export function correoReservaComensal(d: DatosCorreoReserva) {
  return {
    subject: `Recibimos tu reserva · ${d.experienceTitle}`,
    html: marco({
      titulo: 'Tu reserva quedó registrada',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: NARANJA,
      contenido: `
        <p>Hola ${esc(d.clienteNombre)},</p>
        <p>Registramos tu reserva en <strong>${esc(d.empresaNombre)}</strong>.
           Te avisaremos por este medio en cuanto el anfitrión la confirme.</p>
        ${bloqueDatos([
          ...datosDelPlan(d),
          { etiqueta: 'Total', valor: d.total ? esc(dinero(d.total)) : '' },
        ])}
        ${boton('Ver mi reserva', PANEL_COMENSAL)}
        <p style="font-size:13px;color:#6b7280;margin-top:24px;">
          Guarda el código <strong>${esc(d.reservationNumber)}</strong>: es lo que te van a pedir el día de la experiencia.
        </p>`,
    }),
  };
}

/** Al anfitrion: una venta que atender, con como contactar al cliente. */
export function correoReservaAnfitrion(d: DatosCorreoReserva) {
  return {
    subject: `Nueva reserva · ${d.experienceTitle} · ${fechaLarga(d.reservationDate)}`,
    html: marco({
      titulo: 'Tienes una reserva nueva',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: AZUL,
      contenido: `
        <p><strong>${esc(d.clienteNombre)}</strong> reservó ${esc(
          personas(d.participants),
        )} en ${esc(d.experienceTitle)}.</p>
        ${bloqueDatos([
          ...datosDelPlan(d),
          // El anfitrion necesita poder escribirle o llamarlo sin entrar al
          // panel: muchas veces lee esto desde el celular en servicio.
          { etiqueta: 'Contacto', valor: esc(d.clienteEmail ?? '') },
          { etiqueta: 'Teléfono', valor: esc(d.clienteTelefono ?? '') },
          { etiqueta: 'Peticiones', valor: esc(d.peticiones ?? '') },
          { etiqueta: 'Total', valor: d.total ? esc(dinero(d.total)) : '' },
        ])}
        ${boton('Confirmar en el panel', PANEL_ANFITRION)}`,
    }),
  };
}

/** Al admin: pulso de la plataforma, sin el detalle operativo del servicio. */
export function correoReservaAdmin(d: DatosCorreoReserva) {
  return {
    subject: `[Filo] Reserva ${d.reservationNumber} · ${d.empresaNombre}`,
    html: marco({
      titulo: 'Reserva nueva en la plataforma',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: AZUL,
      contenido: `
        ${bloqueDatos([
          { etiqueta: 'Empresa', valor: esc(d.empresaNombre) },
          ...datosDelPlan(d),
          { etiqueta: 'Cliente', valor: esc(d.clienteNombre) },
          { etiqueta: 'Total', valor: d.total ? esc(dinero(d.total)) : '' },
        ])}
        ${boton('Ver en el panel', PANEL_ANFITRION)}`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Cambios de estado
// ---------------------------------------------------------------------------

/** Al comensal: confirmada. Es el correo que va a guardar y releer. */
export function correoConfirmadaComensal(d: DatosCorreoReserva) {
  return {
    subject: `Confirmada · ${d.experienceTitle} · ${fechaLarga(d.reservationDate)}`,
    html: marco({
      titulo: '¡Tu reserva está confirmada!',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: VERDE,
      contenido: `
        <p>Hola ${esc(d.clienteNombre)},</p>
        <p><strong>${esc(d.empresaNombre)}</strong> confirmó tu reserva. Te esperan:</p>
        ${bloqueDatos(datosDelPlan(d))}
        ${boton('Ver mi reserva', PANEL_COMENSAL)}`,
    }),
  };
}

export function correoCanceladaComensal(d: DatosCorreoReserva, motivo?: string) {
  return {
    subject: `Reserva cancelada · ${d.experienceTitle}`,
    html: marco({
      titulo: 'Tu reserva fue cancelada',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: ROJO,
      contenido: `
        <p>Hola ${esc(d.clienteNombre)},</p>
        <p>Se canceló tu reserva en <strong>${esc(d.empresaNombre)}</strong>.</p>
        ${bloqueDatos([
          ...datosDelPlan(d),
          { etiqueta: 'Motivo', valor: esc(motivo ?? '') },
        ])}
        <p style="font-size:13px;color:#6b7280;">
          Si ya habías pagado, el reembolso se gestiona con el anfitrión.
        </p>
        ${boton('Ver mis reservas', PANEL_COMENSAL)}`,
    }),
  };
}

/**
 * Al anfitrion cuando le cancelan.
 *
 * No estaba en la lista de correos pedida, pero una cancelacion le libera
 * cupo y le quita ingreso: enterarse al dia siguiente entrando al panel es
 * tarde para revender esa mesa.
 */
export function correoCanceladaAnfitrion(d: DatosCorreoReserva, motivo?: string) {
  return {
    subject: `Cancelación · ${d.reservationNumber} · ${d.experienceTitle}`,
    html: marco({
      titulo: 'Se canceló una reserva',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: ROJO,
      contenido: `
        <p><strong>${esc(d.clienteNombre)}</strong> ya no asiste. El cupo queda libre.</p>
        ${bloqueDatos([
          ...datosDelPlan(d),
          { etiqueta: 'Motivo', valor: esc(motivo ?? '') },
        ])}
        ${boton('Ver reservas', PANEL_ANFITRION)}`,
    }),
  };
}

export function correoReprogramadaComensal(d: DatosCorreoReserva, motivo?: string) {
  return {
    subject: `Nueva fecha · ${d.experienceTitle}`,
    html: marco({
      titulo: 'Cambió la fecha de tu reserva',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: NARANJA,
      contenido: `
        <p>Hola ${esc(d.clienteNombre)},</p>
        <p>Tu reserva en <strong>${esc(d.empresaNombre)}</strong> quedó para una fecha nueva:</p>
        ${bloqueDatos([
          ...datosDelPlan(d),
          { etiqueta: 'Motivo', valor: esc(motivo ?? '') },
        ])}
        ${boton('Ver mi reserva', PANEL_COMENSAL)}`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

/** Al comensal: comprobante. Lo va a buscar despues, asi que lleva el detalle. */
export function correoPagoComensal(d: DatosCorreoReserva) {
  return {
    subject: `Pago confirmado · ${d.reservationNumber}`,
    html: marco({
      titulo: 'Recibimos tu pago',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: VERDE,
      contenido: `
        <p>Hola ${esc(d.clienteNombre)},</p>
        <p>Tu pago quedó registrado. Esto sirve como comprobante.</p>
        ${bloqueDatos([
          { etiqueta: 'Pagado', valor: d.total ? esc(dinero(d.total)) : '' },
          ...datosDelPlan(d),
          { etiqueta: 'Anfitrión', valor: esc(d.empresaNombre) },
        ])}
        ${boton('Ver mi reserva', PANEL_COMENSAL)}`,
    }),
  };
}

export function correoPagoAnfitrion(d: DatosCorreoReserva) {
  return {
    subject: `Pago recibido · ${d.reservationNumber}`,
    html: marco({
      titulo: 'Entró un pago',
      logo: d.logoEmpresa,
      empresa: d.empresaNombre,
      color: VERDE,
      contenido: `
        ${bloqueDatos([
          { etiqueta: 'Monto', valor: d.total ? esc(dinero(d.total)) : '' },
          ...datosDelPlan(d),
          { etiqueta: 'Cliente', valor: esc(d.clienteNombre) },
        ])}
        <p style="font-size:13px;color:#6b7280;">
          Lo que te corresponde de esta venta lo ves en Ingresos, ya descontada la comisión.
        </p>
        ${boton('Ver ingresos', `${env.APP_URL}/dashboard/ingresos`)}`,
    }),
  };
}
