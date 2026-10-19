import { errorMessage } from '@emanator/shared/server';
import type { FastifyPluginAsync } from 'fastify';
import { CapabilityValidationError } from '../domain/capability.ts';
import { AuthorizationExpiredError } from './capability-connections.ts';
import type { CapabilityService } from './capability-service.ts';
import { CapabilitySlugTakenError } from './capability-store.ts';

interface CapabilityRoutesOptions {
  capabilities: Pick<
    CapabilityService,
    | 'list'
    | 'get'
    | 'create'
    | 'update'
    | 'delete'
    | 'connect'
    | 'finishAuthorization'
    | 'refreshTools'
    | 'toolsOf'
    | 'setEnabled'
    | 'catalog'
    | 'connectCatalog'
  >;
  /** The dashboard page the browser returns to after an authorization, e.g. `/#capabilities`. */
  pageUrl: string;
}

/** Path of the OAuth redirect URI, under the routes' prefix. */
export const OAUTH_CALLBACK_PATH = '/oauth/callback';

type ById = { Params: { id: string } };

type Callback = {
  Querystring: { state?: string; code?: string; error?: string; error_description?: string };
};

const notFound = { error: 'Capability not found.' };

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const capabilityRoutes: FastifyPluginAsync<CapabilityRoutesOptions> = async (
  app,
  { capabilities, pageUrl },
) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CapabilityValidationError)
      return reply.code(400).send({ error: error.message });
    if (error instanceof CapabilitySlugTakenError)
      return reply.code(409).send({ error: error.message });
    throw error;
  });

  app.get('/', () => capabilities.list());

  app.get('/catalog', () => capabilities.catalog());

  /** Makes the entry's Capability the first time, then connects it like any other. */
  app.post<ById>('/catalog/:id/connect', async (request, reply) => {
    try {
      const outcome = await capabilities.connectCatalog(request.params.id);
      return outcome ?? reply.code(404).send({ error: 'Catalog entry not found.' });
    } catch (error) {
      if (error instanceof CapabilityValidationError || error instanceof CapabilitySlugTakenError) {
        throw error;
      }
      return reply.code(502).send({ error: `Could not connect: ${errorMessage(error)}` });
    }
  });

  app.post<{ Body: unknown }>('/', async (request, reply) =>
    reply.code(201).send(await capabilities.create(request.body)),
  );

  app.get<ById>('/:id', async (request, reply) => {
    const capability = await capabilities.get(request.params.id);
    return capability ?? reply.code(404).send(notFound);
  });

  app.put<ById & { Body: unknown }>('/:id', async (request, reply) => {
    const capability = await capabilities.update(request.params.id, request.body);
    return capability ?? reply.code(404).send(notFound);
  });

  app.put<ById & { Body: { enabled?: unknown } | undefined }>(
    '/:id/enabled',
    async (request, reply) => {
      const capability = await capabilities.setEnabled(request.params.id, request.body?.enabled);
      return capability ?? reply.code(404).send(notFound);
    },
  );

  app.delete<ById>('/:id', async (request, reply) =>
    (await capabilities.delete(request.params.id))
      ? reply.code(204).send()
      : reply.code(404).send(notFound),
  );

  /** Answers with the authorization page to open, when the server wants one. */
  app.post<ById>('/:id/connect', async (request, reply) => {
    try {
      const outcome = await capabilities.connect(request.params.id);
      return outcome ?? reply.code(404).send(notFound);
    } catch (error) {
      return reply.code(502).send({ error: `Could not connect: ${errorMessage(error)}` });
    }
  });

  app.get<ById>('/:id/tools', async (request, reply) => {
    const tools = await capabilities.toolsOf(request.params.id);
    return tools ?? reply.code(404).send(notFound);
  });

  app.post<ById>('/:id/tools', async (request, reply) => {
    try {
      const capability = await capabilities.refreshTools(request.params.id);
      return capability ?? reply.code(404).send(notFound);
    } catch (error) {
      return reply.code(502).send({ error: `Could not list the Tools: ${errorMessage(error)}` });
    }
  });

  // The authorization server sends the Owner's browser here; it goes back to the dashboard.
  app.get<Callback>(OAUTH_CALLBACK_PATH, async (request, reply) => {
    const { state, code, error, error_description } = request.query;
    const back = (params: Record<string, string>) =>
      reply.redirect(withQuery(pageUrl, params), 303);
    if (error || !state || !code) {
      return back({ authorization_error: error_description ?? error ?? 'No code came back.' });
    }
    try {
      return back({ authorized: await capabilities.finishAuthorization(state, code) });
    } catch (failure) {
      const message =
        failure instanceof AuthorizationExpiredError ? failure.message : errorMessage(failure);
      return back({ authorization_error: message });
    }
  });
};

/** Puts the query before the hash, where the dashboard's routing keeps the page. */
function withQuery(pageUrl: string, params: Record<string, string>): string {
  const hash = pageUrl.indexOf('#');
  const path = hash === -1 ? pageUrl : pageUrl.slice(0, hash);
  return `${path}?${new URLSearchParams(params)}${hash === -1 ? '' : pageUrl.slice(hash)}`;
}
