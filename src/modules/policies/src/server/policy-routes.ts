import type { FastifyPluginAsync } from 'fastify';
import { PolicyValidationError } from '../domain/policy.ts';
import { type PolicyService, UnknownToolError } from './policy-service.ts';

interface PolicyRoutesOptions {
  policies: Pick<PolicyService, 'list' | 'set' | 'reset'>;
}

type ByTool = { Params: { tool: string } };

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const policyRoutes: FastifyPluginAsync<PolicyRoutesOptions> = async (app, { policies }) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PolicyValidationError)
      return reply.code(400).send({ error: error.message });
    if (error instanceof UnknownToolError) return reply.code(404).send({ error: error.message });
    throw error;
  });

  app.get('/', () => policies.list());

  app.put<ByTool & { Body: unknown }>('/:tool', (request) =>
    policies.set(request.params.tool, request.body),
  );

  app.delete<ByTool>('/:tool', (request) => policies.reset(request.params.tool));
};
