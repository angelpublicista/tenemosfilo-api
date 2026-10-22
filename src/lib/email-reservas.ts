// Correos de reserva: que datos lleva cada uno.
//
// Los TEXTOS viven en plantillas-de-reserva.ts, donde el administrador puede
// editarlos, y la maqueta en email-marco.ts. Aqui solo se decide con que valores
// se rellena cada plantilla y se arman las tablas de datos, que son del codigo.
//
// El mismo hecho se le cuenta distinto a cada quien: al comensal le importa
// SU plan, al anfitrion le importa a quien tiene que atender, y al admin le
// importa que la plataforma esta vendiendo. Por eso hay una plantilla por
// audiencia y no una sola con condicionales.
import { armarCorreo, type ClaveDePlantilla } from './plantillas-de-correo.js';
import { bloqueDatos, dinero, esc, fechaLarga, hora, personas, type Fila } from './email-marco.js';

export type DatosCorreoReserva = {
  reservationNumber: string;
  /** El que se enseña al llegar. Puede faltar en reservas anteriores a el. */
  confirmationCode?: string | null;
  experienceTitle: string;
  empresaNombre: string;
  reservationDate: Date;
  participants: number;
  clienteNombre: string;
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  lugar?: string | null;
  /** El idioma que pidio, ya en nombre y no en codigo: "Inglés". */
  idioma?: string | null;
  peticiones?: string | null;
  total?: number;
  /** Lo que lleva pagado. Sin valor mientras no haya pagado nada. */
  pagado?: number;
  /**
   * Logo del anfitrion de la experiencia reservada. El correo lo manda Filo,
   * pero quien presta el servicio es el anfitrion: es su marca la que el
   * comensal reconoce. Si no tiene logo, se queda su nombre en el texto.
   */
  logoEmpresa?: string | null;
  /**
   * Color principal del anfitrion. Sin el, el naranja de la plataforma.
   *
   * Solo tiñe lo que no significa nada por si mismo: la banda de un aviso
   * neutro y los botones. El verde de "confirmada" y el rojo de "cancelada"
   * se quedan como estan —son informacion, no decoracion, y un anfitrion con
   * la marca verde estaria anunciando una cancelacion en color de exito—.
   */
  colorMarca?: string | null;
};

/** Los valores que casi todas las plantillas de reserva comparten. */
function valoresComunes(d: DatosCorreoReserva): Record<string, string> {
  return {
    cliente: d.clienteNombre,
    empresa: d.empresaNombre,
    experiencia: d.experienceTitle,
    fecha: fechaLarga(d.reservationDate),
    hora: hora(d.reservationDate),
    personas: personas(d.participants),
    lugar: d.lugar ?? '',
    // El de la puerta, no el numero de reserva: ese lleva la hora dentro y solo
    // tres caracteres al azar, asi que se puede adivinar.
    codigo: d.confirmationCode ?? d.reservationNumber,
    numero_reserva: d.reservationNumber,
    total: d.total ? dinero(d.total) : '',
  };
}

/** Arma el correo de una plantilla con los valores comunes de la reserva y los propios de ese correo. */
function armar(
  key: ClaveDePlantilla,
  d: DatosCorreoReserva,
  extra: Record<string, string> = {},
  botonUrl?: string,
) {
  return armarCorreo(key, { ...valoresComunes(d), ...extra }, {
    botonUrl,
    contexto: { logo: d.logoEmpresa, empresa: d.empresaNombre, colorMarca: d.colorMarca },
  });
}

const datosDelPlan = (d: DatosCorreoReserva): Fila[] => [
  { etiqueta: 'Experiencia', valor: esc(d.experienceTitle) },
  { etiqueta: 'Fecha', valor: `${esc(fechaLarga(d.reservationDate))}, ${esc(hora(d.reservationDate))}` },
  { etiqueta: 'Personas', valor: esc(personas(d.participants)) },
  { etiqueta: 'Lugar', valor: esc(d.lugar ?? '') },
  // Solo si lo pidio. Va en el plan y no solo en el correo del anfitrion
  // porque el comensal tambien necesita ver confirmado lo que eligio.
  { etiqueta: 'Idioma', valor: esc(d.idioma ?? '') },
  // El de la puerta, no el numero de reserva: ese lleva la hora dentro y solo
  // tres caracteres al azar, asi que se puede adivinar. El numero sigue siendo
  // la referencia para el pago y para soporte.
  { etiqueta: 'Código', valor: esc(d.confirmationCode ?? d.reservationNumber) },
  { etiqueta: 'N.º de reserva', valor: esc(d.reservationNumber) },
];

// ---------------------------------------------------------------------------
// Reserva nueva
// ---------------------------------------------------------------------------

/** Al anfitrion: una venta que atender, con como contactar al cliente. */
export function correoReservaAnfitrion(d: DatosCorreoReserva) {
  return armar('reserva_nueva_anfitrion', d, {
    datos_reserva: bloqueDatos([
      ...datosDelPlan(d),
      // El anfitrion necesita poder escribirle o llamarlo sin entrar al
      // panel: muchas veces lee esto desde el celular en servicio.
      { etiqueta: 'Contacto', valor: esc(d.clienteEmail ?? '') },
      { etiqueta: 'Teléfono', valor: esc(d.clienteTelefono ?? '') },
      { etiqueta: 'Peticiones', valor: esc(d.peticiones ?? '') },
      { etiqueta: 'Total', valor: d.total ? esc(dinero(d.total)) : '' },
    ]),
  });
}

/** Al admin: pulso de la plataforma, sin el detalle operativo del servicio. */
export function correoReservaAdmin(d: DatosCorreoReserva) {
  return armar('reserva_nueva_admin', d, {
    datos_reserva: bloqueDatos([
      { etiqueta: 'Empresa', valor: esc(d.empresaNombre) },
      ...datosDelPlan(d),
      { etiqueta: 'Cliente', valor: esc(d.clienteNombre) },
      { etiqueta: 'Total', valor: d.total ? esc(dinero(d.total)) : '' },
    ]),
  });
}

// ---------------------------------------------------------------------------
// Cambios de estado
// ---------------------------------------------------------------------------

/** Al comensal: confirmada. Es el correo que va a guardar y releer. */
export function correoConfirmadaComensal(d: DatosCorreoReserva) {
  return armar('reserva_confirmada_comensal', d, {
    datos_reserva: bloqueDatos([
      ...datosDelPlan(d),
      // Es el unico correo que le llega al comensal al pagar: tiene que
      // servirle de comprobante. Solo si pago algo.
      { etiqueta: 'Pagado', valor: d.pagado ? esc(dinero(d.pagado)) : '' },
    ]),
  });
}

export type PagoDeLaCancelacion = {
  /** Lo que se devuelve. Sin valor cuando no se sabe, y entonces no se dice nada. */
  reembolso?: number;
  /** Quien cancela es el anfitrion, no el comensal ni su canal. */
  porAnfitrion?: boolean;
};

/**
 * Lo que le pasa al dinero, en las palabras que se le dicen al comensal.
 *
 * Son tres textos y no se improvisan otros. Cuando cancela el anfitrion no
 * existe "sin reembolso": el comensal no hizo nada, de modo que si no hay un
 * reembolso registrado queda como pendiente de gestion por el anfitrion.
 * null cuando no hay nada que decir: no se pago nada, o no se sabe.
 */
export function textoDeReembolso(d: DatosCorreoReserva, pago?: PagoDeLaCancelacion): string | null {
  if (!pago || pago.reembolso === undefined) return null;

  if (pago.reembolso > 0) {
    return `Se registró un reembolso por ${dinero(pago.reembolso)}. El tiempo en que veas reflejado el dinero depende del canal y medio de pago utilizado.`;
  }
  // Sin dinero de por medio no hay nada que contar.
  if (!(d.pagado && d.pagado > 0)) return null;

  return pago.porAnfitrion
    ? `El reembolso correspondiente está pendiente de gestión por ${d.empresaNombre}.`
    : 'De acuerdo con las condiciones aplicables a esta reserva, no se registró un reembolso.';
}

const bloqueSobreTuPago = (texto: string | null) =>
  texto
    ? `<p style="margin-top:20px;"><strong>Sobre tu pago</strong></p><p>${esc(texto)}</p>`
    : '';

/**
 * Al comensal cuando se cancela su reserva entera.
 *
 * Dos plantillas distintas segun quien cancela: si fue el comensal o su canal,
 * se le confirma lo que pidio; si fue el anfitrion, se le dice quien y que no es
 * culpa suya.
 */
export function correoCanceladaComensal(
  d: DatosCorreoReserva,
  motivo?: string,
  pago?: PagoDeLaCancelacion,
) {
  const porAnfitrion = pago?.porAnfitrion === true;
  return armar(porAnfitrion ? 'reserva_cancelada_por_anfitrion' : 'reserva_cancelada_comensal', d, {
    motivo: motivo ?? '',
    datos_reserva: bloqueDatos([...datosDelPlan(d), { etiqueta: 'Motivo', valor: esc(motivo ?? '') }]),
    sobre_tu_pago: bloqueSobreTuPago(textoDeReembolso(d, pago)),
  });
}

/**
 * Al anfitrion cuando le cancelan.
 *
 * No estaba en la lista de correos pedida, pero una cancelacion le libera
 * cupo y le quita ingreso: enterarse al dia siguiente entrando al panel es
 * tarde para revender esa mesa.
 */
export function correoCanceladaAnfitrion(
  d: DatosCorreoReserva,
  motivo?: string,
  pago?: PagoDeLaCancelacion,
) {
  return armar('reserva_cancelada_anfitrion', d, {
    motivo: motivo ?? '',
    datos_reserva: bloqueDatos([
      ...datosDelPlan(d),
      { etiqueta: 'Motivo', valor: esc(motivo ?? '') },
      { etiqueta: 'Resultado económico', valor: esc(textoDeReembolso(d, pago) ?? '') },
    ]),
  });
}

/**
 * Al comensal cuando se cae parte de su grupo (TR-07).
 *
 * Distinto de la cancelacion entera a proposito: la reserva sigue en pie y lo
 * que tiene que quedar claro es con cuanta gente. Un correo de "reserva
 * cancelada" cuando siguen viniendo ocho personas haria que nadie apareciera.
 */
export function correoBajaParcialComensal(
  d: DatosCorreoReserva,
  personasQueSeCaen: number,
  motivo?: string,
  pago?: PagoDeLaCancelacion,
) {
  return armar('baja_parcial_comensal', d, {
    personas_que_se_caen: personas(personasQueSeCaen),
    motivo: motivo ?? '',
    datos_reserva: bloqueDatos([...datosDelPlan(d), { etiqueta: 'Motivo', valor: esc(motivo ?? '') }]),
    sobre_tu_pago: bloqueSobreTuPago(textoDeReembolso(d, pago)),
  });
}

/** Al anfitrion: se cayo parte del grupo y esos cupos vuelven a estar libres. */
export function correoBajaParcialAnfitrion(
  d: DatosCorreoReserva,
  personasQueSeCaen: number,
  motivo?: string,
) {
  return armar('baja_parcial_anfitrion', d, {
    personas_que_se_caen: personas(personasQueSeCaen),
    motivo: motivo ?? '',
    datos_reserva: bloqueDatos([...datosDelPlan(d), { etiqueta: 'Motivo', valor: esc(motivo ?? '') }]),
  });
}

/**
 * Al comensal cuando cambia algo de su reserva (TR-48).
 *
 * Se le dice QUE cambio, no solo que cambio algo: un correo que dice "tu
 * reserva fue modificada" obliga a abrir la ficha para averiguar si hay que
 * hacer algo, y la mayoria no la abre.
 */
export function correoCambioEnLaReserva(d: DatosCorreoReserva, cambios: string[]) {
  return armar('reserva_modificada_comensal', d, {
    cambios: `<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#374151">
          ${cambios.map((c) => `<li style="margin-bottom:4px">${esc(c)}</li>`).join('')}
        </ul>`,
    datos_reserva: bloqueDatos(datosDelPlan(d)),
  });
}

/**
 * Al comensal, despues de la experiencia: que la califique (TR-24).
 *
 * Se manda solo si aparecio: pedirle una opinion a quien no vino es la mejor
 * forma de recordarle que pago algo que no uso.
 *
 * El enlace lleva un token opaco porque va por correo y los correos se
 * reenvian. Nada de pedir cuenta: quien cena no tiene por que registrarse
 * para decir si le gusto.
 */
export function correoCalificacionComensal(d: DatosCorreoReserva, enlace: string) {
  return armar(
    'calificacion_comensal',
    d,
    {
      datos_reserva: bloqueDatos([
        { etiqueta: 'Experiencia', valor: esc(d.experienceTitle) },
        { etiqueta: 'Fecha', valor: esc(fechaLarga(d.reservationDate)) },
      ]),
    },
    enlace,
  );
}

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

export function correoPagoAnfitrion(d: DatosCorreoReserva) {
  return armar('pago_recibido_anfitrion', d, {
    datos_reserva: bloqueDatos([
      { etiqueta: 'Monto', valor: d.total ? esc(dinero(d.total)) : '' },
      ...datosDelPlan(d),
      { etiqueta: 'Cliente', valor: esc(d.clienteNombre) },
    ]),
  });
}
