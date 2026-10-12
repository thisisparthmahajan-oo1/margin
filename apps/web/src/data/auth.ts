import type { SessionResponse } from '@margin/shared';
import { useSyncExternalStore } from 'react';
import { API_BASE } from './config.ts';
import { appSettings } from './settings.ts';

/**
 * Sign-in on this device. The access token (the server's APP_TOKEN) is entered once and exchanged
 * for a session valid for 30 days; only the session is stored. When it expires or the server
 * rejects it, the app asks for the token again.
 */
export type AuthState =
  | { status: 'checking' }
  | { status: 'needs-sign-in'; reason: string | null }
  | { status: 'ready' };

const REASONS = {
  expired: 'It’s been 30 days since you signed in on this device. Enter your access token again.',
  rejected: 'This device was signed out (the access token may have changed). Enter your access token again.',
  offline: 'Can’t reach the server. Connect to the internet to sign in.',
};

let state: AuthState = { status: 'checking' };
const listeners = new Set<() => void>();
const signedInCallbacks = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
  if (next.status === 'ready') signedInCallbacks.forEach((cb) => cb());
}

export const useAuth = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

/** Runs `cb` every time this device becomes signed in (and right away if it already is). */
export function onSignedIn(cb: () => void) {
  signedInCallbacks.add(cb);
  if (state.status === 'ready') cb();
}

export const sessionToken = () => appSettings.get().session;

function clearSession(reason: string | null) {
  clearTimeout(expiryTimer);
  appSettings.set({ session: '', sessionExpiresAt: null });
  setState({ status: 'needs-sign-in', reason });
}

/** Signs out when the session runs out, even if the app stays open. */
function scheduleExpiry(expiresAt: number | null) {
  clearTimeout(expiryTimer);
  if (expiresAt === null) return;
  const ms = expiresAt - Date.now();
  if (ms <= 0x7fffffff) expiryTimer = setTimeout(() => clearSession(REASONS.expired), Math.max(0, ms));
}

/** Decides at launch whether to show the token screen. Opens instantly (and offline) with a live session. */
export async function initAuth() {
  const { session, sessionExpiresAt } = appSettings.get();
  if (session && sessionExpiresAt && sessionExpiresAt > Date.now()) {
    scheduleExpiry(sessionExpiresAt);
    setState({ status: 'ready' });
    return;
  }
  if (session) {
    clearSession(REASONS.expired);
    return;
  }
  // Never signed in: an open server (no APP_TOKEN, e.g. local dev) needs no token.
  try {
    const res = await fetch(`${API_BASE}/api/session`);
    if (res.ok) setState({ status: 'ready' });
    else setState({ status: 'needs-sign-in', reason: null });
  } catch {
    setState({ status: 'needs-sign-in', reason: REASONS.offline });
  }
}

/** Exchanges the access token for a session. Throws a user-facing message on failure. */
export async function signIn(token: string) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/session/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
  } catch {
    throw new Error(REASONS.offline);
  }
  if (res.status === 401) throw new Error('That token doesn’t match the server. Check it and try again.');
  if (!res.ok) throw new Error(`The server couldn’t sign you in (${res.status}). Try again in a moment.`);
  const { session, expiresAt } = (await res.json()) as SessionResponse;
  appSettings.set({ session: session ?? '', sessionExpiresAt: expiresAt });
  scheduleExpiry(expiresAt);
  setState({ status: 'ready' });
}

export const signOut = () => clearSession(null);

/** Called when the server rejects this device's credentials. */
export function handleUnauthorized() {
  if (state.status === 'ready') clearSession(REASONS.rejected);
}
