import 'server-only';
import { auth } from '@/server/auth';
import { clientEnv } from '@/lib/env';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

/**
 * Server-side client for the Fastify API.
 *
 * It runs only on the server so the access token is attached from the session cookie
 * and never reaches the browser. Shipping a 15-minute bearer token to client JavaScript
 * would put it within reach of any injected script, which is exactly the exposure the
 * short TTL is trying to bound.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { parse?: (value: unknown) => T } = {},
): Promise<T> {
  const session = await auth();
  if (!session?.accessToken) {
    throw new ApiClientError(401, 'E_TOKEN_MISSING', 'You need to sign in to do that.');
  }

  const response = await fetch(`${clientEnv.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.accessToken}`,
      ...init.headers,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let code = 'E_REQUEST';
    let message = `Request to ${path} failed with ${String(response.status)}.`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      code = body.error.code;
      message = body.error.message;
    } catch {
      // A non-JSON error body means the gateway itself is unhealthy; the status is all
      // the information there is, and the default message already carries it.
    }
    throw new ApiClientError(response.status, code, message);
  }

  const value: unknown = await response.json();
  return init.parse ? init.parse(value) : (value as T);
}
