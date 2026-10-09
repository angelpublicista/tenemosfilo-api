// Lo que un asistente conectado por MCP puede hacer en FILO.
//
// Cada herramienta es un endpoint del API con nombre y explicacion. No hay
// logica propia: la herramienta llama al mismo endpoint que el panel, como el
// anfitrion que la autorizo, asi que las reglas —de quien es cada cosa, que
// se puede cancelar, que cuesta— son las mismas y viven en un solo sitio.
//
// Los esquemas de entrada son los del propio endpoint, importados: si un
// campo cambia alli, cambia aqui sin que nadie se acuerde.
//
// La lista es cerrada a proposito. Lo que no esta aqui un asistente no lo
// puede hacer aunque el anfitrion si pueda desde el panel: cambiar la
// pasarela de cobro, emitir llaves de API, tocar usuarios o los tokens de
// WhatsApp. Son cosas que no se le delegan a un modelo.
import type { ZodTypeAny } from 'zod';
import type { ApiScope } from '../../middleware/scope.js';
import {
  condicionesDeSedeSchema,
  createExperienceSchema,
  listExperiencesQuerySchema,
  updateExperienceSchema,
  updateStatusSchema as estadoDeExperienciaSchema,
} from '../experiences/experiences.schemas.js';
import {
  cancelSchema,
  cargoAdicionalSchema,
  createReservationSchema,
  listReservationsQuerySchema,
  reembolsoSchema,
  rescheduleSchema,
  updatePaymentStatusSchema,
  updateReservationSchema,
  updateStatusSchema as estadoDeReservaSchema,
} from '../reservations/reservations.schemas.js';
import {
  createAvailabilitySchema,
  listAvailabilitiesQuerySchema,
  updateAvailabilitySchema,
} from '../availabilities/availabilities.schemas.js';
import {
  createLocationSchema,
  listLocationsQuerySchema,
  updateLocationSchema,
} from '../locations/locations.schemas.js';
import { createMenuSchema, listMenusQuerySchema, updateMenuSchema } from '../menus/menus.schemas.js';
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from '../contacts/contacts.schemas.js';
import {
  createCrmCompanySchema,
  listCrmCompaniesQuerySchema,
  updateCrmCompanySchema,
} from '../crm-companies/crm-companies.schemas.js';
import {
  agendaQuerySchema,
  condicionDePagoSchema,
  crearPreReservaSchema,
  crearReservaSchema,
  crearSolicitudSchema,
  createOpportunitySchema,
  facturacionSchema,
  listOpportunitiesQuerySchema,
  perderSchema,
  registrarPagoSchema,
  updateOpportunitySchema,
} from '../opportunities/opportunities.schemas.js';
import {
  createQuoteSchema,
  listQuotesQuerySchema,
  updateQuoteStatusSchema,
} from '../quotes/quotes.schemas.js';
import { activitiesQuerySchema, statsQuerySchema } from '../dashboard/dashboard.schemas.js';

export type Herramienta = {
  nombre: string;
  descripcion: string;
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Ruta del API. Los `:algo` son argumentos obligatorios de la herramienta. */
  ruta: string;
  /**
   * El permiso que la conexion necesita. Se comprueba aqui y no en el API
   * porque muchos de estos endpoints solo miran el rol: sin esto, una
   * conexion aprobada «solo para consultar» podria escribir.
   */
  permiso: ApiScope;
  /** Filtros de la consulta: van como argumentos sueltos. */
  consulta?: ZodTypeAny;
  /** El cuerpo de la peticion: va en el argumento `datos`. */
  cuerpo?: ZodTypeAny;
  /** Borra o deshace algo que no se recupera con otra llamada. */
  destructiva?: boolean;
};

const leer = (
  nombre: string,
  ruta: string,
  permiso: ApiScope,
  descripcion: string,
  consulta?: ZodTypeAny,
): Herramienta => ({ nombre, descripcion, metodo: 'GET', ruta, permiso, consulta });

const escribir = (
  nombre: string,
  metodo: Herramienta['metodo'],
  ruta: string,
  permiso: ApiScope,
  descripcion: string,
  cuerpo?: ZodTypeAny,
  destructiva = false,
): Herramienta => ({ nombre, descripcion, metodo, ruta, permiso, cuerpo, destructiva });

export const HERRAMIENTAS: Herramienta[] = [
  // ── La empresa y sus numeros ──────────────────────────────────────────────
  leer(
    'ver_mi_empresa',
    '/companies/me',
    'companies:read',
    'Los datos de la empresa a la que está conectado este asistente. Empieza por aquí si no sabes de qué anfitrión se trata.',
  ),
  leer(
    'ver_estadisticas',
    '/dashboard/stats',
    'dashboard:read',
    'Resumen del negocio: reservas, ingresos y ocupación del periodo.',
    statsQuerySchema,
  ),
  leer(
    'ver_actividad_reciente',
    '/dashboard/recent-activities',
    'dashboard:read',
    'Lo último que ha pasado en la cuenta: reservas nuevas, pagos, cambios.',
    activitiesQuerySchema,
  ),

  // ── Experiencias ──────────────────────────────────────────────────────────
  leer(
    'listar_experiencias',
    '/experiences',
    'experiences:read',
    'Las experiencias del anfitrión, con precio, duración y estado. Úsala antes de hablar de precios o de qué se ofrece.',
    listExperiencesQuerySchema,
  ),
  leer(
    'ver_experiencia',
    '/experiences/:id',
    'experiences:read',
    'El detalle completo de una experiencia: descripción, qué incluye, precios y condiciones.',
  ),
  escribir(
    'crear_experiencia',
    'POST',
    '/experiences',
    'experiences:write',
    'Crea una experiencia nueva. Para venderla hay que publicarla después en una sede.',
    createExperienceSchema,
  ),
  escribir(
    'actualizar_experiencia',
    'PATCH',
    '/experiences/:id',
    'experiences:write',
    'Cambia datos de una experiencia. Solo se tocan los campos que mandes. Cambiar el precio afecta a las reservas nuevas, no a las ya hechas.',
    updateExperienceSchema,
  ),
  escribir(
    'cambiar_estado_de_experiencia',
    'PATCH',
    '/experiences/:id/status',
    'experiences:write',
    'Cambia el estado de una experiencia.',
    estadoDeExperienciaSchema,
  ),
  escribir(
    'eliminar_experiencia',
    'DELETE',
    '/experiences/:id',
    'experiences:write',
    'Elimina una experiencia. Confirma con el anfitrión antes: deja de poder venderse.',
    undefined,
    true,
  ),
  leer(
    'listar_publicaciones',
    '/catalogo/publicaciones',
    'experiences:read',
    'En qué sedes está publicada cada experiencia y con qué condiciones. Una experiencia solo se puede reservar donde está publicada.',
  ),
  escribir(
    'publicar_experiencia_en_sede',
    'PUT',
    '/catalogo/publicaciones/:experienceId/:locationId',
    'experiences:write',
    'Publica una experiencia en una sede, o cambia las condiciones con las que ya estaba publicada allí.',
    condicionesDeSedeSchema,
  ),
  escribir(
    'despublicar_experiencia_de_sede',
    'DELETE',
    '/catalogo/publicaciones/:experienceId/:locationId',
    'experiences:write',
    'Retira una experiencia de una sede: deja de poder reservarse allí.',
    undefined,
    true,
  ),

  // ── Disponibilidad ────────────────────────────────────────────────────────
  leer(
    'listar_disponibilidades',
    '/availabilities',
    'availabilities:read',
    'Los horarios en los que se puede reservar: patrón semanal, fechas sueltas y fechas bloqueadas.',
    listAvailabilitiesQuerySchema,
  ),
  leer(
    'ver_disponibilidad',
    '/availabilities/:id',
    'availabilities:read',
    'El detalle de una disponibilidad.',
  ),
  escribir(
    'crear_disponibilidad',
    'POST',
    '/availabilities',
    'availabilities:write',
    'Crea una disponibilidad para una experiencia.',
    createAvailabilitySchema,
  ),
  escribir(
    'actualizar_disponibilidad',
    'PATCH',
    '/availabilities/:id',
    'availabilities:write',
    'Cambia horarios, fechas sueltas o fechas bloqueadas de una disponibilidad. Las reservas ya hechas no se mueven.',
    updateAvailabilitySchema,
  ),
  escribir(
    'eliminar_disponibilidad',
    'DELETE',
    '/availabilities/:id',
    'availabilities:write',
    'Elimina una disponibilidad: esos horarios dejan de poder reservarse.',
    undefined,
    true,
  ),

  // ── Sedes ─────────────────────────────────────────────────────────────────
  leer('listar_sedes', '/locations', 'locations:read', 'Las sedes del anfitrión.', listLocationsQuerySchema),
  leer('ver_sede', '/locations/:id', 'locations:read', 'El detalle de una sede: dirección, aforo y horarios.'),
  escribir('crear_sede', 'POST', '/locations', 'locations:write', 'Crea una sede.', createLocationSchema),
  escribir(
    'actualizar_sede',
    'PATCH',
    '/locations/:id',
    'locations:write',
    'Cambia datos de una sede.',
    updateLocationSchema,
  ),
  escribir(
    'eliminar_sede',
    'DELETE',
    '/locations/:id',
    'locations:write',
    'Elimina una sede. Confirma antes: lo publicado allí deja de poder reservarse.',
    undefined,
    true,
  ),

  // ── Menus ─────────────────────────────────────────────────────────────────
  leer('listar_menus', '/menus', 'menus:read', 'Los menús del anfitrión.', listMenusQuerySchema),
  leer('ver_menu', '/menus/:id', 'menus:read', 'El detalle de un menú, con sus platos.'),
  escribir('crear_menu', 'POST', '/menus', 'menus:write', 'Crea un menú.', createMenuSchema),
  escribir('actualizar_menu', 'PATCH', '/menus/:id', 'menus:write', 'Cambia un menú.', updateMenuSchema),
  escribir('eliminar_menu', 'DELETE', '/menus/:id', 'menus:write', 'Elimina un menú.', undefined, true),

  // ── Reservas ──────────────────────────────────────────────────────────────
  leer(
    'listar_reservas',
    '/reservations',
    'reservations:read',
    'Las reservas del anfitrión. Filtra por fecha, estado o experiencia en vez de traerlas todas.',
    listReservationsQuerySchema,
  ),
  leer(
    'ver_reserva',
    '/reservations/:id',
    'reservations:read',
    'El detalle de una reserva: quién viene, cuántos, qué pagó y en qué estado está.',
  ),
  leer(
    'ver_historial_de_reserva',
    '/reservations/:id/historial',
    'reservations:read',
    'Todo lo que le ha pasado a una reserva, en orden: cambios de estado, pagos, reprogramaciones.',
  ),
  leer(
    'listar_reembolsos_de_reserva',
    '/reservations/:id/reembolsos',
    'reservations:read',
    'Los reembolsos registrados sobre una reserva.',
  ),
  escribir(
    'crear_reserva',
    'POST',
    '/reservations',
    'reservations:write',
    'Crea una reserva. Comprueba antes la disponibilidad: si no hay cupo, el API la rechaza.',
    createReservationSchema,
  ),
  escribir(
    'actualizar_reserva',
    'PATCH',
    '/reservations/:id',
    'reservations:write',
    'Cambia datos de una reserva: participantes, notas, datos del cliente.',
    updateReservationSchema,
  ),
  escribir(
    'cambiar_estado_de_reserva',
    'PATCH',
    '/reservations/:id/status',
    'reservations:write',
    'Cambia el estado de una reserva. Para cancelar usa cancelar_reserva.',
    estadoDeReservaSchema,
  ),
  escribir(
    'cambiar_estado_de_pago_de_reserva',
    'PATCH',
    '/reservations/:id/payment-status',
    'reservations:write',
    'Registra que una reserva se pagó por fuera de la pasarela, o corrige su estado de pago. No mueve dinero: solo deja constancia. Confirma con el anfitrión antes.',
    updatePaymentStatusSchema,
  ),
  escribir(
    'reprogramar_reserva',
    'POST',
    '/reservations/:id/reschedule',
    'reservations:write',
    'Mueve una reserva a otra fecha u hora.',
    rescheduleSchema,
  ),
  escribir(
    'cancelar_reserva',
    'POST',
    '/reservations/:id/cancel',
    'reservations:write',
    'Cancela una reserva. Confirma con el anfitrión antes.',
    cancelSchema,
    true,
  ),
  escribir(
    'registrar_reembolso_de_reserva',
    'POST',
    '/reservations/:id/reembolsos',
    'reservations:write',
    'Deja registrado un reembolso que el anfitrión le debe al cliente. No devuelve el dinero: eso se hace desde la pasarela. Confirma antes.',
    reembolsoSchema,
    true,
  ),
  escribir(
    'agregar_cargo_a_reserva',
    'POST',
    '/reservations/:id/cargos',
    'reservations:write',
    'Suma un cargo adicional a una reserva (una botella, un servicio extra).',
    cargoAdicionalSchema,
  ),

  // ── CRM: contactos y empresas ─────────────────────────────────────────────
  leer('listar_contactos', '/contacts', 'contacts:read', 'Los contactos del CRM.', listContactsQuerySchema),
  leer('ver_contacto', '/contacts/:id', 'contacts:read', 'El detalle de un contacto.'),
  escribir('crear_contacto', 'POST', '/contacts', 'contacts:write', 'Crea un contacto en el CRM.', createContactSchema),
  escribir(
    'actualizar_contacto',
    'PATCH',
    '/contacts/:id',
    'contacts:write',
    'Cambia datos de un contacto.',
    updateContactSchema,
  ),
  escribir(
    'eliminar_contacto',
    'DELETE',
    '/contacts/:id',
    'contacts:write',
    'Elimina un contacto del CRM.',
    undefined,
    true,
  ),
  leer(
    'listar_empresas_cliente',
    '/crm-companies',
    'crm-companies:read',
    'Las empresas cliente del CRM: a quién le vende el anfitrión eventos corporativos.',
    listCrmCompaniesQuerySchema,
  ),
  leer('ver_empresa_cliente', '/crm-companies/:id', 'crm-companies:read', 'El detalle de una empresa cliente.'),
  escribir(
    'crear_empresa_cliente',
    'POST',
    '/crm-companies',
    'crm-companies:write',
    'Crea una empresa cliente en el CRM.',
    createCrmCompanySchema,
  ),
  escribir(
    'actualizar_empresa_cliente',
    'PATCH',
    '/crm-companies/:id',
    'crm-companies:write',
    'Cambia datos de una empresa cliente.',
    updateCrmCompanySchema,
  ),
  escribir(
    'eliminar_empresa_cliente',
    'DELETE',
    '/crm-companies/:id',
    'crm-companies:write',
    'Elimina una empresa cliente del CRM.',
    undefined,
    true,
  ),

  // ── CRM: oportunidades ────────────────────────────────────────────────────
  leer(
    'listar_oportunidades',
    '/opportunities',
    'opportunities:read',
    'Las oportunidades de venta del CRM, con su etapa y valor.',
    listOpportunitiesQuerySchema,
  ),
  leer('ver_oportunidad', '/opportunities/:id', 'opportunities:read', 'El detalle de una oportunidad.'),
  leer(
    'ver_agenda_de_ventas',
    '/opportunities/agenda',
    'opportunities:read',
    'Qué hay vendido o en negociación en un rango de fechas: sirve para ver choques antes de ofrecer una fecha.',
    agendaQuerySchema,
  ),
  leer(
    'ver_pendientes_del_crm',
    '/crm-panel/pendientes',
    'opportunities:read',
    'Lo que el anfitrión tiene pendiente hoy en el CRM: seguimientos, propuestas sin respuesta, experiencias por cerrar.',
  ),
  leer(
    'ver_indicadores_del_crm',
    '/crm-panel/indicadores',
    'opportunities:read',
    'Indicadores del embudo de ventas.',
  ),
  escribir(
    'crear_solicitud',
    'POST',
    '/opportunities/solicitud',
    'opportunities:write',
    'Registra a alguien interesado como solicitud en el CRM. Es la forma normal de abrir una oportunidad: basta con quién es y si quiere una experiencia abierta o privada.',
    crearSolicitudSchema,
  ),
  escribir(
    'crear_oportunidad',
    'POST',
    '/opportunities',
    'opportunities:write',
    'Crea una oportunidad con todos sus campos. Para el caso normal usa crear_solicitud, que pide menos.',
    createOpportunitySchema,
  ),
  escribir(
    'actualizar_oportunidad',
    'PATCH',
    '/opportunities/:id',
    'opportunities:write',
    'Cambia datos de una oportunidad: etapa, valor, notas, fecha esperada.',
    updateOpportunitySchema,
  ),
  escribir(
    'eliminar_oportunidad',
    'DELETE',
    '/opportunities/:id',
    'opportunities:write',
    'Elimina una oportunidad.',
    undefined,
    true,
  ),
  escribir(
    'marcar_propuesta_enviada',
    'POST',
    '/opportunities/:id/propuesta-enviada',
    'opportunities:write',
    'Deja constancia de que la propuesta ya se le envió al cliente, aunque haya salido por fuera de FILO.',
  ),
  escribir(
    'generar_enlace_de_reserva',
    'POST',
    '/opportunities/:id/enlace-de-reserva',
    'opportunities:write',
    'Genera el enlace para que el cliente de una oportunidad reserve y pague él mismo, con sus datos ya puestos.',
  ),
  escribir(
    'crear_pre_reserva_de_oportunidad',
    'POST',
    '/opportunities/:id/pre-reserva',
    'opportunities:write',
    'Aparta fecha y cupo para una oportunidad mientras el cliente decide.',
    crearPreReservaSchema,
  ),
  escribir(
    'crear_reserva_de_oportunidad',
    'POST',
    '/opportunities/:id/reserva',
    'opportunities:write',
    'Crea la reserva de una oportunidad ya acordada.',
    crearReservaSchema,
  ),
  escribir(
    'definir_condicion_de_pago',
    'POST',
    '/opportunities/:id/condicion-de-pago',
    'opportunities:write',
    'Define cómo va a pagar el cliente de una oportunidad.',
    condicionDePagoSchema,
  ),
  escribir(
    'registrar_pago_de_oportunidad',
    'POST',
    '/opportunities/:id/pago',
    'opportunities:write',
    'Registra un pago recibido por fuera de la pasarela. No mueve dinero: deja constancia. Confirma con el anfitrión antes.',
    registrarPagoSchema,
  ),
  escribir(
    'confirmar_venta',
    'POST',
    '/opportunities/:id/confirmar-venta',
    'opportunities:write',
    'Confirma la venta de una oportunidad. El API la rechaza si no se cumplen las condiciones acordadas.',
  ),
  escribir(
    'cerrar_oportunidad_ganada',
    'POST',
    '/opportunities/:id/cerrar-ganada',
    'opportunities:write',
    'Cierra una oportunidad como ganada.',
  ),
  escribir(
    'marcar_oportunidad_perdida',
    'POST',
    '/opportunities/:id/perder',
    'opportunities:write',
    'Cierra una oportunidad como perdida, con el motivo.',
    perderSchema,
  ),
  leer(
    'ver_facturacion_de_oportunidad',
    '/opportunities/:id/facturacion',
    'opportunities:read',
    'Los datos de facturación del cliente de una oportunidad.',
  ),
  escribir(
    'guardar_facturacion_de_oportunidad',
    'PUT',
    '/opportunities/:id/facturacion',
    'opportunities:write',
    'Guarda los datos de facturación del cliente de una oportunidad.',
    facturacionSchema,
  ),

  // ── Cotizaciones ──────────────────────────────────────────────────────────
  leer(
    'listar_cotizaciones',
    '/quotes',
    'quotes:read',
    'Las cotizaciones enviadas o en borrador.',
    listQuotesQuerySchema,
  ),
  leer(
    'ver_cotizaciones_de_oportunidad',
    '/quotes/por-oportunidad/:id',
    'quotes:read',
    'Las cotizaciones de una oportunidad. El id es el de la oportunidad.',
  ),
  escribir(
    'crear_cotizacion',
    'POST',
    '/quotes',
    'quotes:write',
    'Crea una cotización para un cliente.',
    createQuoteSchema,
  ),
  escribir(
    'marcar_cotizacion_enviada',
    'POST',
    '/quotes/:id/enviada',
    'quotes:write',
    'Deja constancia de que una cotización ya se le envió al cliente.',
  ),
  escribir(
    'cambiar_estado_de_cotizacion',
    'PATCH',
    '/quotes/:id/status',
    'quotes:write',
    'Cambia el estado de una cotización.',
    updateQuoteStatusSchema,
  ),
];

/** Los `:algo` de una ruta, en orden. */
export const parametrosDeRuta = (ruta: string): string[] =>
  [...ruta.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
