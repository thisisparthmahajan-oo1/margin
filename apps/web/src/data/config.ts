/** Server base URL. Empty = same origin (dev proxy / Vercel). The Android build bakes in the hosted URL. */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
