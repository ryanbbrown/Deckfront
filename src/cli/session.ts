import { loadGameConfig } from '../config/loadGameConfig';
import { SeededRng, shuffle, type Rng } from '../core/random';
import { drawCards, setupGame } from '../core/state';
import type { GameConfig, GameState } from '../core/types';
import { loadPersistedGame, savePersistedGame, stateFileExists, type PersistedGame } from './persistence';

export interface DeckSessionArgs {
  config: string;
  seed: number;
  state?: string;
  startingDecks: string[];
  drafts: string[];
}

export interface DeckSession {
  config: GameConfig;
  game: GameState;
  rng: SeededRng;
  loaded: boolean;
  save: (game: GameState) => Promise<PersistedGame | undefined>;
}

export async function loadDeckSession(args: DeckSessionArgs): Promise<DeckSession> {
  const config = await loadGameConfig(args.config);
  const loaded = args.state && (await stateFileExists(args.state)) ? await loadPersistedGame(args.state) : undefined;
  const rng = loaded ? SeededRng.fromState(loaded.rngState) : new SeededRng(args.seed);
  const game = loaded ? loaded.game : setupGame(config, rng);
  if (!loaded && args.startingDecks.length > 0) {
    applyStartingDeckOverrides(game, args.startingDecks, rng);
  }
  if (!loaded && args.drafts.length > 0) {
    applyDraftOverrides(game, args.drafts, rng);
  }

  async function save(gameToSave: GameState): Promise<PersistedGame | undefined> {
    if (!args.state) {
      return undefined;
    }
    const persisted = { schemaVersion: 1 as const, rngState: rng.snapshot(), game: gameToSave };
    await savePersistedGame(args.state, persisted);
    return persisted;
  }

  if (args.state && !loaded) {
    await save(game);
  }

  return { config, game, rng, loaded: Boolean(loaded), save };
}

function applyStartingDeckOverrides(state: GameState, overrides: string[], rng: Rng): void {
  for (const override of overrides) {
    const [maybePlayer, maybeCards] = override.includes('=') ? override.split('=', 2) : [undefined, override];
    const playerIds = maybePlayer ? [maybePlayer.trim()] : state.players.map((player) => player.id);
    const cards = parseCardList(maybeCards ?? '');
    if (cards.length === 0) {
      throw new Error('--starting-deck must include at least one card');
    }
    for (const cardId of cards) {
      if (!state.cards[cardId]) {
        throw new Error(`Unknown starting deck card: ${cardId}`);
      }
    }
    for (const playerId of playerIds) {
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!player) {
        throw new Error(`Unknown starting deck player: ${playerId}`);
      }
      player.draw = shuffle(cards, rng);
      player.hand = [];
      player.discard = [];
      player.play = [];
      player.freeTrashUsed = false;
      drawCards(player, state.config.setup.handSize, rng);
    }
  }
}

function applyDraftOverrides(state: GameState, drafts: string[], rng: Rng): void {
  const draftConfig = state.config.setup.draft;
  if (!draftConfig) {
    throw new Error('Draft configuration is missing from game config');
  }
  if (!state.cards[draftConfig.baseCard]) {
    throw new Error(`Draft base card is missing from config: ${draftConfig.baseCard}`);
  }

  const assignments = new Map<string, string[]>();
  for (const draft of drafts) {
    const [maybePlayer, maybeCards] = draft.includes('=') ? draft.split('=', 2) : [undefined, draft];
    const playerIds = maybePlayer ? [maybePlayer.trim()] : state.players.map((player) => player.id);
    const draftedCards = parseCardList(maybeCards ?? '');
    if (draftedCards.length > draftConfig.maxCards) {
      throw new Error(`Draft has ${draftedCards.length} cards, exceeding maximum ${draftConfig.maxCards}`);
    }
    const spent = draftedCards.reduce((sum, cardId) => {
      const card = state.cards[cardId];
      if (!card) {
        throw new Error(`Unknown draft card: ${cardId}`);
      }
      return sum + card.cost;
    }, 0);

    if (spent > draftConfig.maxCost) {
      throw new Error(`Draft costs ${spent}, exceeding budget ${draftConfig.maxCost}`);
    }

    for (const playerId of playerIds) {
      if (!state.players.some((candidate) => candidate.id === playerId)) throw new Error(`Unknown draft player: ${playerId}`);
      if (assignments.has(playerId)) throw new Error(`Draft was submitted more than once for ${playerId}`);
      assignments.set(playerId, draftedCards);
    }
  }

  const draftedCounts: Record<string, number> = {};
  for (const draftedCards of assignments.values()) {
    for (const cardId of draftedCards) draftedCounts[cardId] = (draftedCounts[cardId] ?? 0) + 1;
  }
  for (const [cardId, count] of Object.entries(draftedCounts)) {
    const available = state.supply[cardId];
    if (available === undefined) throw new Error(`Draft card is not available in the market: ${cardId}`);
    if (count > available) throw new Error(`Draft requests ${count} ${cardId}, but only ${available} remain in the market`);
  }
  for (const [cardId, count] of Object.entries(draftedCounts)) state.supply[cardId] = (state.supply[cardId] ?? 0) - count;

  for (const [playerId, draftedCards] of assignments) {
    const playerIndex = state.players.findIndex((candidate) => candidate.id === playerId);
    const player = state.players[playerIndex]!;
    player.draw = shuffle([...Array(draftConfig.baseCount).fill(draftConfig.baseCard), ...draftedCards], rng);
    player.hand = [];
    player.discard = [];
    player.play = [];
    player.freeTrashUsed = false;
    if (playerIndex === state.activePlayer) {
      player.money = state.config.setup.initialMoney;
    }
    drawCards(player, state.config.setup.handSize, rng);
  }
}

function parseCardList(value: string): string[] {
  return value
    .split(',')
    .map((cardId) => cardId.trim())
    .filter((cardId) => cardId.length > 0);
}
