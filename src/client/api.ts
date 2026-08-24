import type { PlayerId } from '../game';
import type { AiDifficulty, GameMode, GameUpdateView, GameView, SetupCatalog } from '../shared/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}.`);
  return body;
}
export function loadSetup(): Promise<SetupCatalog> { return request('/api/setup'); }
export function createGame(input: {
  seed?: number | undefined; mode: GameMode; humanPlayerId?: PlayerId | undefined;
  aiDifficulty?: AiDifficulty | undefined; variableCardIds: string[]; startingDraftEnabled: boolean;
}): Promise<GameUpdateView> { return request('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
export function loadGame(id: string): Promise<GameView> { return request(`/api/games/${id}`); }
export function updateBuild(game: GameView, definitionIds: string[], complete: boolean): Promise<GameUpdateView> { return request(`/api/games/${game.id}/build`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision, definitionIds, complete }) }); }
export function takeAction(game: GameView, actionId: string): Promise<GameUpdateView> { return request(`/api/games/${game.id}/actions`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision, actionId }) }); }
export function undoAction(game: GameView): Promise<GameUpdateView> { return request(`/api/games/${game.id}/undo`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision }) }); }
