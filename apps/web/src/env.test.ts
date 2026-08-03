import { describe, expect, it } from 'vitest';
import { isGoogleEnabled, isMagicLinkEnabled, loadServerEnv } from './env';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/quorum',
  AUTH_SECRET: 'a'.repeat(32),
  JWT_SECRET: 'b'.repeat(32),
} as NodeJS.ProcessEnv;

const withGoogle = {
  ...base,
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
} as NodeJS.ProcessEnv;

const withEmail = {
  ...base,
  EMAIL_SERVER_HOST: 'localhost',
  EMAIL_SERVER_PORT: '1025',
} as NodeJS.ProcessEnv;

describe('web server environment', () => {
  it('accepts a Google-only configuration', () => {
    const env = loadServerEnv(withGoogle);
    expect(isGoogleEnabled(env)).toBe(true);
    expect(isMagicLinkEnabled(env)).toBe(false);
  });

  it('accepts a magic-link-only configuration', () => {
    const env = loadServerEnv(withEmail);
    expect(isMagicLinkEnabled(env)).toBe(true);
    expect(isGoogleEnabled(env)).toBe(false);
  });

  it('refuses to boot with no sign-in method at all', () => {
    expect(() => loadServerEnv(base)).toThrow(/No sign-in method is configured/);
  });

  it('rejects a half-configured Google client, which fails opaquely at callback time', () => {
    expect(() => loadServerEnv({ ...withEmail, GOOGLE_CLIENT_ID: 'id' })).toThrow(
      /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/,
    );
  });

  it('requires the two secrets to be independently strong', () => {
    expect(() => loadServerEnv({ ...withEmail, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadServerEnv({ ...withEmail, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('defaults the access token to 15 minutes and caps it at an hour', () => {
    expect(loadServerEnv(withEmail).ACCESS_TOKEN_TTL_S).toBe(900);
    expect(() => loadServerEnv({ ...withEmail, ACCESS_TOKEN_TTL_S: '86400' })).toThrow();
  });
});
