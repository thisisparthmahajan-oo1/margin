import type { ApiError } from '@margin/shared';
import { appSettings } from './settings.ts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server base URL. Empty = same origin (dev proxy / Vercel). The Android build bakes in the hosted URL. */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

/** Token baked in at build time (Android); a token entered in Settings takes precedence. */
const BUILD_TOKEN = (import.meta.env.VITE_APP_TOKEN as string | undefined) ?? '';

export const apiToken = () => appSettings.get().apiToken || BUILD_TOKEN;

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = apiToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, err?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
