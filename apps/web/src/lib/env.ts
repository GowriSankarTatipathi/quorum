/**
 * Client-visible configuration. NEXT_PUBLIC_* values are inlined into the browser
 * bundle at build time, so this file must never reference a secret — the separation is
 * enforced by convention here and by review.
 */
const isDev = process.env.NODE_ENV !== 'production';
let wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/v1/ws';
if (!isDev && wsUrl.startsWith('ws://')) {
  wsUrl = wsUrl.replace('ws://', 'wss://');
}

export const clientEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  wsUrl,
} as const;
