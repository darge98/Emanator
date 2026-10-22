import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { TimeZoneError, type TimeZoneSettings } from './time-zone-settings.ts';

interface TimeZoneRoutesOptions {
  settings: Pick<TimeZoneSettings, 'timeZone' | 'setTimeZone'>;
}

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const timeZoneRoutes: FastifyPluginAsync<TimeZoneRoutesOptions> = async (
  app,
  { settings },
) => {
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof TimeZoneError) return reply.code(400).send({ error: error.message });
    throw error;
  });

  app.get('/', () => ({ timeZone: settings.timeZone() }));

  app.put<{ Body: { timeZone?: unknown } }>('/', async ({ body }) => ({
    timeZone: await settings.setTimeZone(body?.timeZone),
  }));
};
