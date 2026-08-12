import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitAction } from '../../src/playtest/commitAction';
import { buildTurnArtifacts } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('Skirmish commit-action', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('commits setup executor results only after strict validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-commit-'));
    tempDirs.push(root);
    await buildTurnArtifacts(root);
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify({ schemaVersion: 1, title: 'Commit test', run: { turnCap: 20 }, entries: [], terminalWinEvents: [] })}\n`);
    const entry = await commitAction({ run: root, deckResultPath: join(root, 'results/turn-001.deck.result.json'), boardResultPath: join(root, 'results/turn-001.board.result.json'), summary: 'Setup', reasoning: 'Spent available resources.', strictWin: true });
    expect(entry.action).toEqual({ type: 'setup', keyPointUpgrades: [], upgrades: [] });
    expect((JSON.parse(await readFile(join(root, 'timeline.json'), 'utf8')) as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('requires deck evidence for setup and rejects it for activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-commit-'));
    tempDirs.push(root);
    await buildTurnArtifacts(root);
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify({ schemaVersion: 1, title: 'Commit test', run: { turnCap: 20 }, entries: [] })}\n`);
    await expect(commitAction({ run: root, boardResultPath: join(root, 'results/turn-001.board.result.json'), summary: 'x', reasoning: 'y' })).rejects.toThrow('setup commit requires a deck result');

    const boardResultPath = join(root, 'results/turn-001.board.result.json');
    const boardResult = JSON.parse(await readFile(boardResultPath, 'utf8'));
    boardResult.action = { type: 'activation', activation: { unit: 'P1-soldier-1', from: { col: 0, row: 0 }, to: { col: 0, row: 0 } } };
    await writeFile(boardResultPath, `${JSON.stringify(boardResult, null, 2)}\n`);
    await expect(commitAction({ run: root, deckResultPath: join(root, 'results/turn-001.deck.result.json'), boardResultPath, summary: 'x', reasoning: 'y' })).rejects.toThrow('activation commit cannot include a deck result');
  });

  it('keeps the timeline unchanged when result identifiers disagree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-commit-'));
    tempDirs.push(root);
    await buildTurnArtifacts(root);
    const timelinePath = join(root, 'timeline.json');
    const empty = { schemaVersion: 1, title: 'Commit test', run: { turnCap: 20 }, entries: [] };
    await writeFile(timelinePath, `${JSON.stringify(empty, null, 2)}\n`);
    const deckResultPath = join(root, 'results/turn-001.deck.result.json');
    const deckResult = JSON.parse(await readFile(deckResultPath, 'utf8'));
    deckResult.turnId = 'step-disagrees';
    await writeFile(deckResultPath, `${JSON.stringify(deckResult, null, 2)}\n`);

    await expect(commitAction({ run: root, deckResultPath, boardResultPath: join(root, 'results/turn-001.board.result.json'), summary: 'x', reasoning: 'y' })).rejects.toThrow('deck result does not match board result');
    expect(JSON.parse(await readFile(timelinePath, 'utf8'))).toEqual(empty);
  });
});
