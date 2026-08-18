import { useEffect, useState } from 'react';
import type { PlayerId } from '../game';
import type { OpponentMode, SafeGameView, StrategyPreset } from '../shared/api';
import { createGame, getAiTurnStatus, getStrategies, loadGame, startAiTurn, updateBuild } from './api';
import { CardFace, Game } from './Game';

const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';
export function App() {
  const [strategies, setStrategies] = useState<StrategyPreset[]>([]);
  const [game, setGame] = useState<SafeGameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getStrategies().then(setStrategies).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load strategies.'));
    const id = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!id) { setLoading(false); return; }
    void loadGame(id).then(setGame).catch(() => localStorage.removeItem(ACTIVE_GAME_KEY)).finally(() => setLoading(false));
  }, []);
  async function start(input: { strategyPresetId: string; strategyMarkdown: string; seed?: number; firstPlayerId: PlayerId; opponentMode: OpponentMode }) {
    setLoading(true); setError(null);
    try { const created = await createGame(input); localStorage.setItem(ACTIVE_GAME_KEY, created.id); setGame(created); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create game.'); }
    finally { setLoading(false); }
  }
  if (loading) return <main className="loading">Loading Hexdeck…</main>;
  if (!game) return <Setup strategies={strategies} error={error} onStart={start} />;
  return <Match game={game} error={error} onGame={setGame} onError={setError} onNew={() => { localStorage.removeItem(ACTIVE_GAME_KEY); setGame(null); }} />;
}

function Setup({ strategies, error, onStart }: { strategies: StrategyPreset[]; error: string | null; onStart: (input: { strategyPresetId: string; strategyMarkdown: string; seed?: number; firstPlayerId: PlayerId; opponentMode: OpponentMode }) => Promise<void> }) {
  const [id, setId] = useState('ranged-setup');
  const selected = strategies.find((strategy) => strategy.id === id) ?? strategies[0];
  const [markdown, setMarkdown] = useState('');
  const [seed, setSeed] = useState('');
  const [first, setFirst] = useState<PlayerId>('ochre');
  const [opponentMode, setOpponentMode] = useState<OpponentMode>('ai');
  useEffect(() => { const preset = strategies.find((strategy) => strategy.id === id) ?? strategies[0]; if (preset) setMarkdown(preset.markdown); }, [id, strategies]);
  const local = opponentMode === 'local';
  return <main className="setup-shell"><section className="setup-card"><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1><p className="lede">Build a deck, control distance, and reduce the opponent to 0 health.</p>
    <fieldset><legend>Opponent</legend><label><input type="radio" checked={!local} onChange={() => setOpponentMode('ai')} /> AI</label><label><input type="radio" checked={local} onChange={() => setOpponentMode('local')} /> Local player</label></fieldset>
    {!local ? <><label>AI strategy<select aria-label="AI strategy" value={selected?.id ?? ''} onChange={(event) => setId(event.target.value)}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label><label>Strategy instructions<textarea aria-label="Strategy instructions" rows={10} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /></label></> : null}
    <fieldset><legend>First player</legend><label><input type="radio" checked={first === 'ochre'} onChange={() => setFirst('ochre')} /> {local ? 'Player 1' : 'Human'}</label><label><input type="radio" checked={first === 'indigo'} onChange={() => setFirst('indigo')} /> {local ? 'Player 2' : 'AI'}</label></fieldset>
    <label>Seed (optional)<input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>{error ? <p role="alert" className="error">{error}</p> : null}
    <button className="primary" disabled={!selected || (!local && !markdown.trim())} onClick={() => void onStart({ strategyPresetId: selected?.id ?? id, strategyMarkdown: markdown || '# Local game', firstPlayerId: first, opponentMode, ...(seed ? { seed: Number(seed) } : {}) })}>Start game</button>
  </section></main>;
}

function Match({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (error: string | null) => void; onNew: () => void }) {
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [aiElapsed, setAiElapsed] = useState(0);
  const aiActive = game.opponentMode === 'ai' && game.activePlayerId === game.aiPlayerId && !game.winner;
  useEffect(() => {
    if (!aiActive) { setAiStatus('idle'); setAiError(null); setAiElapsed(0); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const elapsedTimer = setInterval(() => setAiElapsed((value) => value + 1), 1000);
    setAiStatus('running'); setAiError(null); setAiElapsed(0);
    async function poll() {
      try {
        let status = await getAiTurnStatus(game.id);
        if (status.status === 'idle') status = await startAiTurn(game.id);
        if (cancelled) return;
        if (status.status === 'complete' && status.game) { onGame(status.game); return; }
        if (status.status === 'error') { setAiStatus('error'); setAiError(status.error ?? 'AI failed.'); return; }
        timer = setTimeout(() => void poll(), 250);
      } catch (cause) { if (!cancelled) { setAiStatus('error'); setAiError(cause instanceof Error ? cause.message : 'AI failed.'); } }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); clearInterval(elapsedTimer); };
  }, [aiActive, attempt, game.id, game.revision, onGame]);
  async function retryAi() {
    setAiStatus('running'); setAiError(null);
    try { await startAiTurn(game.id); setAttempt((value) => value + 1); }
    catch (cause) { setAiStatus('error'); setAiError(cause instanceof Error ? cause.message : 'AI failed.'); }
  }
  if (game.phase === 'startingBuild' && (game.opponentMode === 'local' || game.activePlayerId === game.humanPlayerId)) return <StartingBuild game={game} error={error} onGame={onGame} onError={onError} onNew={onNew} />;
  if (game.phase === 'startingBuild') return <main className="setup-shell"><section className="setup-card"><h1>AI is building…</h1><p>Your build is locked. The AI cannot see it.</p><p data-testid="ai-elapsed">{aiElapsed}s elapsed</p>{aiError ? <p role="alert" className="error">{aiError}</p> : null}<button disabled={aiStatus !== 'error'} onClick={() => void retryAi()}>Retry AI</button></section></main>;
  return <Game game={game} error={error} aiStatus={aiStatus} aiElapsed={aiElapsed} aiError={aiError} onGame={onGame} onError={onError} onNew={onNew} onRetry={retryAi} />;
}

function StartingBuild({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (value: string | null) => void; onNew: () => void }) {
  const [saving, setSaving] = useState(false);
  const proposal = game.humanBuildProposal;
  const cost = proposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0);
  const quantities = new Map<string, number>();
  for (const id of proposal) quantities.set(id, (quantities.get(id) ?? 0) + 1);
  async function save(next: string[], complete = false) {
    if (saving) return;
    setSaving(true); onError(null);
    try { onGame(await updateBuild(game, next, complete)); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); }
    finally { setSaving(false); }
  }
  const builderName = game.opponentMode === 'local' ? game.activePlayerId === 'ochre' ? 'Player 1' : 'Player 2' : 'Your';
  return <main className="build-shell"><header><div><p className="eyebrow">{builderName} starting build</p><h1>Spend up to 12</h1></div><div className="budget" data-testid="build-budget">{cost} spent · {12 - cost} carries</div><button onClick={onNew}>New game</button></header>{error ? <p role="alert" className="error">{error}</p> : null}
    <div className="market-grid">{Object.values(game.cards).map((card) => <article className="market-card" key={card.id} data-card-name={card.name}><CardFace card={card} /><div className="quantity"><button aria-label={`Remove ${card.name}`} disabled={saving || !quantities.get(card.id)} onClick={() => { const index = proposal.lastIndexOf(card.id); void save(proposal.filter((_, position) => position !== index)); }}>−</button><span aria-label={`${card.name} quantity`}>{quantities.get(card.id) ?? 0}</span><button aria-label={`Add ${card.name}`} disabled={saving} onClick={() => void save([...proposal, card.id])}>+</button></div></article>)}</div>
    <footer className="build-footer"><p>Base deck: 7 Copper. Chosen cards: {proposal.map((id) => game.cards[id]?.name).join(', ') || 'none'}.{saving ? ' Saving…' : ''}</p><button className="primary" disabled={saving || cost > 12} onClick={() => void save(proposal, true)}>Finish starting build</button></footer>
  </main>;
}
