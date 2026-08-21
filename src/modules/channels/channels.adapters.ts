// Adaptadores de canal.
//
// Cada canal define que necesita para aceptar una experiencia y como se
// nombra alli. La forma de un canal es siempre la misma — reglas + ficha —
// para que añadir uno nuevo no obligue a tocar el servicio ni la pantalla.
//
// OPENTABLE va en modo asistido: su API de partner exige contrato firmado y
// no expone creacion de fichas, asi que lo que se puede automatizar hoy es
// preparar el contenido con sus reglas y que el anfitrion lo cargue en su
// back-office. El dia que exista el acuerdo, este adaptador gana un
// `publicar()` y la pantalla no cambia.
import type { ChannelType } from '@prisma/client';

/** Lo que hace falta antes de poder cargar la experiencia en el canal. */
export type Faltante = {
  campo: string;
  /** Que tiene que hacer el anfitrion, en sus palabras. */
  mensaje: string;
};

export type CampoFicha = {
  etiqueta: string;
  valor: string;
  /** Texto largo: la pantalla lo pinta en varias lineas. */
  multilinea?: boolean;
};

export type Ficha = {
  campos: CampoFicha[];
  faltantes: Faltante[];
};

/** Datos de la experiencia que necesita cualquier adaptador. */
export type ExperienciaParaCanal = {
  title: string;
  description: string | null;
  categories: string[];
  duration: number | null;
  capacity: number | null;
  minCapacity: number | null;
  basePrice: unknown;
  currency: string;
  featuredImage: string | null;
  presentialCity: string | null;
  presentialAddress: string | null;
  includes: unknown;
  requirements: string | null;
  company: {
    companyName: string;
    openTableRid: string | null;
    companyPhone: string | null;
    companyEmail: string | null;
  };
};

export type Adaptador = {
  tipo: ChannelType;
  nombre: string;
  /** Como se carga hoy: por API o a mano en el back-office del canal. */
  modo: 'API' | 'ASISTIDO';
  /** Que tiene que hacer el anfitrion, paso a paso. */
  instrucciones: string[];
  /** Enlace al sitio donde se carga. */
  urlBackoffice: string;
  construirFicha(exp: ExperienciaParaCanal): Ficha;
};

const money = (valor: unknown, moneda: string) => {
  const n = Number(valor ?? 0);
  if (!(n > 0)) return '';
  return `${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ${moneda}`;
};

/** `includes` es texto libre o lista, segun como se guardo la experiencia. */
function comoLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((v) => String(v)).filter(Boolean);
  if (typeof valor === 'string' && valor.trim()) {
    return valor
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

// OpenTable corta los titulos largos en su listado y exige descripcion con
// cuerpo; preparamos el contenido para que no lo rechacen ni lo trunquen.
const OPENTABLE_TITULO_MAX = 60;
const OPENTABLE_DESCRIPCION_MIN = 50;

const openTable: Adaptador = {
  tipo: 'OPENTABLE',
  nombre: 'OpenTable',
  modo: 'ASISTIDO',
  urlBackoffice: 'https://restaurant.opentable.com/',
  instrucciones: [
    'Entra a tu cuenta de OpenTable y abre Experiences.',
    'Crea una experiencia nueva y copia cada campo desde aquí.',
    'Publícala en OpenTable y vuelve a esta pantalla.',
    'Pega el enlace de la ficha publicada y márcala como publicada.',
  ],

  construirFicha(exp) {
    const faltantes: Faltante[] = [];

    if (!exp.company.openTableRid) {
      faltantes.push({
        campo: 'openTableRid',
        mensaje:
          'Vincula tu restaurante de OpenTable en Configuración para poder enlazar la ficha.',
      });
    }
    const descripcion = (exp.description ?? '').trim();
    if (descripcion.length < OPENTABLE_DESCRIPCION_MIN) {
      faltantes.push({
        campo: 'description',
        mensaje: `La descripción debe tener al menos ${OPENTABLE_DESCRIPCION_MIN} caracteres; ahora tiene ${descripcion.length}.`,
      });
    }
    if (!(Number(exp.basePrice ?? 0) > 0)) {
      faltantes.push({ campo: 'basePrice', mensaje: 'Ponle un precio por persona.' });
    }
    if (!exp.duration) {
      faltantes.push({ campo: 'duration', mensaje: 'Indica cuánto dura la experiencia.' });
    }
    if (!exp.capacity) {
      faltantes.push({ campo: 'capacity', mensaje: 'Indica el máximo de personas.' });
    }
    if (!exp.featuredImage) {
      faltantes.push({
        campo: 'featuredImage',
        mensaje: 'OpenTable no publica experiencias sin foto de portada.',
      });
    }
    if (!exp.presentialCity && !exp.presentialAddress) {
      faltantes.push({
        campo: 'presentialAddress',
        mensaje: 'Añade la dirección o al menos la ciudad donde ocurre.',
      });
    }

    const incluye = comoLista(exp.includes);
    const titulo = exp.title.trim();

    const campos: CampoFicha[] = [
      {
        etiqueta: 'Nombre de la experiencia',
        // Se recorta aqui en vez de dejar que lo haga OpenTable: asi el
        // anfitrion ve exactamente lo que va a quedar publicado.
        valor: titulo.length > OPENTABLE_TITULO_MAX
          ? `${titulo.slice(0, OPENTABLE_TITULO_MAX - 1).trimEnd()}…`
          : titulo,
      },
      { etiqueta: 'Descripción', valor: descripcion, multilinea: true },
      { etiqueta: 'Precio por persona', valor: money(exp.basePrice, exp.currency) },
      { etiqueta: 'Duración', valor: exp.duration ? `${exp.duration} minutos` : '' },
      {
        etiqueta: 'Personas',
        valor:
          exp.capacity
            ? `De ${exp.minCapacity ?? 1} a ${exp.capacity}`
            : '',
      },
      { etiqueta: 'Categorías', valor: exp.categories.join(', ') },
      {
        etiqueta: 'Dónde',
        valor: [exp.presentialAddress, exp.presentialCity].filter(Boolean).join(', '),
      },
      ...(incluye.length
        ? [{ etiqueta: 'Qué incluye', valor: incluye.map((i) => `• ${i}`).join('\n'), multilinea: true }]
        : []),
      ...(exp.requirements
        ? [{ etiqueta: 'Requisitos', valor: exp.requirements, multilinea: true }]
        : []),
      { etiqueta: 'Foto de portada', valor: exp.featuredImage ?? '' },
    ];

    return { campos, faltantes };
  },
};

const ADAPTADORES: Record<ChannelType, Adaptador> = {
  OPENTABLE: openTable,
};

export function adaptadorDe(canal: ChannelType): Adaptador {
  return ADAPTADORES[canal];
}

export function canalesDisponibles(): Adaptador[] {
  return Object.values(ADAPTADORES);
}
