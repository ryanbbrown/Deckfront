import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateReplayBundle } from '../../src/playtest/run';
import { buildTurnArtifacts } from '../helpers/skirmish';

const tempDirs: string[] = [];

describe('strict deck replay validation', () => {
  afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it('accepts structured deck actions and rejects a changed action result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(root);
    const artifacts = await buildTurnArtifacts(root);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).resolves.toMatchObject({ entries: [{ entry: { id: 'turn-001' } }] });
    const timeline = structuredClone(artifacts.timeline);
    const entry = timeline.entries[0];
    if (!entry || entry.phase !== 'setup') throw new Error('expected setup entry');
    entry.deck.played.push('sparring');
    await writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).rejects.toThrow('deck.played does not match replay');
  });

  it('rejects an internally consistent fabricated opening deck that violates the configured draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(root);
    const artifacts = await buildTurnArtifacts(root);
    const before = structuredClone(artifacts.deckBefore);
    const after = structuredClone(artifacts.deckAfter);
    for (const snapshot of [before, after]) {
      snapshot.game.players[1]!.draw.push('silver', 'silver', 'silver', 'silver');
      snapshot.game.supply.silver! -= 4;
      snapshot.game.config.setup.draft!.maxCards = 99;
      snapshot.game.config.setup.draft!.maxCost = 99;
      snapshot.game.cards.silver!.cost = 0;
    }
    await writeFile(join(root, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(before)}\n`);
    await writeFile(join(root, 'snapshots/turn-001.after.deck.json'), `${JSON.stringify(after)}\n`);

    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).rejects.toThrow('P2 opening deck has 4 drafted cards, exceeding maximum 3');
  });

  it('accepts a legal configured draft reflected in the opening supply', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(root);
    const artifacts = await buildTurnArtifacts(root);
    for (const snapshot of [artifacts.deckBefore, artifacts.deckAfter]) {
      snapshot.game.players[1]!.draw.push('silver');
      snapshot.game.supply.silver! -= 1;
    }
    await writeFile(join(root, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(artifacts.deckBefore)}\n`);
    await writeFile(join(root, 'snapshots/turn-001.after.deck.json'), `${JSON.stringify(artifacts.deckAfter)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).resolves.toMatchObject({ entries: [{ entry: { id: 'turn-001' } }] });
  });

  it('checks draft cost and market supply against canonical setup assets', async () => {
    const costlyRoot = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(costlyRoot);
    const costly = await buildTurnArtifacts(costlyRoot);
    for (const snapshot of [costly.deckBefore, costly.deckAfter]) {
      snapshot.game.players[1]!.draw.push('gold', 'gold', 'gold');
      snapshot.game.supply.gold! -= 3;
    }
    await writeFile(join(costlyRoot, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(costly.deckBefore)}\n`);
    await writeFile(join(costlyRoot, 'snapshots/turn-001.after.deck.json'), `${JSON.stringify(costly.deckAfter)}\n`);
    await expect(validateReplayBundle(join(costlyRoot, 'timeline.json'), { strictDeck: true })).rejects.toThrow('P2 opening draft costs 18, exceeding maximum 8');

    const supplyRoot = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(supplyRoot);
    const supply = await buildTurnArtifacts(supplyRoot);
    for (const snapshot of [supply.deckBefore, supply.deckAfter]) snapshot.game.players[1]!.draw.push('silver');
    await writeFile(join(supplyRoot, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(supply.deckBefore)}\n`);
    await writeFile(join(supplyRoot, 'snapshots/turn-001.after.deck.json'), `${JSON.stringify(supply.deckAfter)}\n`);
    await expect(validateReplayBundle(join(supplyRoot, 'timeline.json'), { strictDeck: true })).rejects.toThrow('initial deck supply does not match configured supply minus drafted cards');
  });

  it('rejects missing base cards and unknown draft card ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckfront-deck-'));
    tempDirs.push(root);
    const artifacts = await buildTurnArtifacts(root);
    for (const snapshot of [artifacts.deckBefore, artifacts.deckAfter]) {
      snapshot.game.players[1]!.draw.pop();
      snapshot.game.players[1]!.draw.push('counterfeit');
    }
    await writeFile(join(root, 'snapshots/turn-001.before.deck.json'), `${JSON.stringify(artifacts.deckBefore)}\n`);
    await writeFile(join(root, 'snapshots/turn-001.after.deck.json'), `${JSON.stringify(artifacts.deckAfter)}\n`);
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).rejects.toThrow('P2 opening deck contains unknown card counterfeit');
    await expect(validateReplayBundle(join(root, 'timeline.json'), { strictDeck: true })).rejects.toThrow('P2 opening deck is missing 1 copper');
  });
});
