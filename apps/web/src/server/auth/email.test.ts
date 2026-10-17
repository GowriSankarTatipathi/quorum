import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendVerificationRequest, type VerificationEmailParams } from './email';

const transport = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport: () => transport }));

const params: VerificationEmailParams = {
  identifier: 'qa@example.test',
  url: 'http://localhost:3000/test-magic-link',
  from: 'QUORUM <signin@example.test>',
  host: 'localhost:3000',
  smtp: { host: 'localhost', port: 1025 },
};

describe('magic-link email delivery', () => {
  beforeEach(() => transport.sendMail.mockReset());

  it('accepts a successful SMTP response without an optional pending array', async () => {
    transport.sendMail.mockResolvedValue({ accepted: [params.identifier], rejected: [] });
    await expect(sendVerificationRequest(params)).resolves.toBeUndefined();
  });

  it.each([
    { rejected: [params.identifier] },
    { rejected: [], pending: [{ address: params.identifier }] },
  ])('reports undelivered recipients for %j', async (result) => {
    transport.sendMail.mockResolvedValue(result);
    await expect(sendVerificationRequest(params)).rejects.toThrow(
      `Magic-link email could not be delivered to ${params.identifier}`,
    );
  });
});
