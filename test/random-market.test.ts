import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, CARDS, SeededRandom, TREASURE_IDS, VARIABLE_ACTION_IDS,
  randomVariableCardIds, resetKingdoms
} from '../src/game';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';

afterEach(() => resetKingdoms());

describe('random markets', () => {
  it('selects ten deterministic unique variable actions', () => {
    const first = randomVariableCardIds(new SeededRandom(42));
    const second = randomVariableCardIds(new SeededRandom(42));
    expect(first).toEqual(second); expect(first).toHaveLength(10); expect(new Set(first).size).toBe(10);
    expect(first.every((id) => VARIABLE_ACTION_IDS.includes(id))).toBe(true);
    expect(first.some((id) => TREASURE_IDS.includes(id) || ALWAYS_AVAILABLE_ACTION_IDS.includes(id))).toBe(false);
  });

  it('defines six fixed market piles and keeps Scrap out of the variable pool', () => {
    expect([...TREASURE_IDS, ...ALWAYS_AVAILABLE_ACTION_IDS]).toEqual(['copper', 'silver', 'gold', 'step', 'focus', 'scrap']);
    expect(VARIABLE_ACTION_IDS).toContain('footwork'); expect(ALWAYS_AVAILABLE_ACTION_IDS).not.toContain('footwork');
    expect(CARDS.step!.headline).toBe('Move 1 space'); expect(CARDS.step!.detail).toBeUndefined();
    expect(VARIABLE_ACTION_IDS).toContain('repellingShot');
    expect(VARIABLE_ACTION_IDS).not.toContain('shot');
    expect(CARDS.shot).toBeUndefined();
  });

  it('loads a persisted generated kingdom after the registry is reset', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-random-market-'));
    try {
      const created = await new GameService(new FileGameRepository(directory)).create({
        seed: 2, mode: 'local', variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10)
      });
      resetKingdoms();
      const restarted = new GameService(new FileGameRepository(directory));
      const loaded = await restarted.get(created.id);
      expect(loaded.variableCardIds).toEqual(VARIABLE_ACTION_IDS.slice(0, 10));
      expect(loaded.fixedCardIds).toEqual(['copper', 'silver', 'gold', 'step', 'focus', 'scrap']);
      const exported = await restarted.exportGame(created.id);
      expect(exported).toMatchObject({ schemaVersion: 16, game: { id: created.id, seriesId: created.id, attemptNumber: 1, variableCardIds: VARIABLE_ACTION_IDS.slice(0, 10) } });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
