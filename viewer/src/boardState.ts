import { boardMapSchema, boardStateSchema, unitRulesSchema, type BoardMap, type BoardState, type UnitRules } from '../../src/board/schema';
import type { GameState } from '../../src/core/types';
import { replayTimelineSchema, type ReplayEntry, type ReplayTimeline } from '../../src/replay/schema';

export interface BoardBundle {
  state: BoardState;
  map: BoardMap;
  units: UnitRules;
}

export interface DeckBundle {
  game: GameState;
  rngState: number;
}

export interface ReplayBundle extends BoardBundle {
  timeline: ReplayTimeline;
  entry: ReplayEntry | null;
  index: number;
  deck: DeckBundle;
  initialDeck: DeckBundle;
  previousState: BoardState | null;
  deckBefore: DeckBundle | null;
}

const defaultBoardUrl = '/game-data/.games/territory-v1-playtest/board.json';

export function boardUrlFromLocation(location: Location = window.location): string {
  return new URLSearchParams(location.search).get('board') ?? defaultBoardUrl;
}

export function timelineUrlFromLocation(location: Location = window.location): string | null {
  return new URLSearchParams(location.search).get('timeline');
}

export async function loadBoardBundle(boardUrl = boardUrlFromLocation()): Promise<BoardBundle> {
  const state = boardStateSchema.parse(await fetchJson(boardUrl));
  return loadBoardBundleForState(state);
}

export async function loadReplayBundle(timelineUrl: string, index: number): Promise<ReplayBundle> {
  const timeline = replayTimelineSchema.parse(await fetchJson(timelineUrl));
  const boundedIndex = clamp(index, 0, timeline.entries.length);
  const entry = timeline.entries[Math.max(0, boundedIndex - 1)]!;
  const boardBeforeUrl = resolveRelativeGameUrl(timelineUrl, entry.board.before);
  const initialDeckUrl = resolveRelativeGameUrl(timelineUrl, timeline.entries[0]!.deck.before);
  const deckBeforeUrl = resolveRelativeGameUrl(timelineUrl, entry.deck.before);
  const boardUrl = resolveRelativeGameUrl(timelineUrl, boundedIndex === 0 ? entry.board.before : entry.board.after);
  const deckUrl = resolveRelativeGameUrl(timelineUrl, boundedIndex === 0 ? entry.deck.before : entry.deck.after);
  const [state, previousState, deck, initialDeck, deckBefore] = await Promise.all([
    fetchJson(boardUrl).then((json) => boardStateSchema.parse(json)),
    boundedIndex === 0 ? Promise.resolve(null) : fetchJson(boardBeforeUrl).then((json) => boardStateSchema.parse(json)),
    loadDeckBundle(deckUrl),
    loadDeckBundle(initialDeckUrl),
    boundedIndex === 0 ? Promise.resolve(null) : loadDeckBundle(deckBeforeUrl)
  ]);
  const board = await loadBoardBundleForState(state);
  return { ...board, timeline, entry: boundedIndex === 0 ? null : entry, index: boundedIndex, deck, initialDeck, previousState, deckBefore };
}

async function loadBoardBundleForState(state: BoardState): Promise<BoardBundle> {
  const [map, units] = await Promise.all([
    fetchJson(`/game-data/maps/${state.map}.json`).then((json) => boardMapSchema.parse(json)),
    fetchJson(`/game-data/rulesets/${state.ruleset}/units.json`).then((json) => unitRulesSchema.parse(json))
  ]);

  return { state, map, units };
}

async function loadDeckBundle(url: string): Promise<DeckBundle> {
  const raw = await fetchJson(url);
  if (!raw || typeof raw !== 'object' || !('game' in raw)) {
    throw new Error(`Invalid deck snapshot: ${url}`);
  }
  const snapshot = raw as { game: GameState; rngState?: unknown };
  const rngState = snapshot.rngState;
  if (!Number.isInteger(rngState)) {
    throw new Error(`Invalid deck snapshot rng state: ${url}`);
  }
  return { game: snapshot.game, rngState: rngState as number };
}

function resolveRelativeGameUrl(baseUrl: string, path: string): string {
  return new URL(path, new URL(baseUrl, window.location.origin)).pathname;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(`${url}?t=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as unknown;
}
