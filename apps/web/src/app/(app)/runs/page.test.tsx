import type * as ApiClient from '@/lib/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import { auth } from '@/server/auth';
import RunsPage from './page';

vi.mock('@/server/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClient>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@quorum/ui', () => ({ Button: () => null }));

const validSession = {
  user: { id: 'user-1' },
  accessToken: 'test-token',
};

describe('Runs page session recovery', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([null, { user: { id: 'user-1' } }, { ...validSession, error: 'RefreshFailed' }])(
    'redirects an unusable session before calling the API',
    async (session) => {
      vi.mocked(auth).mockResolvedValue(session as never);
      await expect(RunsPage()).rejects.toThrow('REDIRECT:/signin?callbackUrl=/runs');
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it('redirects when the API rejects an expired credential', async () => {
    vi.mocked(auth).mockResolvedValue(validSession as never);
    vi.mocked(apiFetch).mockRejectedValue(new ApiClientError(401, 'E_TOKEN_EXPIRED', 'Expired'));
    await expect(RunsPage()).rejects.toThrow('REDIRECT:/signin?callbackUrl=/runs');
  });

  it('preserves non-authentication failures', async () => {
    vi.mocked(auth).mockResolvedValue(validSession as never);
    const error = new ApiClientError(503, 'E_UNAVAILABLE', 'Unavailable');
    vi.mocked(apiFetch).mockRejectedValue(error);
    await expect(RunsPage()).rejects.toBe(error);
  });

  it('renders with a valid session', async () => {
    vi.mocked(auth).mockResolvedValue(validSession as never);
    vi.mocked(apiFetch).mockResolvedValue({ runs: [] });
    expect(await RunsPage()).toBeTruthy();
  });
});
