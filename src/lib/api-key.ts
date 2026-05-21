import { createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX = 'tf_live_';
const RANDOM_BYTES = 32;
const PREFIX_SUFFIX_CHARS = 8;

export type GeneratedApiKey = {
  token: string;
  prefix: string;
  keyHash: string;
};

export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(RANDOM_BYTES).toString('base64url');
  const token = `${TOKEN_PREFIX}${random}`;
  return {
    token,
    prefix: `${TOKEN_PREFIX}${random.slice(0, PREFIX_SUFFIX_CHARS)}`,
    keyHash: hashApiKey(token),
  };
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}
