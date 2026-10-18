import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

type AuthRequest = NextRequest & { auth: { user: { name: string } } | null };
type Handler = (request: AuthRequest) => Response;

const mocks = vi.hoisted(() => ({
  auth: vi.fn((handler: Handler) => handler),
}));

vi.mock('next-auth', () => ({ default: () => ({ auth: mocks.auth }) }));

// Capture the real routing callback while isolating Auth.js cookie decoding.
import './middleware';

function visit(path: string, hasCookie = false): Response {
  const request = Object.assign(new NextRequest(`http://localhost:3000${path}`), {
    // A cookie can decode successfully while its user no longer exists in the DB.
    auth: hasCookie ? { user: { name: 'Stale session' } } : null,
  });
  return mocks.auth.mock.calls[0]![0](request);
}

describe('authentication middleware recovery', () => {
  it.each(['/signin', '/signin?callbackUrl=/knowledge', '/verify-request'])(
    'keeps %s reachable with a stale session cookie',
    (path) => {
      const response = visit(path, true);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  it('terminates the redirect chain when the server sends a stale account back to sign-in', () => {
    expect(visit('/account', true).headers.get('x-middleware-next')).toBe('1');
    const recovery = visit('/signin?callbackUrl=/account', true);
    expect(recovery.headers.get('location')).toBeNull();
    expect(recovery.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/account', '/knowledge', '/runs/example?view=details'])(
    'still protects %s for signed-out visitors and preserves their destination',
    (path) => {
      const response = visit(path);
      expect(response.status).toBe(307);
      const destination = new URL(response.headers.get('location')!);
      expect(destination.pathname).toBe('/signin');
      expect(destination.searchParams.get('callbackUrl')).toBe(path);
    },
  );

  it('allows signed-out visitors to open sign-in', () => {
    expect(visit('/signin').headers.get('x-middleware-next')).toBe('1');
  });
});
