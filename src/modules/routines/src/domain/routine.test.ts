import { describe, expect, it } from 'vitest';
import { RoutineValidationError, validateRoutineInput } from './routine.ts';

const valid = {
  name: '  Briefing  ',
  prompt: 'Riassumi la giornata.',
  dedicatedTopic: true,
  enabled: true,
  triggers: [{ type: 'cron', expression: '0 8 * * *' }],
};

describe('validateRoutineInput', () => {
  it('trims text and drops an empty model', () => {
    expect(validateRoutineInput({ ...valid, model: ' ' })).toEqual({
      ...valid,
      name: 'Briefing',
    });
    expect(validateRoutineInput({ ...valid, model: 'opus' })).toMatchObject({ model: 'opus' });
  });

  it('allows any name with a letter or digit, `general` included', () => {
    expect(validateRoutineInput({ ...valid, name: 'general' }).name).toBe('general');
  });

  it.each([
    ['no name', { ...valid, name: '' }],
    ['a name without letters', { ...valid, name: '!!!' }],
    ['no prompt', { ...valid, prompt: '   ' }],
    ['no triggers', { ...valid, triggers: [] }],
    ['too many triggers', { ...valid, triggers: Array(11).fill(valid.triggers[0]) }],
    ['a bad trigger', { ...valid, triggers: [{ type: 'interval', everyMinutes: -1 }] }],
    ['a missing flag', { ...valid, enabled: undefined }],
  ])('rejects %s', (_label, input) =>
    expect(() => validateRoutineInput(input)).toThrow(RoutineValidationError),
  );
});
