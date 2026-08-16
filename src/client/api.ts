import type { PlayerId } from '../game';
import type { AiTurnStatus, OpponentMode, SafeGameView, StrategyPreset } from '../shared/api';
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}.`); return body;
}
export async function getStrategies(): Promise<StrategyPreset[]> { return (await request<{ strategies: StrategyPreset[] }>('/api/strategies')).strategies; }
export function createGame(input: { seed?: number; strategyPresetId: string; strategyMarkdown: string; firstPlayerId: PlayerId; opponentMode: OpponentMode }): Promise<SafeGameView> { return request('/api/games', { method: 'POST', body: JSON.stringify(input) }); }
export function loadGame(id: string): Promise<SafeGameView> { return request(`/api/games/${id}`); }
export function updateBuild(game: SafeGameView, definitionIds: string[], complete: boolean): Promise<SafeGameView> { return request(`/api/games/${game.id}/build`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision, definitionIds, complete }) }); }
export function takeAction(game: SafeGameView, actionId: string): Promise<SafeGameView> { return request(`/api/games/${game.id}/actions`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision, actionId }) }); }
export function undoAction(game: SafeGameView): Promise<SafeGameView> { return request(`/api/games/${game.id}/undo`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision }) }); }
export function confirmAction(game: SafeGameView): Promise<SafeGameView> { return request(`/api/games/${game.id}/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision: game.revision }) }); }
export function startAiTurn(gameId: string): Promise<AiTurnStatus> { return request(`/api/games/${gameId}/ai-turn`, { method: 'POST' }); }
export function getAiTurnStatus(gameId: string): Promise<AiTurnStatus> { return request(`/api/games/${gameId}/ai-turn`); }
