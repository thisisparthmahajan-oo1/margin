import { describe, expect, it } from 'vitest';
import { createSession, isValidSession, SESSION_TTL_MS } from '../src/session.ts';

describe('device sessions', () => {
  it('are valid for 30 days and then expire', () => {
    const now = Date.UTC(2026, 9, 12);
    const { session, expiresAt } = createSession('secret', now);
    expect(expiresAt).toBe(now + SESSION_TTL_MS);
    expect(isValidSession('secret', session, now + SESSION_TTL_MS - 1)).toBe(true);
    expect(isValidSession('secret', session, now + SESSION_TTL_MS)).toBe(false);
  });

  it('cannot be forged or extended', () => {
    const { session } = createSession('secret');
    const [, sig] = session.split('.');
    expect(isValidSession('other-token', session)).toBe(false);
    expect(isValidSession('secret', `${Date.now() + 10 * SESSION_TTL_MS}.${sig}`)).toBe(false);
    expect(isValidSession('secret', 'garbage')).toBe(false);
  });
});
