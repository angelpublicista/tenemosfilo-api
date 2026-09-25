import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';

/**
 * El responsable, con lo justo para enseñarlo.
 *
 * Viaja con la sede para que el panel pueda pintar "María Pérez — Reservas —
 * 310 ..." sin una segunda consulta por cada sede. El correo no va: esta
 * pantalla enseña nombre, cargo y telefono, y lo que no se usa no se manda.
 */
/** Un salon validado, listo para Prisma. */
function aSalon(r: {
  name: string;
  description?: string;
  maxCapacity: number;
  photos?: string[];
  isActive?: boolean;
}) {
  return {
    name: r.name,
    description: r.description ?? null,
    maxCapacity: r.maxCapacity,
    photos: r.photos ?? [],
    isActive: r.isActive ?? true,
  };
}

/** Los salones, en el orden en que se crearon. */
const SALONES = { orderBy: { createdAt: 'asc' } } as const;

const RESPONSABLE = {
  select: { id: true, name: true, type: true, label: true, phone: true, position: true },
} as const;
import type {
  CreateLocationInput,
  ListLocationsQuery,
  UpdateLocationInput,
} from './locations.schemas.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function uniqueSlug(companyId: string, base: string, ignoreId?: string) {
  const baseSlug = slugify(base) || 'sede';
  let candidate = baseSlug;
  let i = 1;
  while (true) {
    const exists = await prisma.location.findFirst({
      where: { companyId, slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

async function assertCanManage(locationId: string, requesterCompanyId: string | null | undefined) {
  const loc = await prisma.location.findFirst({
    where: { id: locationId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!loc) throw NotFound('Sede no encontrada');
  if (!requesterCompanyId || loc.companyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre esta sede');
  }
  return loc;
}

/**
 * Que el responsable sea un contacto de ESTA empresa.
 *
 * Sin esto bastaria acertar un id para colgarle a una sede propia el
 * responsable de otra empresa, y con el saldrian su nombre y su telefono en
 * la ficha. El id es adivinable de sobra para no comprobarlo.
 */
async function asegurarContactoDeLaEmpresa(
  contactId: string | null | undefined,
  companyId: string,
) {
  if (!contactId) return;
  const contacto = await prisma.companyContact.findFirst({
    where: { id: contactId, companyId },
    select: { id: true },
  });
  if (!contacto) throw BadRequest('El responsable no es un contacto de esta empresa');
}

export const locationsService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateLocationInput) {
    const companyId = input.companyId ?? requesterCompanyId;
    if (!companyId) throw Forbidden('No tienes una company asociada');
    if (input.companyId && input.companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear sedes en otra company');
    }

    await asegurarContactoDeLaEmpresa(input.responsibleContactId, companyId);

    const slug = await uniqueSlug(companyId, input.name);

    return prisma.location.create({
      data: {
        companyId,
        name: input.name,
        slug,
        isMain: input.isMain ?? false,
        description: input.description ?? null,
        address: (input.address as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        contactInfo: (input.contactInfo as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        maxCapacity: input.maxCapacity,
        responsibleContactId: input.responsibleContactId ?? null,
        photos: input.photos ?? [],
        videoUrl: input.videoUrl ?? null,
        hasRooms: input.hasRooms ?? null,
        amenities: input.amenities ?? [],
        // Sin la casilla de audiovisuales, la frase no describe nada.
        avEquipmentDetail: input.amenities?.includes('audiovisuales')
          ? (input.avEquipmentDetail ?? null)
          : null,
        bathroomsCount: input.bathroomsCount ?? null,
        importantInfo: input.importantInfo ?? null,
        openingHours: (input.openingHours as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        ...(input.rooms?.length ? { rooms: { create: input.rooms.map(aSalon) } } : {}),
        isPublic: input.isPublic ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        isActive: input.isActive ?? true,
      },
      include: { responsibleContact: RESPONSABLE, rooms: SALONES },
    });
  },

  async getById(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;
    const loc = await prisma.location.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(crossCompany ? { isActive: true } : {}),
      },
    });
    if (!loc) throw NotFound('Sede no encontrada');
    if (!crossCompany) {
      if (!requesterCompanyId || loc.companyId !== requesterCompanyId) {
        throw NotFound('Sede no encontrada');
      }
    }
    return loc;
  },

  async list(
    requesterCompanyId: string | null | undefined,
    query: ListLocationsQuery,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;

    if (crossCompany) {
      return prisma.location.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(query.companyId ? { companyId: query.companyId } : {}),
        },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      });
    }

    const companyId = query.companyId ?? requesterCompanyId;
    if (!companyId) return [];
    if (query.companyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las sedes de otra company');
    }
    return prisma.location.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      include: { responsibleContact: RESPONSABLE, rooms: SALONES },
    });
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateLocationInput) {
    const existing = await assertCanManage(id, requesterCompanyId);

    const data: Prisma.LocationUpdateInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
      data.slug = await uniqueSlug(existing.companyId, input.name, id);
    }
    if (input.isMain !== undefined) data.isMain = input.isMain;
    if (input.description !== undefined) data.description = input.description;
    if (input.address !== undefined)
      data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.contactInfo !== undefined)
      data.contactInfo = (input.contactInfo as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.maxCapacity !== undefined) data.maxCapacity = input.maxCapacity;
    if (input.isPublic !== undefined) data.isPublic = input.isPublic;
    if (input.responsibleContactId !== undefined) {
      await asegurarContactoDeLaEmpresa(input.responsibleContactId, existing.companyId);
      // Por la relacion y no por el id suelto: `data` es un LocationUpdateInput
      // y ahi el vinculo se expresa conectando o soltando, no asignando.
      data.responsibleContact = input.responsibleContactId
        ? { connect: { id: input.responsibleContactId } }
        : { disconnect: true };
    }
    if (input.hasRooms !== undefined) data.hasRooms = input.hasRooms;
    if (input.amenities !== undefined) data.amenities = input.amenities;
    if (input.avEquipmentDetail !== undefined) data.avEquipmentDetail = input.avEquipmentDetail;
    if (input.bathroomsCount !== undefined) data.bathroomsCount = input.bathroomsCount;
    if (input.importantInfo !== undefined) data.importantInfo = input.importantInfo;
    if (input.openingHours !== undefined)
      data.openingHours = (input.openingHours as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    // Si se quita la casilla de audiovisuales, la frase se va con ella: dejarla
    // guardada describiria unos equipos que la sede ya no dice tener.
    if (input.amenities !== undefined && !input.amenities.includes('audiovisuales')) {
      data.avEquipmentDetail = null;
    }
    if (input.rooms !== undefined) {
      // Se concilia contra lo que hay: los que ya existen conservan su id. Es
      // la misma leccion que los contactos de la empresa —borrar y recrear es
      // mas corto y rompe cualquier referencia—.
      const siguen = input.rooms.filter((r) => r.id).map((r) => r.id as string);
      data.rooms = {
        deleteMany: siguen.length ? { id: { notIn: siguen } } : {},
        update: input.rooms
          .filter((r) => r.id)
          .map((r) => ({ where: { id: r.id as string }, data: aSalon(r) })),
        create: input.rooms.filter((r) => !r.id).map(aSalon),
      };
    }
    if (input.photos !== undefined) data.photos = input.photos;
    if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return prisma.location.update({
      where: { id },
      data,
      include: { responsibleContact: RESPONSABLE, rooms: SALONES },
    });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.location.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async setMain(id: string, requesterCompanyId: string | null | undefined) {
    const loc = await assertCanManage(id, requesterCompanyId);
    return prisma.$transaction([
      prisma.location.updateMany({
        where: { companyId: loc.companyId, isMain: true, deletedAt: null, NOT: { id } },
        data: { isMain: false },
      }),
      prisma.location.update({ where: { id }, data: { isMain: true } }),
    ]);
  },
};
