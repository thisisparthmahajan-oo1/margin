import type { ApiError } from '@margin/shared';
import { handleUnauthorized, sessionToken } from './auth.ts';
import { API_BASE } from './config.ts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, err?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
