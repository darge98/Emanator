import type { FastifyError, FastifyPluginAsync } from 'fastify';
import {
  DreamBusyError,
  type DreamService,
  DreamSettingsError,
  ProposalNotFoundError,
} from './dream-service.ts';

interface DreamRoutesOptions {
  dreams: Pick<DreamService, 'view' | 'saveSettings' | 'dreamNow' | 'decideProposal'>;
}

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const dreamRoutes: FastifyPluginAsync<DreamRoutesOptions> = async (app, { dreams }) => {
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof DreamSettingsError) return reply.code(400).send({ error: error.message });
    if (error instanceof DreamBusyError) return reply.code(409).send({ error: error.message });
    if (error instanceof ProposalNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    throw error;
  });

  app.get('/', () => dreams.view());

  app.put<{ Body: unknown }>('/settings', ({ body }) => dreams.saveSettings(body));

  app.put<{ Params: { id: string }; Body: { status?: unknown } }>(
    '/proposals/:id',
    async ({ params, body }, reply) => {
      const status = body?.status;
      if (status !== 'accepted' && status !== 'rejected') {
        return reply.code(400).send({ error: 'status must be accepted or rejected.' });
      }
      const decided = await dreams.decideProposal(params.id, status);
      if (!decided) return reply.code(409).send({ error: 'That proposal was answered already.' });
      return dreams.view();
    },
  );

  app.post('/runs', async (_request, reply) => {
    await dreams.dreamNow();
    return reply.code(202).send(await dreams.view());
  });
};
