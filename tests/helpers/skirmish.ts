import type { BoardState } from '../../src/board/schema';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGameConfig } from '../../src/config/loadGameConfig';
import { SeededRng } from '../../src/core/random';
import { setupGame } from '../../src/core/state';
import { executeBoardTurn, loadBoardRulesContext, type BoardTurnInput } from '../../src/playtest/boardTurn';
import { executeDeckTurn, type DeckSnapshot } from '../../src/playtest/deckTurn';
import type { ReplayTimeline } from '../../src/replay/schema';
import type { DeckTurnResult } from '../../src/playtest/deckTurn';

export function skirmishUnit(id: string, player: string, type: 'soldier' | 'archer', col: number, row: number): BoardState['units'][number] {
  return type === 'soldier'
    ? { id, player, type, col, row, hp: 6, attack: 1, movement: 4, range: 1 }
    : { id, player, type, col, row, hp: 4, attack: 1, movement: 3, range: 2 };
}

export function skirmishArmyState(overrides: Partial<BoardState> = {}): BoardState {
  const units: BoardState['units'] = [];
  for (let col = 0; col < 5; col += 1) {
    units.push(skirmishUnit(`P1-soldier-${col + 1}`, 'P1', 'soldier', col, 0));
    units.push(skirmishUnit(`P2-soldier-${col + 1}`, 'P2', 'soldier', col, 16));
  }
  return {
    schemaVersion: 1,
    ruleset: 'skirmish-v1',
    map: 'skirmish-v1',
    players: ['P1', 'P2'],
    turn: { activePlayer: 'P1', round: 1 },
    units,
    notes: [],
    ...overrides
  };
}

export function deckResult(produced: Record<string, number> = {}): DeckTurnResult {
  return {
    schemaVersion: 1,
    turnId: 'turn-001',
    player: 'P1',
    before: 'snapshots/turn-001.before.deck.json',
    after: 'snapshots/turn-001.after.deck.json',
    actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }],
    drawnHand: [],
    played: [],
    bought: [],
    produced
  };
}

export async function buildTurnArtifacts(root: string, options: { boardInput?: BoardTurnInput; produced?: Record<string, number> } = {}): Promise<{
  timeline: ReplayTimeline;
  deckBefore: DeckSnapshot;
  deckAfter: DeckSnapshot;
  boardBefore: BoardState;
  boardAfter: BoardState;
  deckResult: DeckTurnResult;
  boardResult: ReturnType<typeof executeBoardTurn>['result'];
}> {
  const config = await loadGameConfig('game/deck.yaml');
  const rng = new SeededRng(1);
  const deckBefore: DeckSnapshot = { schemaVersion: 1, rngState: rng.snapshot(), game: setupGame(config, rng) };
  const deck = executeDeckTurn(deckBefore, {
    schemaVersion: 1,
    turnId: 'turn-001',
    player: 'P1',
    actions: [{ type: 'moveToBuy' }, { type: 'endTurn' }]
  }, { beforePath: 'snapshots/turn-001.before.deck.json', afterPath: 'snapshots/turn-001.after.deck.json' });
  const deckTurnResult = options.produced ? { ...deck.result, produced: options.produced } : deck.result;
  const context = await loadBoardRulesContext();
  const board = executeBoardTurn(skirmishArmyState(), deckTurnResult, options.boardInput ?? {
    schemaVersion: 1,
    turnId: 'turn-001',
    player: 'P1',
    actions: { upgrades: [], activations: [] }
  }, context, { beforePath: 'snapshots/turn-001.before.board.json', afterPath: 'snapshots/turn-001.after.board.json' });
  const timeline: ReplayTimeline = {
    schemaVersion: 1,
    title: 'Skirmish test',
    run: { turnCap: 20 },
    entries: [{
      id: 'turn-001', player: 'P1', round: 1,
      deck: {
        before: deckTurnResult.before, after: deckTurnResult.after, drawnHand: deckTurnResult.drawnHand,
        played: deckTurnResult.played, bought: deckTurnResult.bought, produced: deckTurnResult.produced, actions: deckTurnResult.actions
      },
      board: { before: board.result.before, after: board.result.after },
      actions: board.result.actions,
      winEvents: [],
      summary: 'Held position',
      reasoning: 'No legal engagement was available.'
    }],
    terminalWinEvents: []
  };
  await mkdir(join(root, 'snapshots'), { recursive: true });
  await mkdir(join(root, 'results'), { recursive: true });
  await Promise.all([
    writeFile(join(root, deck.result.before), `${JSON.stringify(deck.before, null, 2)}\n`),
    writeFile(join(root, deck.result.after), `${JSON.stringify(deck.after, null, 2)}\n`),
    writeFile(join(root, board.result.before), `${JSON.stringify(board.before, null, 2)}\n`),
    writeFile(join(root, board.result.after), `${JSON.stringify(board.after, null, 2)}\n`),
    writeFile(join(root, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`),
    writeFile(join(root, 'results/turn-001.deck.result.json'), `${JSON.stringify(deckTurnResult, null, 2)}\n`),
    writeFile(join(root, 'results/turn-001.board.result.json'), `${JSON.stringify(board.result, null, 2)}\n`)
  ]);
  return { timeline, deckBefore: deck.before, deckAfter: deck.after, boardBefore: board.before, boardAfter: board.after, deckResult: deckTurnResult, boardResult: board.result };
}
