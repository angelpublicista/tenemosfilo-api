import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { BadRequest } from '../../lib/errors.js';
import type { PresignInput } from './uploads.schemas.js';

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

export const uploadsService = {
  async presign({
    userId,
    filename,
    contentType,
    scope,
  }: PresignInput & { userId: string }) {
    const ext = safeExt(filename);
    const ns = scope ?? 'misc';
    const key = `uploads/${ns}/${userId}/${randomUUID()}.${ext}`;

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
      publicUrl: `${publicBase()}/${key}`,
      maxBytes: env.UPLOADS_MAX_BYTES,
      // El front debe usar exactamente este Content-Type al hacer PUT,
      // sino S3 rechaza la firma.
      contentType,
    };
  },
};
