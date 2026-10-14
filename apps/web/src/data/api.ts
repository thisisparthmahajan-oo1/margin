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

/** The request never got a response: no network, or the server couldn't be reached. */
export class NetworkError extends Error {}

/** `fetch`, with "no response at all" told apart from every other failure. */
export async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  const res = await request(API_BASE + path, {
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
