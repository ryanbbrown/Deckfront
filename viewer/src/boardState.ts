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
}

export interface ReplayBundle extends BoardBundle {
  timeline: ReplayTimeline;
  entry: ReplayEntry | null;
  index: number;
  deck: DeckBundle;
}

const defaultScenarioUrl = '/game-data/scenarios/sketch-v1.board.json';

export function scenarioUrlFromLocation(location: Location = window.location): string {
  return new URLSearchParams(location.search).get('scenario') ?? defaultScenarioUrl;
}

export function timelineUrlFromLocation(location: Location = window.location): string | null {
  return new URLSearchParams(location.search).get('timeline');
}

export async function loadBoardBundle(scenarioUrl = scenarioUrlFromLocation()): Promise<BoardBundle> {
  const state = boardStateSchema.parse(await fetchJson(scenarioUrl));
  return loadBoardBundleForState(state);
}

export async function loadReplayBundle(timelineUrl: string, index: number): Promise<ReplayBundle> {
  const timeline = replayTimelineSchema.parse(await fetchJson(timelineUrl));
  const boundedIndex = clamp(index, 0, timeline.entries.length);
  const entry = timeline.entries[Math.max(0, boundedIndex - 1)]!;
  const boardUrl = resolveRelativeGameUrl(timelineUrl, boundedIndex === 0 ? entry.board.before : entry.board.after);
  const deckUrl = resolveRelativeGameUrl(timelineUrl, boundedIndex === 0 ? entry.deck.before : entry.deck.after);
  const [state, deck] = await Promise.all([fetchJson(boardUrl).then((json) => boardStateSchema.parse(json)), loadDeckBundle(deckUrl)]);
  const board = await loadBoardBundleForState(state);
  return { ...board, timeline, entry: boundedIndex === 0 ? null : entry, index: boundedIndex, deck };
}

async function loadBoardBundleForState(state: BoardState): Promise<BoardBundle> {
  const rulesetBase = `/game-data/rulesets/${state.ruleset}`;
  const [map, units] = await Promise.all([
    fetchJson(`${rulesetBase}/maps/${state.map}.json`).then((json) => boardMapSchema.parse(json)),
    fetchJson(`${rulesetBase}/units.json`).then((json) => unitRulesSchema.parse(json))
  ]);

  return { state, map, units };
}

async function loadDeckBundle(url: string): Promise<DeckBundle> {
  const raw = await fetchJson(url);
  if (!raw || typeof raw !== 'object' || !('game' in raw)) {
    throw new Error(`Invalid deck snapshot: ${url}`);
  }
  return { game: (raw as { game: GameState }).game };
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
