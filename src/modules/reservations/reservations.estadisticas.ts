// Estadisticas del canal de un revendedor: interaccion en su catalogo y
// reservas que le ha generado.
//
// Dos fuentes distintas a proposito. Las reservas salen de la tabla de
// reservas (lo que de verdad se vendio); la interaccion sale de
// EventoDeCatalogo (lo que la gente hizo antes de reservar o en vez de
// reservar). Juntas dan el embudo.
import { prisma } from '../../config/prisma.js';
import { Forbidden } from '../../lib/errors.js';

const DIA = 24 * 60 * 60 * 1000;
/** Colombia no tiene horario de verano: UTC-5 todo el año. */
const DESFASE_COLOMBIA = 5 * 60 * 60 * 1000;
/** Tope de filas de eventos por consulta: protege la memoria, no el negocio. */
const TOPE_EVENTOS = 200_000;

/** La fecha civil en Colombia, "AAAA-MM-DD". Agrupa por el dia que vio el usuario. */
const diaColombia = (d: Date) => new Date(d.getTime() - DESFASE_COLOMBIA).toISOString().slice(0, 10);

export interface EstadisticasDeMiCanal {
  periodo: { desde: string; hasta: string };
  resumen: {
    visitas: number;
    reservas: number;
    canceladas: number;
    personas: number;
    comisionGenerada: number;
    ventasTotales: number;
    /** Reservas / visitas, en %. null si no hubo visitas medidas. */
    conversion: number | null;
  };
  embudo: Array<{ paso: string; sesiones: number }>;
  serie: Array<{ fecha: string; visitas: number; reservas: number; comision: number }>;
  porEstado: Array<{ estado: string; cantidad: number }>;
  topExperiencias: Array<{
    experienceId: string;
    titulo: string;
    vistas: number;
    reservas: number;
    comision: number;
  }>;
}

export async function estadisticasDeMiCanal(
  resellerCompanyId: string | null | undefined,
  query: { dateFrom?: string; dateTo?: string },
): Promise<EstadisticasDeMiCanal> {
  if (!resellerCompanyId) throw Forbidden('No tienes una company asociada');

  const hasta = query.dateTo ? new Date(query.dateTo) : new Date();
  const desdeBruto = query.dateFrom ? new Date(query.dateFrom) : new Date(hasta.getTime() - 29 * DIA);
  // Un año como maximo: mas que eso es una consulta que nadie va a leer.
  const desde = new Date(Math.max(desdeBruto.getTime(), hasta.getTime() - 366 * DIA));

  const rango = { gte: desde, lte: hasta };

  const [eventos, reservas] = await Promise.all([
    prisma.eventoDeCatalogo.findMany({
      where: { resellerCompanyId, createdAt: rango },
      select: { tipo: true, sessionId: true, experienceId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: TOPE_EVENTOS,
    }),
    // Por fecha de venta, no por la de la experiencia: aqui se mide cuando el
    // canal genero la reserva.
    prisma.reservation.findMany({
      where: { resellerCompanyId, createdAt: rango },
      select: {
        createdAt: true,
        status: true,
        participants: true,
        pricing: true,
        experienceId: true,
        experience: { select: { title: true } },
      },
    }),
  ]);

  // Sesiones distintas por paso del embudo. Una persona que mira cinco
  // experiencias cuenta una vez: se mide gente, no clics.
  const sesionesPor = (tipo: string) =>
    new Set(eventos.filter((e) => e.tipo === tipo).map((e) => e.sessionId));
  const visitas = sesionesPor('VISITA');
  const vieron = sesionesPor('VER_EXPERIENCIA');
  const eligieron = sesionesPor('ELEGIR_FECHA');
  const iniciaron = sesionesPor('INICIAR_RESERVA');

  const vigentes = reservas.filter((r) => r.status !== 'CANCELLED');
  const valor = (r: (typeof reservas)[number], campo: 'total' | 'resellerCommission') =>
    Number(((r.pricing ?? {}) as Record<string, unknown>)[campo] ?? 0);

  // Serie diaria con todos los dias del periodo, tambien los vacios: una
  // grafica que se salta los dias sin movimiento miente sobre el ritmo.
  const serieMapa = new Map<string, { visitas: number; reservas: number; comision: number }>();
  for (let t = desde.getTime(); t <= hasta.getTime(); t += DIA) {
    serieMapa.set(diaColombia(new Date(t)), { visitas: 0, reservas: 0, comision: 0 });
  }
  serieMapa.set(diaColombia(hasta), serieMapa.get(diaColombia(hasta)) ?? { visitas: 0, reservas: 0, comision: 0 });

  const vistasPorDia = new Map<string, Set<string>>();
  for (const e of eventos) {
    if (e.tipo !== 'VISITA') continue;
    const k = diaColombia(e.createdAt);
    if (!vistasPorDia.has(k)) vistasPorDia.set(k, new Set());
    vistasPorDia.get(k)!.add(e.sessionId);
  }
  for (const [k, set] of vistasPorDia) {
    const f = serieMapa.get(k);
    if (f) f.visitas = set.size;
  }
  for (const r of vigentes) {
    const f = serieMapa.get(diaColombia(r.createdAt));
    if (!f) continue;
    f.reservas += 1;
    f.comision += valor(r, 'resellerCommission');
  }

  const porEstadoMapa = new Map<string, number>();
  for (const r of reservas) porEstadoMapa.set(r.status, (porEstadoMapa.get(r.status) ?? 0) + 1);

  const tops = new Map<string, { titulo: string; vistas: Set<string>; reservas: number; comision: number }>();
  const fila = (id: string, titulo: string) => {
    if (!tops.has(id)) tops.set(id, { titulo, vistas: new Set(), reservas: 0, comision: 0 });
    return tops.get(id)!;
  };
  for (const r of vigentes) {
    const f = fila(r.experienceId, r.experience?.title ?? 'Experiencia');
    f.reservas += 1;
    f.comision += valor(r, 'resellerCommission');
  }
  const idsSinTitulo = new Set<string>();
  for (const e of eventos) {
    if (e.tipo !== 'VER_EXPERIENCIA' || !e.experienceId) continue;
    if (!tops.has(e.experienceId)) idsSinTitulo.add(e.experienceId);
    fila(e.experienceId, '').vistas.add(e.sessionId);
  }
  if (idsSinTitulo.size > 0) {
    const titulos = await prisma.experience.findMany({
      where: { id: { in: [...idsSinTitulo] } },
      select: { id: true, title: true },
    });
    for (const t of titulos) tops.get(t.id)!.titulo = t.title;
  }

  const reservasContadas = vigentes.length;
  return {
    periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    resumen: {
      visitas: visitas.size,
      reservas: reservasContadas,
      canceladas: reservas.length - reservasContadas,
      personas: vigentes.reduce((a, r) => a + r.participants, 0),
      comisionGenerada: vigentes.reduce((a, r) => a + valor(r, 'resellerCommission'), 0),
      ventasTotales: vigentes.reduce((a, r) => a + valor(r, 'total'), 0),
      conversion: visitas.size > 0 ? Math.round((reservasContadas / visitas.size) * 1000) / 10 : null,
    },
    embudo: [
      { paso: 'Visitaron tu catálogo', sesiones: visitas.size },
      { paso: 'Vieron una experiencia', sesiones: vieron.size },
      { paso: 'Eligieron fecha', sesiones: eligieron.size },
      { paso: 'Dejaron sus datos', sesiones: iniciaron.size },
      { paso: 'Reservaron', sesiones: reservasContadas },
    ],
    serie: [...serieMapa.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, v]) => ({ fecha, ...v })),
    porEstado: [...porEstadoMapa.entries()].map(([estado, cantidad]) => ({ estado, cantidad })),
    topExperiencias: [...tops.entries()]
      .map(([experienceId, t]) => ({
        experienceId,
        titulo: t.titulo || 'Experiencia',
        vistas: t.vistas.size,
        reservas: t.reservas,
        comision: t.comision,
      }))
      .sort((a, b) => b.reservas - a.reservas || b.vistas - a.vistas)
      .slice(0, 5),
  };
}
