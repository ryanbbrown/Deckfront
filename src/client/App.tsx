import { useEffect, useState } from 'react';
import type { PlayerId } from '../game';
import type { GameView } from '../shared/api';
import { createGame, loadGame, updateBuild } from './api';
import { CardFace, Game } from './Game';

const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';
export function App() {
  const [game, setGame] = useState<GameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const id = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!id) { setLoading(false); return; }
    void loadGame(id).then(setGame).catch(() => localStorage.removeItem(ACTIVE_GAME_KEY)).finally(() => setLoading(false));
  }, []);
  async function start(input: { seed?: number; firstPlayerId: PlayerId }) {
    setLoading(true); setError(null);
    try { const created = await createGame(input); localStorage.setItem(ACTIVE_GAME_KEY, created.id); setGame(created); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create game.'); }
    finally { setLoading(false); }
  }
  if (loading) return <main className="loading">Loading Hexdeck…</main>;
  if (!game) return <Setup error={error} onStart={start} />;
  return <Match game={game} error={error} onGame={setGame} onError={setError} onNew={() => { localStorage.removeItem(ACTIVE_GAME_KEY); setGame(null); }} />;
}
function Setup({ error, onStart }: { error: string | null; onStart: (input: { seed?: number; firstPlayerId: PlayerId }) => Promise<void> }) {
  const [seed, setSeed] = useState('');
  const [first, setFirst] = useState<PlayerId>('ochre');
  return <main className="setup-shell"><section className="setup-card"><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1><p className="lede">Two local players build decks, control distance, and fight to 0 health.</p>
    <fieldset><legend>First player</legend><label><input type="radio" checked={first === 'ochre'} onChange={() => setFirst('ochre')} /> Player 1</label><label><input type="radio" checked={first === 'indigo'} onChange={() => setFirst('indigo')} /> Player 2</label></fieldset>
    <label>Seed (optional)<input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>{error ? <p role="alert" className="error">{error}</p> : null}
    <button className="primary" onClick={() => void onStart({ firstPlayerId: first, ...(seed ? { seed: Number(seed) } : {}) })}>Start game</button>
  </section></main>;
}
function Match({ game, error, onGame, onError, onNew }: { game: GameView; error: string | null; onGame: (game: GameView) => void; onError: (error: string | null) => void; onNew: () => void }) {
  if (game.phase === 'startingBuild') return <StartingBuild game={game} error={error} onGame={onGame} onError={onError} onNew={onNew} />;
  return <Game game={game} error={error} onGame={onGame} onError={onError} onNew={onNew} />;
}
function StartingBuild({ game, error, onGame, onError, onNew }: { game: GameView; error: string | null; onGame: (game: GameView) => void; onError: (value: string | null) => void; onNew: () => void }) {
  const [saving, setSaving] = useState(false);
  const proposal = game.buildProposal;
  const cost = proposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0);
  const quantities = new Map<string, number>(); for (const id of proposal) quantities.set(id, (quantities.get(id) ?? 0) + 1);
  async function save(next: string[], complete = false) {
    if (saving) return; setSaving(true); onError(null);
    try { onGame(await updateBuild(game, next, complete)); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); }
    finally { setSaving(false); }
  }
  const builderName = game.activePlayerId === 'ochre' ? 'Player 1' : 'Player 2';
  return <main className="build-shell"><header><div><p className="eyebrow">{builderName} starting build</p><h1>Spend up to 12</h1></div><div className="budget" data-testid="build-budget">{cost} spent · {12 - cost} carries</div><button className="control-button control-button--secondary" onClick={onNew}>New game</button></header>{error ? <p role="alert" className="error">{error}</p> : null}
    <div className="market-grid">{Object.values(game.cards).map((card) => <article className="market-card" key={card.id} data-card-name={card.name}><CardFace card={card} /><div className="quantity"><button aria-label={`Remove ${card.name}`} disabled={saving || !quantities.get(card.id)} onClick={() => { const index = proposal.lastIndexOf(card.id); void save(proposal.filter((_, position) => position !== index)); }}>−</button><span aria-label={`${card.name} quantity`}>{quantities.get(card.id) ?? 0}</span><button aria-label={`Add ${card.name}`} disabled={saving} onClick={() => void save([...proposal, card.id])}>+</button></div></article>)}</div>
    <footer className="build-footer"><p>Base deck: 7 Copper. Chosen cards: {proposal.map((id) => game.cards[id]?.name).join(', ') || 'none'}.{saving ? ' Saving…' : ''}</p><button className="primary" disabled={saving || cost > 12} onClick={() => void save(proposal, true)}>Finish starting build</button></footer>
  </main>;
}
