import type { ChannelType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { adaptadorDe, canalesDisponibles } from './channels.adapters.js';
import type { MarcarPublicadaInput } from './channels.schemas.js';

/** Campos que necesita cualquier adaptador para armar su ficha. */
const seleccionExperiencia = {
  id: true,
  title: true,
  slug: true,
  description: true,
  categories: true,
  duration: true,
  capacity: true,
  minCapacity: true,
  basePrice: true,
  currency: true,
  featuredImage: true,
  status: true,
  presentialCity: true,
  presentialAddress: true,
  includes: true,
  requirements: true,
  company: {
    select: {
      companyName: true,
      openTableRid: true,
      companyPhone: true,
      companyEmail: true,
    },
  },
} as const;

export const channelsService = {
  /** Los canales que la plataforma sabe alimentar, con sus instrucciones. */
  catalogo() {
    return canalesDisponibles().map((a) => ({
      channel: a.tipo,
      nombre: a.nombre,
      modo: a.modo,
      urlBackoffice: a.urlBackoffice,
      instrucciones: a.instrucciones,
    }));
  },

  /**
   * Estado de cada experiencia en cada canal.
   *
   * Devuelve todas las experiencias vivas de la empresa, tengan o no ficha:
   * el anfitrion necesita ver sobre todo las que aun no ha distribuido.
   */
  async resumen(companyId: string) {
    const [experiencias, listings] = await Promise.all([
      prisma.experience.findMany({
        where: { companyId, deletedAt: null },
        select: seleccionExperiencia,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.channelListing.findMany({
        where: { companyId, deletedAt: null },
      }),
    ]);

    const porExperiencia = new Map<string, typeof listings>();
    for (const l of listings) {
      const previas = porExperiencia.get(l.experienceId) ?? [];
      previas.push(l);
      porExperiencia.set(l.experienceId, previas);
    }

    return experiencias.map((exp) => ({
      id: exp.id,
      title: exp.title,
      status: exp.status,
      featuredImage: exp.featuredImage,
      canales: canalesDisponibles().map((a) => {
        const listing = porExperiencia.get(exp.id)?.find((l) => l.channel === a.tipo) ?? null;
        // Los faltantes se recalculan siempre: si el anfitrion edito la
        // experiencia, lo que faltaba ayer puede estar resuelto hoy.
        const { faltantes } = a.construirFicha(exp);
        return {
          channel: a.tipo,
          nombre: a.nombre,
          modo: a.modo,
          listo: faltantes.length === 0,
          faltantes: faltantes.length,
          status: listing?.status ?? null,
          externalUrl: listing?.externalUrl ?? null,
          publishedAt: listing?.publishedAt ?? null,
        };
      }),
    }));
  },

  /**
   * La ficha lista para cargar en el canal, con lo que falte por resolver.
   *
   * Se genera al vuelo desde la experiencia; no se guarda. Guardarla haria
   * que el canal mostrara datos viejos en cuanto se edite la experiencia.
   */
  async ficha(companyId: string, experienceId: string, canal: ChannelType) {
    const exp = await prisma.experience.findFirst({
      where: { id: experienceId, companyId, deletedAt: null },
      select: seleccionExperiencia,
    });
    if (!exp) throw NotFound('Experiencia no encontrada');

    const adaptador = adaptadorDe(canal);
    const { campos, faltantes } = adaptador.construirFicha(exp);

    const listing = await prisma.channelListing.findFirst({
      where: { experienceId, channel: canal, deletedAt: null },
    });

    return {
      experiencia: { id: exp.id, title: exp.title, status: exp.status },
      canal: {
        channel: adaptador.tipo,
        nombre: adaptador.nombre,
        modo: adaptador.modo,
        urlBackoffice: adaptador.urlBackoffice,
        instrucciones: adaptador.instrucciones,
      },
      campos,
      faltantes,
      listo: faltantes.length === 0,
      listing,
    };
  },

  /**
   * Deja constancia de que la experiencia ya esta publicada en el canal.
   *
   * Lo confirma el anfitrion porque el canal no nos lo puede decir: sin
   * API de partner no hay forma de comprobarlo desde aqui.
   */
  async marcarPublicada(
    companyId: string,
    experienceId: string,
    canal: ChannelType,
    input: MarcarPublicadaInput,
  ) {
    const exp = await prisma.experience.findFirst({
      where: { id: experienceId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!exp) throw NotFound('Experiencia no encontrada');

    const datos = {
      status: 'PUBLISHED' as const,
      externalUrl: input.externalUrl ?? null,
      externalId: input.externalId ?? null,
      notes: input.notes ?? null,
      publishedAt: new Date(),
      deletedAt: null,
    };

    return prisma.channelListing.upsert({
      where: { experienceId_channel: { experienceId, channel: canal } },
      update: datos,
      create: { companyId, experienceId, channel: canal, ...datos },
    });
  },

  /** La experiencia se retiro del canal. Se conserva el enlace por historial. */
  async despublicar(companyId: string, experienceId: string, canal: ChannelType) {
    const listing = await prisma.channelListing.findFirst({
      where: { experienceId, channel: canal, companyId, deletedAt: null },
    });
    if (!listing) throw NotFound('Esa experiencia no está publicada en ese canal');

    return prisma.channelListing.update({
      where: { id: listing.id },
      data: { status: 'UNPUBLISHED', publishedAt: null },
    });
  },
};
