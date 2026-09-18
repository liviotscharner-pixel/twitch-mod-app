import crypto from 'crypto';

export function generateCodeVerifier(): string {
  return base64Url(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64Url(hash);
}

export function generateState(): string {
  return base64Url(crypto.randomBytes(16));
}

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
