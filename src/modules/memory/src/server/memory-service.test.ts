import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentLogger } from '@emanator/shared/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryError, MemoryService, type RememberInput } from './memory-service.ts';

let dir: string;
let memory: MemoryService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emanator-memory-'));
  memory = new MemoryService({
    dir,
    timeZone: 'Europe/Rome',
    logger: silentLogger,
    now: () => new Date('2026-10-19T12:30:00Z'),
  });
  await memory.init();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fact = (input: Partial<RememberInput> & Pick<RememberInput, 'page' | 'fact'>) =>
  memory.remember({
    factKind: 'fact',
    trust: 'confirmed',
    source: 'tu',
    mayAddKind: true,
    ...input,
  });

const read = (path: string) => readFile(join(dir, path), 'utf8');
const commits = () =>
  execFileSync('git', ['log', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');

describe('MemoryService', () => {
  it('starts a vault with its kinds, an index and a first commit', async () => {
    expect(await read('tipi.md')).toContain('- **persone**: ');
    expect(await read('index.md')).toBe('# Indice\n\n');
    expect(commits()).toEqual(['Memoria creata']);
  });

  it('files a new Page under its kind and commits the change', async () => {
    const { page } = await fact({
      page: 'Marco Rossi',
      kind: 'persone',
      aliases: ['Marco'],
      summary: 'collega',
      fact: 'Collega in [[Credemtel]].',
    });

    expect(page.kind).toBe('persone');
    expect(await read('persone/Marco Rossi.md')).toContain(
      '- Collega in [[Credemtel]]. *(tu, 2026-10-19)* ^',
    );
    expect(await read('index.md')).toContain('## persone\n- [[Marco Rossi]] (Marco): collega');
    expect(await read('log.md')).toContain(
      '- 2026-10-19 14:30 · ricordato in [[Marco Rossi]] (confermato): Collega in [[Credemtel]].',
    );
    expect(commits()[0]).toBe(
      'ricordato in [[Marco Rossi]] (confermato): Collega in [[Credemtel]].',
    );
  });

  it('finds a Page by title or alias, ignoring case and accents', async () => {
    await fact({ page: 'Marco Rossi', kind: 'persone', aliases: ['Marco'], fact: 'Collega.' });
    await fact({ page: 'marco', fact: 'Ha due figli.' });

    const page = await memory.page('MARCO ROSSI');
    expect(page?.facts.map(({ text }) => text)).toEqual(['Collega.', 'Ha due figli.']);
  });

  it("keeps the Owner's Page at the root, whatever kind is given", async () => {
    await fact({ page: 'utente', fact: 'Si chiama Mattia.' });

    expect(await read('Utente.md')).toContain('# Utente');
    expect((await memory.pages())[0]?.title).toBe('Utente');
  });

  it('writes an inferred Fact with its source, apart from the confirmed ones', async () => {
    await fact({
      page: 'Fido',
      kind: 'animali',
      fact: 'Ha 3 anni.',
      trust: 'inferred',
      source: 'mail del veterinario',
    });

    expect(await read('animali/Fido.md')).toContain(
      '## Dedotto\n- Ha 3 anni. *(mail del veterinario, 2026-10-19)* ^',
    );
  });

  it('replaces a Fact by its id', async () => {
    const { fact: old } = await fact({ page: 'Auto', kind: 'possedimenti', fact: 'Una Panda.' });
    await fact({ page: 'Auto', fact: 'Una Golf.', replaces: old.id });

    expect((await memory.page('Auto'))?.facts.map(({ text }) => text)).toEqual(['Una Golf.']);
    expect(commits()[0]).toBe('aggiornato in [[Auto]] (confermato): Una Golf.');
  });

  it('asks for a kind for a new Page, and for a description for a new kind', async () => {
    await expect(fact({ page: 'Fido', fact: 'Un cane.' })).rejects.toThrow(MemoryError);
    await expect(fact({ page: 'Fido', kind: 'cani', fact: 'Un cane.' })).rejects.toThrow(
      /no kind "cani"/,
    );
  });

  it('adds a new kind when allowed, or files the Page under altro', async () => {
    await fact({
      page: 'Tokyo 2027',
      kind: 'viaggi',
      newKind: 'viaggi fatti o in programma',
      fact: 'A marzo.',
    });
    const { page, fellBackFrom } = await fact({
      page: 'Palestra',
      kind: 'abbonamenti',
      newKind: 'abbonamenti attivi',
      mayAddKind: false,
      fact: 'Scade a gennaio.',
    });

    expect(await read('tipi.md')).toContain('- **viaggi**: viaggi fatti o in programma');
    expect(await read('viaggi/Tokyo 2027.md')).toContain('A marzo.');
    expect(page.kind).toBe('altro');
    expect(fellBackFrom).toBe('abbonamenti');
    expect(await read('tipi.md')).not.toContain('**abbonamenti**');
  });

  it("never adds the Owner's kind, whose Page would replace theirs", async () => {
    await fact({ page: 'utente', fact: 'Si chiama Mattia.' });

    await expect(fact({ page: 'Foo', kind: 'utente', newKind: 'x', fact: 'bar' })).rejects.toThrow(
      MemoryError,
    );
    expect((await memory.page('Utente'))?.facts.map(({ text }) => text)).toEqual([
      'Si chiama Mattia.',
    ]);
  });

  it('finds a Page by its title before any alias, and refuses an alias naming another', async () => {
    await fact({ page: 'Marco Rossi', kind: 'persone', aliases: ['Marco'], fact: 'Collega.' });
    await expect(
      fact({ page: 'Aaa', kind: 'persone', aliases: ['marco rossi'], fact: 'x' }),
    ).rejects.toThrow(/already names \[\[Marco Rossi\]\]/);
    await expect(
      fact({ page: 'Aaa', kind: 'persone', aliases: ['Marco'], fact: 'x' }),
    ).rejects.toThrow(MemoryError);

    await writeFile(join(dir, 'persone/Bbb.md'), '---\naliases: ["Marco Rossi"]\n---\n# Bbb\n');
    expect((await memory.page('Marco Rossi'))?.title).toBe('Marco Rossi');
  });

  it('keeps every change on one line of the log', async () => {
    await fact({
      page: 'Auto',
      kind: 'possedimenti',
      fact: 'Una Panda.\n- 2026-01-01 00:00 · confermato dalla dashboard in [[Utente]]: falso',
    });

    expect(await memory.changes(10)).toHaveLength(1);
  });

  it('refuses titles that cannot be file names', async () => {
    await expect(fact({ page: '../x', kind: 'altro', fact: 'x' })).rejects.toThrow(MemoryError);
  });

  it('forgets a Fact, or a whole Page', async () => {
    const { fact: first } = await fact({ page: 'Auto', kind: 'possedimenti', fact: 'Una Panda.' });
    await fact({ page: 'Auto', fact: 'Rossa.' });

    await memory.forget('Auto', first.id);
    expect((await memory.page('Auto'))?.facts.map(({ text }) => text)).toEqual(['Rossa.']);

    await memory.forget('auto');
    expect(await memory.page('Auto')).toBeUndefined();
    expect(await read('index.md')).not.toContain('Auto');
    expect(commits()[0]).toBe('dimenticata la pagina Auto');
  });

  it('lets the Owner confirm an inferred Fact, which becomes theirs', async () => {
    const { fact: inferred } = await fact({
      page: 'Fido',
      kind: 'animali',
      fact: 'Ha 3 anni.',
      trust: 'inferred',
      source: 'mail del veterinario',
    });

    await memory.confirm('fido', inferred.id, 'dalla dashboard');

    expect((await memory.page('Fido'))?.facts[0]).toMatchObject({
      trust: 'confirmed',
      source: 'tu',
    });
    expect(commits()[0]).toBe('confermato dalla dashboard in [[Fido]]: Ha 3 anni.');
    await expect(memory.confirm('Fido', 'nope', 'dalla dashboard')).rejects.toThrow(/no Fact/);
  });

  it('lists the latest changes first', async () => {
    await fact({ page: 'Auto', kind: 'possedimenti', fact: 'Una Panda.' });
    await memory.forget('Auto', undefined, 'dalla dashboard');

    expect(await memory.changes(10)).toEqual([
      { at: '2026-10-19 14:30', change: 'dimenticata dalla dashboard la pagina Auto' },
      { at: '2026-10-19 14:30', change: 'ricordato in [[Auto]] (confermato): Una Panda.' },
    ]);
    expect(await memory.changes(1)).toHaveLength(1);
  });

  it('reads the Owner’s own edits, and gives their Facts an id on the next write', async () => {
    await writeFile(join(dir, 'luoghi.md'), 'ignored');
    await fact({ page: 'Casa', kind: 'luoghi', fact: 'A Bologna.' });
    await writeFile(
      join(dir, 'luoghi/Casa.md'),
      `${await read('luoghi/Casa.md')}- Ha un giardino.\n`,
    );
    await fact({ page: 'Casa', fact: 'Due piani.' });

    const facts = (await memory.page('Casa'))?.facts ?? [];
    expect(facts.map(({ text }) => text)).toEqual(['A Bologna.', 'Ha un giardino.', 'Due piani.']);
    expect(facts.every(({ id }) => /^[a-z0-9]{5}$/.test(id))).toBe(true);
  });

  it('runs parallel writes one at a time', async () => {
    await fact({ page: 'Auto', kind: 'possedimenti', fact: 'Una Panda.' });
    await Promise.all(
      ['Rossa.', 'Del 2015.', 'Diesel.'].map((text) => fact({ page: 'Auto', fact: text })),
    );

    expect((await memory.page('Auto'))?.facts).toHaveLength(4);
  });
});
