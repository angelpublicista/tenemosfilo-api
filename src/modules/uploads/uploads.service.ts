import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden } from '../../lib/errors.js';
import { PREFIJO_PRIVADO, PREFIJO_PUBLICO, type PresignInput } from './uploads.schemas.js';

let s3: S3Client | null = null;
function getS3(): S3Client {
  if (!env.S3_BUCKET || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw BadRequest(
      'S3 no esta configurado. Define AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y S3_BUCKET en .env',
    );
  }
  if (!s3) {
    s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      // AWS SDK v3.730+ por defecto firma con x-amz-sdk-checksum-algorithm=CRC32,
      // lo cual rompe uploads desde el browser (no manda el header esperado).
      // Forzamos a calcular checksum solo cuando es estrictamente necesario.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3;
}

function publicBase(): string {
  if (env.S3_PUBLIC_URL_BASE) return env.S3_PUBLIC_URL_BASE.replace(/\/$/, '');
  return `https://${env.S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`;
}

function safeExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

/** Cuanto vive un enlace de lectura. Lo justo para abrir el documento. */
const LECTURA_EXPIRA_SEG = 300;

/**
 * Quien puede leer un documento privado.
 *
 * La clave lleva dentro el id de quien lo subio, pero no basta con comparar
 * eso: el documento se sube durante el alta, cuando la empresa todavia no
 * existe, y despues lo tiene que poder abrir tambien un socio de esa empresa o
 * un admin. Asi que se admite por tres vias, de la mas barata a la mas cara.
 */
async function puedeLeer(key: string, userId: string, role: string): Promise<boolean> {
  // Un admin opera empresas que no son suyas; es su trabajo.
  if (role === 'ADMIN') return true;

  // Quien lo subio. Evita ir a la base en el caso normal, que es este.
  if (key.includes(`/${userId}/`)) return true;

  // Si el documento ya quedo guardado en una empresa, vale con pertenecer a
  // ella. Cubre al socio que no fue quien lo subio.
  const empresa = await prisma.company.findFirst({
    where: {
      deletedAt: null,
      OR: [{ rutKey: key }, { camaraKey: key }],
    },
    select: { ownerId: true, users: { where: { id: userId }, select: { id: true } } },
  });
  if (!empresa) return false;
  return empresa.ownerId === userId || empresa.users.length > 0;
}

export const uploadsService = {
  async presign({
    userId,
    filename,
    contentType,
    scope,
    visibilidad,
  }: PresignInput & { userId: string }) {
    const ext = safeExt(filename);
    const ns = scope ?? 'misc';
    const esPrivado = visibilidad === 'privado';

    const prefijo = esPrivado ? PREFIJO_PRIVADO : PREFIJO_PUBLICO;
    const key = `${prefijo}/${ns}/${userId}/${randomUUID()}.${ext}`;

    const cmd = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      // ACL eliminado: usar bucket policy para lectura publica del prefijo /uploads
    });

    const uploadUrl = await getSignedUrl(getS3(), cmd, { expiresIn: 300 });

    return {
      uploadUrl,
      key,
      // Un fichero privado no tiene URL publica, y devolver uno que da 403
      // seria peor que no devolver nada: se guardaria en base de datos y
      // pareceria que funciona hasta que alguien lo abriera.
      publicUrl: esPrivado ? null : `${publicBase()}/${key}`,
      maxBytes: env.UPLOADS_MAX_BYTES,
      // El front debe usar exactamente este Content-Type al hacer PUT,
      // sino S3 rechaza la firma.
      contentType,
    };
  },

  /** Enlace temporal para abrir un documento privado. */
  async firmarLectura({ key, userId, role }: { key: string; userId: string; role: string }) {
    if (!(await puedeLeer(key, userId, role))) {
      throw Forbidden('No tienes permiso sobre este documento');
    }

    const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
    const url = await getSignedUrl(getS3(), cmd, { expiresIn: LECTURA_EXPIRA_SEG });

    return { url, expiraEnSeg: LECTURA_EXPIRA_SEG };
  },
};
