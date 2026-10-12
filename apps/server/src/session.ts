import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Device sessions: you enter APP_TOKEN once, the device gets a session valid for SESSION_TTL_MS and
 * stores only that. Format `<expiresAtMs>.<hmac>`, signed with APP_TOKEN, so the server keeps no
 * session state and changing APP_TOKEN signs every device out. (Same idea as personal-tracker's
 * `tracker_session` cookie.)
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

const sign = (appToken: string, expiresAt: number) =>
  createHmac('sha256', appToken).update(`margin-session:${expiresAt}`).digest('base64url');

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createSession(appToken: string, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  return { session: `${expiresAt}.${sign(appToken, expiresAt)}`, expiresAt };
}

export function isValidSession(appToken: string, session: string, now = Date.now()): boolean {
  const [exp, sig] = session.split('.');
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return safeEqual(sig, sign(appToken, expiresAt));
}
