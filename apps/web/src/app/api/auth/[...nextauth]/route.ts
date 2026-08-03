import { handlers } from '@/server/auth';

export const { GET, POST } = handlers;

/**
 * Auth.js touches the database (adapter, rotation) and nodemailer, neither of which
 * runs on the edge, so this route is pinned to Node explicitly rather than relying on
 * the default and discovering it during a deploy.
 */
export const runtime = 'nodejs';
