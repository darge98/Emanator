import { describe, expect, it, vi } from 'vitest';
import { TurnTrust } from './turn-trust.ts';

describe('TurnTrust', () => {
  it('reports the first taint of a trusted turn, once', () => {
    const onTaint = vi.fn();
    const trust = new TurnTrust('owner', false, onTaint);

    trust.taint();
    trust.taint();

    expect(trust.writes).toBe('inferred');
    expect(onTaint).toHaveBeenCalledOnce();
  });

  it('reports nothing for a turn tainted from its start', () => {
    const onTaint = vi.fn();
    new TurnTrust('owner', true, onTaint).taint();
    new TurnTrust('routine', false, onTaint).taint();

    expect(onTaint).not.toHaveBeenCalled();
  });
});
