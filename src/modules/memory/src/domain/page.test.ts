import { describe, expect, it } from 'vitest';
import { type Page, pagePath, parsePage, renderPage, sameTitle, validTitle } from './page.ts';

const marco: Page = {
  title: 'Marco Rossi',
  kind: 'persone',
  aliases: ['Marco'],
  summary: 'collega in Credemtel',
  facts: [
    {
      id: 'f3k2a',
      text: 'Collega in [[Credemtel]].',
      kind: 'fact',
      trust: 'confirmed',
      source: 'tu',
      date: '2026-10-19',
    },
    {
      id: 'a1b2c',
      text: 'Dagli del lei.',
      kind: 'instruction',
      trust: 'confirmed',
      source: 'tu',
      date: '2026-10-19',
    },
    {
      id: 'p9x1c',
      text: 'Cena da [[Trattoria da Gino]] il 12/10.',
      kind: 'fact',
      trust: 'inferred',
      source: 'mail di Marco',
      date: '2026-10-11',
    },
  ],
};

describe('Pages', () => {
  it('are Markdown that Obsidian reads, with confirmed and inferred Facts apart', () => {
    expect(renderPage(marco)).toBe(
      [
        '---',
        'tipo: persone',
        'aliases: ["Marco"]',
        'riassunto: "collega in Credemtel"',
        '---',
        '# Marco Rossi',
        '',
        '## Confermato',
        '- Collega in [[Credemtel]]. *(tu, 2026-10-19)* ^f3k2a',
        '- **Istruzione** · Dagli del lei. *(tu, 2026-10-19)* ^a1b2c',
        '',
        '## Dedotto',
        '- Cena da [[Trattoria da Gino]] il 12/10. *(mail di Marco, 2026-10-11)* ^p9x1c',
        '',
      ].join('\n'),
    );
  });

  it('read back what they wrote', () => {
    expect(parsePage('Marco Rossi', 'persone', renderPage(marco))).toEqual(marco);
  });

  it('keep Facts the Owner added by hand, without a source or an id', () => {
    const page = parsePage('Fido', 'animali', '# Fido\n\n## Confermato\n- È un beagle.\n');

    expect(page.facts).toEqual([
      { id: '', text: 'È un beagle.', kind: 'fact', trust: 'confirmed', source: 'tu', date: '' },
    ]);
  });

  it('ignore list items outside the two sections', () => {
    expect(parsePage('X', 'altro', '# X\n\n## Note\n- qualcosa\n').facts).toEqual([]);
  });

  it('put the Owner at the root and everyone else in their kind', () => {
    expect(pagePath({ title: 'Utente', kind: 'utente' })).toBe('Utente');
    expect(pagePath(marco)).toBe('persone/Marco Rossi');
  });

  it('take titles that can be file names and links', () => {
    expect(validTitle('Trattoria da Gino')).toBe(true);
    expect(validTitle('a/b')).toBe(false);
    expect(validTitle('[[x]]')).toBe(false);
    expect(validTitle('  ')).toBe(false);
  });

  it('compare titles without case or accents', () => {
    expect(sameTitle('Città', ' citta ')).toBe(true);
    expect(sameTitle('Marco', 'Marta')).toBe(false);
  });
});
