import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * A deterministic page for integration runs.
 *
 * Reproduces the failure the product exists to catch: the billing toggle defaults to
 * ANNUAL, so an agent that extracts without checking the period reports $12 when the
 * monthly rate is $15. Serving it locally keeps the run reproducible — testing against a
 * live vendor site would make failures ambiguous between our bug and their redesign.
 */
const root = fileURLToPath(new URL('../fixture-site/', import.meta.url));

export interface FixtureServer {
  url: string;
  close: () => void;
}

export function startFixtureServer(port = 4321): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0] ?? '/';
    const file = name === '/' || name === '' ? '/pricing.html' : name;
    readFile(new URL(`.${file}`, `file://${root}`))
      .then((body) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      });
  });
  return new Promise<FixtureServer>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}/pricing.html`,
        close: () => {
          server.close();
        },
      });
    });
  });
}
