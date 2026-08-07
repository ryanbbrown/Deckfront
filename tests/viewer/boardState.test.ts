import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReplayBundle } from '../../viewer/src/boardState';
import { skirmishArmyState } from '../helpers/skirmish';

describe('viewer replay loading', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads an initialized run with no committed turns at replay index zero', async () => {
    const timeline = { schemaVersion: 1, title: 'Initialized run', run: { turnCap: 60 }, entries: [] };
    const board = skirmishArmyState();
    const deck = { schemaVersion: 1, rngState: 2106, game: { players: [] } };
    const map = JSON.parse(await readFile('game/map.json', 'utf8')) as unknown;
    const unitRules = JSON.parse(await readFile('game/units.json', 'utf8')) as unknown;
    const responses: Record<string, unknown> = {
      '/game-data/.games/initialized/timeline.json': timeline,
      '/game-data/.games/initialized/board.json': board,
      '/game-data/.games/initialized/deck.json': deck,
      '/game-data/game/map.json': map,
      '/game-data/game/units.json': unitRules
    };
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173', search: '' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), 'http://localhost:5173');
      const body = responses[url.pathname];
      return new Response(JSON.stringify(body), { status: body === undefined ? 404 : 200 });
    }));

    const bundle = await loadReplayBundle('/game-data/.games/initialized/timeline.json', 7);

    const expectedDeck = { rngState: 2106, game: { players: [] } };
    expect(bundle).toMatchObject({ index: 0, entry: null, previousState: null, deckBefore: null, state: board, deck: expectedDeck, initialDeck: expectedDeck });
  });
});
