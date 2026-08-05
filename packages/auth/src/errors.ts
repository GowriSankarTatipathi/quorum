/** Machine-readable reasons an authentication attempt failed. */
export type AuthFailureCode =
  | 'E_TOKEN_MISSING'
  | 'E_TOKEN_MALFORMED'
  | 'E_TOKEN_EXPIRED'
  | 'E_TOKEN_SIGNATURE'
  | 'E_TOKEN_AUDIENCE'
  | 'E_TOKEN_REVOKED'
  | 'E_TOKEN_STALE_VERSION'
  | 'E_REFRESH_UNKNOWN'
  | 'E_REFRESH_EXPIRED'
  | 'E_REFRESH_REVOKED'
  | 'E_REFRESH_REUSED'
  | 'E_ACCOUNT_DISABLED'
  | 'E_FORBIDDEN';

export class AuthError extends Error {
  constructor(
    readonly code: AuthFailureCode,
    message: string,
    /** Written for the person, not the developer. Surfaced directly in the UI. */
    readonly humanMessage: string,
    readonly statusCode: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const tokenExpired = (): AuthError =>
  new AuthError('E_TOKEN_EXPIRED', 'access token expired', 'Your session expired. Sign in again.');

export const tokenMalformed = (): AuthError =>
  new AuthError(
    'E_TOKEN_MALFORMED',
    'token payload is malformed or missing claims',
    'Your session could not be verified. Sign in again.',
  );

export const tokenRevoked = (): AuthError =>
  new AuthError(
    'E_TOKEN_REVOKED',
    'access token is on the denylist',
    'This session was signed out. Sign in again to continue.',
  );

export const staleTokenVersion = (): AuthError =>
  new AuthError(
    'E_TOKEN_STALE_VERSION',
    'token version is behind the user record',
    'Your permissions changed, so this session ended. Sign in again to pick up the new ones.',
  );

export const accountDisabled = (): AuthError =>
  new AuthError(
    'E_ACCOUNT_DISABLED',
    'user is disabled',
    'This account has been disabled. Contact your workspace owner.',
    403,
  );

export const refreshReused = (): AuthError =>
  new AuthError(
    'E_REFRESH_REUSED',
    'refresh token replay detected; family revoked',
    'For your security we ended every session on this account, because a sign-in token was used twice. Please sign in again.',
  );

export const forbidden = (humanMessage: string): AuthError =>
  new AuthError('E_FORBIDDEN', 'permission denied', humanMessage, 403);
