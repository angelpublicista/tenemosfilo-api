// Plantillas editables de los correos de reserva.
//
// Los textos por defecto son los que ya se mandaban; lo que cambia es que el
// administrador puede editarlos (ver plantillas-de-correo.ts). Lo que NO se
// edita: la maqueta —logo y color del anfitrion, cabecera, pie—, el destino del
// boton y las tablas de datos, que se arman en el codigo y entran al texto como
// variables ya construidas ({{datos_reserva}}).
import type {
  ContextoDeMarca,
  DefinicionDePlantilla,
  Maqueta,
  VariableDePlantilla,
} from './plantillas-de-correo.js';
import {
  AZUL,
  NARANJA,
  PANEL_ANFITRION,
  PANEL_COMENSAL,
  PANEL_INGRESOS,
  PIE_DEL_COMENSAL,
  ROJO,
  VERDE,
  bloqueDatos,
  boton,
  marco,
} from './email-marco.js';

/**
 * La maqueta de un correo de reserva. El color de la cabecera lo decide cada
 * plantilla: verde confirma, rojo cancela y azul avisa al equipo; solo lo que no
 * significa nada por si mismo toma el color de marca del anfitrion.
 */
const maquetaDe =
  (opts: { color: string | 'marca'; comensal?: boolean }): Maqueta =>
  ({ titulo, cuerpo, botonTexto, botonUrl, contexto }) => {
    const marca = contexto.colorMarca ?? NARANJA;
    return marco({
      titulo,
      color: opts.color === 'marca' ? marca : opts.color,
      logo: contexto.logo,
      empresa: contexto.empresa,
      pie: opts.comensal ? PIE_DEL_COMENSAL : undefined,
      contenido: cuerpo + (botonTexto.trim() ? boton(botonTexto, botonUrl, marca) : ''),
    });
  };

/** Contexto de ejemplo para la vista previa: sin logo y con el naranja de la plataforma. */
export const CONTEXTO_DE_EJEMPLO: ContextoDeMarca = { logo: null, empresa: 'Legado Cacao Experience', colorMarca: null };

// ── Variables ───────────────────────────────────────────────────────────────

const CLIENTE: VariableDePlantilla = {
  clave: 'cliente',
  descripcion: 'Nombre de quien reservó',
  ejemplo: 'Ana Gómez',
};
const EMPRESA: VariableDePlantilla = {
  clave: 'empresa',
  descripcion: 'Nombre del anfitrión que presta la experiencia',
  ejemplo: 'Legado Cacao Experience',
};
const EXPERIENCIA: VariableDePlantilla = {
  clave: 'experiencia',
  descripcion: 'Nombre de la experiencia reservada',
  ejemplo: 'Cata de cacao y chocolate',
};
const FECHA: VariableDePlantilla = {
  clave: 'fecha',
  descripcion: 'Fecha de la experiencia',
  ejemplo: 'sábado, 12 de diciembre de 2026',
};
const HORA: VariableDePlantilla = { clave: 'hora', descripcion: 'Hora de la experiencia', ejemplo: '3:00 p. m.' };
const PERSONAS: VariableDePlantilla = {
  clave: 'personas',
  descripcion: 'Cuántas personas, ya con la palabra',
  ejemplo: '4 personas',
};
const LUGAR: VariableDePlantilla = {
  clave: 'lugar',
  descripcion: 'Sede o dirección. Puede venir vacío',
  ejemplo: 'Sede Centro · Calle 10 # 5-20, Medellín',
};
const CODIGO: VariableDePlantilla = {
  clave: 'codigo',
  descripcion: 'Código de confirmación que se muestra al llegar',
  ejemplo: 'K7Q2XM',
};
const NUMERO: VariableDePlantilla = {
  clave: 'numero_reserva',
  descripcion: 'Número de reserva, la referencia para pagos y soporte',
  ejemplo: 'RES-20261212-A1B',
};
const TOTAL: VariableDePlantilla = {
  clave: 'total',
  descripcion: 'Valor total de la reserva. Puede venir vacío',
  ejemplo: '$240.000',
};
const MOTIVO: VariableDePlantilla = {
  clave: 'motivo',
  descripcion: 'Motivo que se dio. Puede venir vacío',
  ejemplo: 'Imprevisto del grupo',
};
const PERSONAS_QUE_SE_CAEN: VariableDePlantilla = {
  clave: 'personas_que_se_caen',
  descripcion: 'Cuántas personas se dan de baja, ya con la palabra',
  ejemplo: '2 personas',
};

const COMUNES = [CLIENTE, EMPRESA, EXPERIENCIA, FECHA, HORA, PERSONAS, LUGAR, CODIGO, NUMERO, TOTAL];

const MUESTRA_DE_DATOS = bloqueDatos([
  { etiqueta: 'Experiencia', valor: 'Cata de cacao y chocolate' },
  { etiqueta: 'Fecha', valor: 'sábado, 12 de diciembre de 2026, 3:00 p. m.' },
  { etiqueta: 'Personas', valor: '4 personas' },
  { etiqueta: 'Lugar', valor: 'Sede Centro · Calle 10 # 5-20, Medellín' },
  { etiqueta: 'Código', valor: 'K7Q2XM' },
  { etiqueta: 'N.º de reserva', valor: 'RES-20261212-A1B' },
]);

const DATOS_DE_RESERVA: VariableDePlantilla = {
  clave: 'datos_reserva',
  descripcion:
    'Tabla con los datos de la reserva (experiencia, fecha, personas, lugar, código…). La arma la plataforma; según el correo incluye más o menos filas',
  ejemplo: 'Tabla de datos de la reserva',
  html: true,
  muestra: MUESTRA_DE_DATOS,
};
const SOBRE_TU_PAGO: VariableDePlantilla = {
  clave: 'sobre_tu_pago',
  descripcion: 'Párrafo sobre el dinero (reembolso o pago pendiente). Queda vacío si no hay nada que decir',
  ejemplo: 'Se registró un reembolso por $240.000…',
  html: true,
  muestra:
    '<p style="margin-top:20px;"><strong>Sobre tu pago</strong></p><p>Se registró un reembolso por $240.000. El tiempo en que veas reflejado el dinero depende del canal y medio de pago utilizado.</p>',
};
const CAMBIOS: VariableDePlantilla = {
  clave: 'cambios',
  descripcion: 'Lista de lo que cambió en la reserva',
  ejemplo: 'Lista con los cambios',
  html: true,
  muestra:
    '<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#374151"><li style="margin-bottom:4px">La fecha pasó del 5 al 12 de diciembre</li><li style="margin-bottom:4px">Ahora son 4 personas</li></ul>',
};

const GRUPO = 'Reservas';

// ── Plantillas ──────────────────────────────────────────────────────────────

export const PLANTILLAS_DE_RESERVA = {
  reserva_nueva_anfitrion: {
    grupo: GRUPO,
    nombre: 'Reserva nueva · al anfitrión',
    descripcion: 'Aviso de una venta nueva, con los datos para contactar al cliente.',
    cuando: 'Cuando entra una reserva nueva. Llega al contacto de reservas de la empresa',
    variables: [...COMUNES, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_ANFITRION,
    maqueta: maquetaDe({ color: AZUL }),
    defecto: {
      subject: 'Nueva reserva: {{experiencia}} · {{fecha}}',
      title: 'Tienes una reserva nueva',
      body: `<p><strong>{{cliente}}</strong> reservó {{personas}} en {{experiencia}}.</p>
{{datos_reserva}}`,
      buttonText: 'Confirmar en el panel',
    },
  },
  reserva_nueva_admin: {
    grupo: GRUPO,
    nombre: 'Reserva nueva · a la plataforma',
    descripcion: 'Pulso de ventas para los administradores, sin el detalle operativo.',
    cuando: 'Cuando entra una reserva nueva. Llega a los administradores',
    variables: [...COMUNES, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_ANFITRION,
    maqueta: maquetaDe({ color: AZUL }),
    defecto: {
      subject: '[Filo] Reserva {{numero_reserva}} · {{empresa}}',
      title: 'Reserva nueva en la plataforma',
      body: `{{datos_reserva}}`,
      buttonText: 'Ver en el panel',
    },
  },
  reserva_confirmada_comensal: {
    grupo: GRUPO,
    nombre: 'Reserva confirmada · al comensal',
    descripcion: 'El comprobante que el comensal guarda: lleva lo pagado, si pagó algo.',
    cuando: 'Cuando la reserva queda confirmada (una sola vez)',
    variables: [...COMUNES, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: VERDE, comensal: true }),
    defecto: {
      subject: 'Tu reserva en {{experiencia}} está confirmada',
      title: '¡Tu reserva está confirmada!',
      body: `<p>Hola {{cliente}},</p>
<p>Tu reserva con <strong>{{empresa}}</strong> está confirmada.</p>
{{datos_reserva}}`,
      buttonText: 'Ver mi reserva',
    },
  },
  reserva_modificada_comensal: {
    grupo: GRUPO,
    nombre: 'Reserva modificada · al comensal',
    descripcion: 'Le cuenta QUÉ cambió: fecha, hora, lugar o cantidad de personas.',
    cuando: 'Cuando el anfitrión o el canal cambian algo importante de la reserva',
    variables: [...COMUNES, CAMBIOS, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: 'marca', comensal: true }),
    defecto: {
      subject: 'Tu reserva en {{experiencia}} fue actualizada',
      title: 'Cambió algo en tu reserva',
      body: `<p>Hola {{cliente}},</p>
<p>Tu reserva en <strong>{{empresa}}</strong> cambió:</p>
{{cambios}}
<p>Así queda:</p>
{{datos_reserva}}`,
      buttonText: 'Ver mis reservas',
    },
  },
  reserva_cancelada_comensal: {
    grupo: GRUPO,
    nombre: 'Reserva cancelada por el cliente · al comensal',
    descripcion: 'Confirma la cancelación que pidió el comensal o su canal, y qué pasó con su pago.',
    cuando: 'Cuando se cancela la reserva a pedido del comensal o del canal que la vendió',
    variables: [...COMUNES, MOTIVO, DATOS_DE_RESERVA, SOBRE_TU_PAGO],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: ROJO, comensal: true }),
    defecto: {
      subject: 'Tu reserva en {{experiencia}} fue cancelada',
      title: 'Tu reserva fue cancelada',
      body: `<p>Hola {{cliente}},</p>
<p>Confirmamos la cancelación de tu reserva en <strong>{{experiencia}}</strong> con <strong>{{empresa}}</strong>.</p>
{{datos_reserva}}
{{sobre_tu_pago}}`,
      buttonText: 'Ver mis reservas',
    },
  },
  reserva_cancelada_por_anfitrion: {
    grupo: GRUPO,
    nombre: 'Reserva cancelada por el anfitrión · al comensal',
    descripcion: 'Le dice quién canceló y que no es culpa suya; incluye el estado de su reembolso.',
    cuando: 'Cuando el anfitrión cancela la reserva desde su panel',
    variables: [...COMUNES, MOTIVO, DATOS_DE_RESERVA, SOBRE_TU_PAGO],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: ROJO, comensal: true }),
    defecto: {
      subject: 'Tu reserva en {{experiencia}} fue cancelada por {{empresa}}',
      title: 'Tu reserva fue cancelada',
      body: `<p>Hola {{cliente}},</p>
<p><strong>{{empresa}}</strong> canceló <strong>{{experiencia}}</strong> para la fecha indicada a continuación. Tu reserva quedó cancelada.</p>
{{datos_reserva}}
{{sobre_tu_pago}}`,
      buttonText: 'Ver mis reservas',
    },
  },
  reserva_cancelada_anfitrion: {
    grupo: GRUPO,
    nombre: 'Reserva cancelada · al anfitrión',
    descripcion: 'Le avisa que un cupo quedó libre para que pueda revenderlo.',
    cuando: 'Cuando cancela el comensal o el canal (no cuando cancela el propio anfitrión)',
    variables: [...COMUNES, MOTIVO, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_ANFITRION,
    maqueta: maquetaDe({ color: ROJO }),
    defecto: {
      subject: 'Cancelación de cliente: {{experiencia}} · {{fecha}}',
      title: 'Se canceló una reserva',
      body: `<p><strong>{{cliente}}</strong> ya no asiste. El cupo queda libre.</p>
{{datos_reserva}}`,
      buttonText: 'Ver reservas',
    },
  },
  baja_parcial_comensal: {
    grupo: GRUPO,
    nombre: 'Baja parcial del grupo · al comensal',
    descripcion: 'Una parte del grupo se cae pero la reserva sigue en pie con el resto.',
    cuando: 'Cuando se dan de baja algunas personas de la reserva, no todas',
    variables: [...COMUNES, PERSONAS_QUE_SE_CAEN, MOTIVO, DATOS_DE_RESERVA, SOBRE_TU_PAGO],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: 'marca', comensal: true }),
    defecto: {
      subject: 'Actualizamos tu reserva en {{experiencia}}',
      title: 'Tu reserva queda con menos personas',
      body: `<p>Hola {{cliente}},</p>
<p>Se dieron de baja <strong>{{personas_que_se_caen}}</strong> de tu reserva en <strong>{{empresa}}</strong>. El resto sigue en pie:</p>
{{datos_reserva}}
{{sobre_tu_pago}}`,
      buttonText: 'Ver mis reservas',
    },
  },
  baja_parcial_anfitrion: {
    grupo: GRUPO,
    nombre: 'Baja parcial del grupo · al anfitrión',
    descripcion: 'Le avisa que esos cupos vuelven a estar libres.',
    cuando: 'Cuando otro (no el anfitrión) da de baja a parte de un grupo',
    variables: [...COMUNES, PERSONAS_QUE_SE_CAEN, MOTIVO, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_ANFITRION,
    maqueta: maquetaDe({ color: ROJO }),
    defecto: {
      subject: 'Cancelación de cliente: {{experiencia}} · {{fecha}}',
      title: 'Se cayó parte de un grupo',
      body: `<p>La reserva de <strong>{{cliente}}</strong> baja {{personas_que_se_caen}}. Esos cupos quedan libres.</p>
{{datos_reserva}}`,
      buttonText: 'Ver reservas',
    },
  },
  calificacion_comensal: {
    grupo: GRUPO,
    nombre: 'Pedir calificación · al comensal',
    descripcion: 'Después de la experiencia, le pide calificarla. Solo si el comensal asistió.',
    cuando: 'Después de la experiencia, si el comensal asistió',
    variables: [...COMUNES, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_COMENSAL,
    maqueta: maquetaDe({ color: 'marca', comensal: true }),
    defecto: {
      subject: '¿Cómo fue tu experiencia en {{experiencia}}?',
      title: '¿Qué tal estuvo?',
      body: `<p>Hola {{cliente}},</p>
<p>Gracias por venir a <strong>{{experiencia}}</strong>. Si tienes un minuto, cuéntanos cómo estuvo: son cuatro estrellas y nada más que marcar.</p>
{{datos_reserva}}
<p style="font-size:13px;color:#6b7280;">No hace falta crear una cuenta ni escribir nada.</p>`,
      buttonText: 'Calificar',
    },
  },
  pago_recibido_anfitrion: {
    grupo: GRUPO,
    nombre: 'Pago recibido · al anfitrión',
    descripcion: 'Le avisa que entró un pago de una reserva.',
    cuando: 'Cuando se confirma un pago. Llega al contacto de contabilidad de la empresa',
    variables: [...COMUNES, DATOS_DE_RESERVA],
    urlDelBoton: () => PANEL_INGRESOS,
    maqueta: maquetaDe({ color: VERDE }),
    defecto: {
      subject: 'Pago recibido · {{numero_reserva}}',
      title: 'Entró un pago',
      body: `{{datos_reserva}}
<p style="font-size:13px;color:#6b7280;">Lo que te corresponde de esta venta lo ves en Ingresos, ya descontada la comisión.</p>`,
      buttonText: 'Ver ingresos',
    },
  },
} satisfies Record<string, DefinicionDePlantilla>;
