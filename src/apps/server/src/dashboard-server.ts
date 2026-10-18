import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type PersonaStore, personaRoutes } from '@emanator/personas/server';
import { errorMessage, type Logger } from '@emanator/shared/server';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';

interface DashboardDeps {
  personas: Pick<PersonaStore, 'get' | 'save'>;
  logger: Logger;
  webRoot?: string;
}

/** Local configuration UI and its persistence interface share the Harness process. */
export async function createDashboardServer({ personas, logger, webRoot }: DashboardDeps) {
  const app = Fastify({
    bodyLimit: 128 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  app.addHook('onRequest', async (request, reply) => {
    // Reject browser origins and DNS rebinding; loopback binding/port publishing limits network access.
    if (!isLoopbackUrl(`http://${request.headers.host ?? ''}`)) {
      return reply.code(403).send({ error: 'The dashboard is available on localhost only.' });
    }
    const origin = request.headers.origin;
    if (origin && (!isLoopbackUrl(origin) || origin !== `http://${request.headers.host}`)) {
      return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.validation || (error.statusCode && error.statusCode < 500)) {
      return reply.code(error.statusCode ?? 400).send({ error: 'Invalid request.' });
    }
    logger.error('Dashboard request failed', { error: errorMessage(error) });
    return reply.code(500).send({ error: 'Could not access the configuration. Please try again.' });
  });

  app.register(personaRoutes, { prefix: '/api/persona', personas });

  const root = webRoot ?? fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const built = await access(join(root, 'index.html')).then(
    () => true,
    () => false,
  );
  if (built) {
    await app.register(fastifyStatic, { root, index: 'index.html', cacheControl: false });
    app.addHook('onSend', async (request, reply) => {
      if (!request.url.startsWith('/api/')) {
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        reply.header(
          'Cache-Control',
          request.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      }
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .code(503)
        .type('text/plain')
        .send('Build the dashboard with pnpm build, or use pnpm dev:web during development.'),
    );
  }
  return app;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
