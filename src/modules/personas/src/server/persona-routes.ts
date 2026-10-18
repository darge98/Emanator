import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { type Persona, validatePersona } from '../domain/persona.ts';
import { PERSONA_PRESETS } from '../domain/presets.ts';
import type { PersonaStore } from './persona-store.ts';

interface PersonaRoutesOptions {
  personas: Pick<PersonaStore, 'get' | 'save'>;
}

/** Mount with a prefix; transport-wide security and error logging belong to the host. */
export const personaRoutes: FastifyPluginAsync<PersonaRoutesOptions> = async (
  app,
  { personas },
) => {
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Invalid request. Check the name and personality.' });
    }
    throw error;
  });

  app.get('/', () => personas.get());
  app.get('/presets', async () => PERSONA_PRESETS);
  app.put<{ Body: Persona }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'personality'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            personality: { type: 'string', minLength: 1, maxLength: 20_000 },
          },
        },
      },
    },
    async (request, reply) => {
      let persona: Persona;
      try {
        persona = validatePersona(request.body);
      } catch {
        return reply
          .code(400)
          .send({ error: 'Name and personality must contain text within the allowed limits.' });
      }
      return personas.save(persona);
    },
  );
};
