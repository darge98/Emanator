import type { FastifyPluginAsync } from 'fastify';
import { RoutineValidationError } from '../domain/routine.ts';
import type { RoutineService } from './routine-service.ts';
import { RoutineNameTakenError } from './routine-store.ts';

interface RoutineRoutesOptions {
  routines: Pick<
    RoutineService,
    'list' | 'get' | 'create' | 'update' | 'delete' | 'runNow' | 'runs'
  >;
}

type ById = { Params: { id: string } };

const notFound = { error: 'Routine not found.' };

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const routineRoutes: FastifyPluginAsync<RoutineRoutesOptions> = async (
  app,
  { routines },
) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RoutineValidationError)
      return reply.code(400).send({ error: error.message });
    if (error instanceof RoutineNameTakenError)
      return reply.code(409).send({ error: error.message });
    throw error;
  });

  app.get('/', () => routines.list());

  app.post<{ Body: unknown }>('/', async (request, reply) =>
    reply.code(201).send(await routines.create(request.body)),
  );

  app.get<ById>('/:id', async (request, reply) => {
    const routine = await routines.get(request.params.id);
    return routine ?? reply.code(404).send(notFound);
  });

  app.put<ById & { Body: unknown }>('/:id', async (request, reply) => {
    const routine = await routines.update(request.params.id, request.body);
    return routine ?? reply.code(404).send(notFound);
  });

  app.delete<ById>('/:id', async (request, reply) =>
    (await routines.delete(request.params.id))
      ? reply.code(204).send()
      : reply.code(404).send(notFound),
  );

  app.post<ById>('/:id/runs', async (request, reply) => {
    const run = await routines.runNow(request.params.id);
    return run ? reply.code(202).send(run) : reply.code(404).send(notFound);
  });

  app.get<ById>('/:id/runs', async (request, reply) => {
    const runs = await routines.runs(request.params.id);
    return runs ?? reply.code(404).send(notFound);
  });
};
