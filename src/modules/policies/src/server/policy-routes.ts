import type { FastifyPluginAsync } from 'fastify';
import { PolicyValidationError } from '../domain/policy.ts';
import type { PolicyService } from './policy-service.ts';

interface PolicyRoutesOptions {
  policies: Pick<PolicyService, 'list' | 'save'>;
}

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const policyRoutes: FastifyPluginAsync<PolicyRoutesOptions> = async (app, { policies }) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof PolicyValidationError)
      return reply.code(400).send({ error: error.message });
    throw error;
  });

  app.get('/', () => policies.list());

  app.put<{ Body: unknown }>('/', (request) => policies.save(request.body));
};
