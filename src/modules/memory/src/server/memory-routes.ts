import type { FastifyError, FastifyPluginAsync } from 'fastify';
import type { MemorySnapshot } from '../domain/snapshot.ts';
import { MemoryError, type MemoryService } from './memory-service.ts';

interface MemoryRoutesOptions {
  memory: Pick<MemoryService, 'pages' | 'kinds' | 'changes' | 'confirm' | 'forget'>;
}

/** How many changes the dashboard shows. */
const CHANGES = 30;

/** In the log and the commits, what the Owner did here reads apart from the Agent's work. */
const BY_DASHBOARD = 'dalla dashboard';

interface FactParams {
  title: string;
  id: string;
}

/**
 * Mount with a prefix. Every change goes through `MemoryService`, so it is a commit like the
 * Agent's, and answers with the whole snapshot for the page to show.
 */
export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (app, { memory }) => {
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof MemoryError) return reply.code(404).send({ error: error.message });
    throw error;
  });

  const snapshot = async (): Promise<MemorySnapshot> => {
    const [pages, kinds, changes] = await Promise.all([
      memory.pages(),
      memory.kinds(),
      memory.changes(CHANGES),
    ]);
    return { pages, kinds, changes };
  };

  app.get('/', snapshot);

  app.post<{ Params: FactParams }>('/pages/:title/facts/:id/confirm', async ({ params }) => {
    await memory.confirm(params.title, params.id, BY_DASHBOARD);
    return snapshot();
  });

  app.delete<{ Params: FactParams }>('/pages/:title/facts/:id', async ({ params }) => {
    await memory.forget(params.title, params.id, BY_DASHBOARD);
    return snapshot();
  });

  app.delete<{ Params: { title: string } }>('/pages/:title', async ({ params }) => {
    await memory.forget(params.title, undefined, BY_DASHBOARD);
    return snapshot();
  });
};
