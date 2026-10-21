import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { type ModelSettings, ModelSettingsError } from './model-settings.ts';

interface ModelRoutesOptions {
  models: Pick<ModelSettings, 'defaultModel' | 'setDefaultModel'>;
}

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const modelRoutes: FastifyPluginAsync<ModelRoutesOptions> = async (app, { models }) => {
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof ModelSettingsError) return reply.code(400).send({ error: error.message });
    throw error;
  });

  app.get('/', () => ({ defaultModel: models.defaultModel() }));

  app.put<{ Body: { defaultModel?: unknown } }>('/', async ({ body }) => ({
    defaultModel: await models.setDefaultModel(body?.defaultModel),
  }));
};
