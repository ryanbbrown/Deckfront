import { useEffect, useState } from 'react';
import { randomVariableCardIds } from '../game';
import type { PlayerId, RandomIndexSource } from '../game';
import type { AiDifficulty, GameMode, GameView, SetupCatalog } from '../shared/api';
import { createGame, loadGame, loadSetup } from './api';
import { Game, PreviewTable } from './Game';

const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';
const cryptoRandom: RandomIndexSource = {
  nextInt(maxExclusive) {
    const range = 0x1_0000_0000;
    const limit = range - range % maxExclusive;
    let value = 0;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (value >= limit);
    return value % maxExclusive;
  }
};
function refreshed(ids: readonly string[]): string[] { return randomVariableCardIds(cryptoRandom, ids); }

export function App() {
  const [catalog, setCatalog] = useState<SetupCatalog | null>(null);
  const [market, setMarket] = useState<string[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadSetup().then(async (setup) => {
      setCatalog(setup); setMarket(refreshed(setup.variableCardIds));
      const id = localStorage.getItem(ACTIVE_GAME_KEY);
      if (!id) return;
      try { setGame(await loadGame(id)); }
      catch { localStorage.removeItem(ACTIVE_GAME_KEY); }
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load setup.')).finally(() => setLoading(false));
  }, []);
  async function start(mode: GameMode, startingDraftEnabled: boolean, humanPlayerId?: PlayerId, aiDifficulty?: AiDifficulty) {
    setTraining(mode === 'ai'); setLoading(mode !== 'ai'); setError(null);
    try {
      const created = await createGame({ mode, variableCardIds: market, startingDraftEnabled,
        ...(mode === 'ai' ? { humanPlayerId, aiDifficulty } : {}) });
      localStorage.setItem(ACTIVE_GAME_KEY, created.id); setGame(created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create game.'); }
    finally { setLoading(false); setTraining(false); }
  }
  function newGame() { localStorage.removeItem(ACTIVE_GAME_KEY); setGame(null); setError(null); if (catalog) setMarket(refreshed(catalog.variableCardIds)); }
  if (training) return <main className="training-state"><div><span className="spinner" /><h1>Training opponent…</h1><p>The AI is testing strategies for this kingdom.</p></div></main>;
  if (loading || !catalog) return <main className="loading">Loading Hexdeck…</main>;
  if (!game) return <PreviewTable catalog={catalog} market={market} error={error} onRefresh={() => setMarket(refreshed(catalog.variableCardIds))} onStart={start} />;
  return <Game game={game} error={error} onGame={setGame} onError={setError} onNew={newGame} />;
}
