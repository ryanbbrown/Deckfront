import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitTurn } from '../../src/playtest/commitTurn';
import { buildTurnArtifacts } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('Skirmish commit-turn', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('commits executor results only after strict validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-commit-'));
    tempDirs.push(root);
    await buildTurnArtifacts(root);
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify({ schemaVersion: 1, title: 'Commit test', run: { turnCap: 20 }, entries: [], terminalWinEvents: [] })}\n`);
    const entry = await commitTurn({
      run: root,
      deckResultPath: join(root, 'results/turn-001.deck.result.json'),
      boardResultPath: join(root, 'results/turn-001.board.result.json'),
      summary: 'Held position',
      reasoning: 'No engagement was available.',
      strictWin: true
    });
    expect(entry.actions).toEqual({ keyPointUpgrades: [], upgrades: [], activations: [] });
    const timeline = JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8')) as { entries: unknown[] };
    expect(timeline.entries).toHaveLength(1);
  });

  it('does not mutate the timeline when result ids disagree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-commit-'));
    tempDirs.push(root);
    const artifacts = await buildTurnArtifacts(root);
    const original = `${JSON.stringify({ schemaVersion: 1, title: 'Commit test', run: { turnCap: 20 }, entries: [] }, null, 2)}\n`;
    await writeFile(join(root, 'timeline.json'), original);
    await writeFile(join(root, 'results/turn-001.board.result.json'), `${JSON.stringify({ ...artifacts.boardResult, turnId: 'turn-002' })}\n`);
    await expect(commitTurn({ run: root, deckResultPath: join(root, 'results/turn-001.deck.result.json'), boardResultPath: join(root, 'results/turn-001.board.result.json'), summary: 'x', reasoning: 'y' })).rejects.toThrow('does not match');
    expect(await readFile(join(root, 'timeline.json'), 'utf8')).toBe(original);
  });
});
