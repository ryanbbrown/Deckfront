import { useEffect, useState } from 'react';
import type { LegalAction, PlayerId } from '../game';
import type { OpponentMode, SafeGameView, StrategyPreset } from '../shared/api';
import { confirmAction, createGame, getAiTurnStatus, getStrategies, loadGame, startAiTurn, takeAction, undoAction, updateBuild } from './api';
import { Board } from './Board';
const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';
export function App() {
  const [strategies, setStrategies] = useState<StrategyPreset[]>([]); const [game, setGame] = useState<SafeGameView | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getStrategies().then(setStrategies).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load strategies.'));
    const id = localStorage.getItem(ACTIVE_GAME_KEY); if (!id) { setLoading(false); return; }
    void loadGame(id).then(setGame).catch(() => localStorage.removeItem(ACTIVE_GAME_KEY)).finally(() => setLoading(false));
  }, []);
  async function start(input: { strategyPresetId: string; strategyMarkdown: string; seed?: number; firstPlayerId: PlayerId; opponentMode: OpponentMode }) {
    setLoading(true); setError(null);
    try { const created = await createGame(input); localStorage.setItem(ACTIVE_GAME_KEY, created.id); setGame(created); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create game.'); } finally { setLoading(false); }
  }
  if (loading) return <main className="loading">Loading Hexdeck…</main>;
  if (!game) return <Setup strategies={strategies} error={error} onStart={start} />;
  return <Match game={game} error={error} onGame={setGame} onError={setError} onNew={() => { localStorage.removeItem(ACTIVE_GAME_KEY); setGame(null); }} />;
}
function Setup({ strategies, error, onStart }: { strategies: StrategyPreset[]; error: string | null; onStart: (input: { strategyPresetId: string; strategyMarkdown: string; seed?: number; firstPlayerId: PlayerId; opponentMode: OpponentMode }) => Promise<void> }) {
  const [id, setId] = useState('ranged-setup'); const selected = strategies.find((strategy) => strategy.id === id) ?? strategies[0];
  const [markdown, setMarkdown] = useState(''); const [seed, setSeed] = useState(''); const [first, setFirst] = useState<PlayerId>('ochre'); const [opponentMode, setOpponentMode] = useState<OpponentMode>('ai');
  useEffect(() => {
    const preset = strategies.find((strategy) => strategy.id === id) ?? strategies[0];
    if (preset) setMarkdown(preset.markdown);
  }, [id, strategies]);
  const local = opponentMode === 'local';
  return <main className="setup-shell"><section className="setup-card"><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1><p className="lede">Build a deck, control distance, and reduce the opponent to 0 health.</p>
    <fieldset><legend>Opponent</legend><label><input type="radio" checked={!local} onChange={() => setOpponentMode('ai')} /> AI</label><label><input type="radio" checked={local} onChange={() => setOpponentMode('local')} /> Local player</label></fieldset>
    {!local && <><label>AI strategy<select aria-label="AI strategy" value={selected?.id ?? ''} onChange={(event) => setId(event.target.value)}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
    <label>Strategy instructions<textarea aria-label="Strategy instructions" rows={12} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /></label></>}
    <fieldset><legend>First player</legend><label><input type="radio" checked={first === 'ochre'} onChange={() => setFirst('ochre')} /> {local ? 'Player 1' : 'Human'}</label><label><input type="radio" checked={first === 'indigo'} onChange={() => setFirst('indigo')} /> {local ? 'Player 2' : 'AI'}</label></fieldset>
    <label>Seed (optional)<input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>{error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={!selected || (!local && !markdown.trim())} onClick={() => void onStart({ strategyPresetId: selected?.id ?? id, strategyMarkdown: markdown || '# Local game', firstPlayerId: first, opponentMode, ...(seed ? { seed: Number(seed) } : {}) })}>Start game</button>
  </section></main>;
}
function Match({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (error: string | null) => void; onNew: () => void }) {
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'error'>('idle'); const [aiError, setAiError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0); const [aiElapsed, setAiElapsed] = useState(0);
  const aiActive = game.opponentMode === 'ai' && game.activePlayerId === game.aiPlayerId && !game.winner && !game.previewCommand;
  useEffect(() => {
    if (!aiActive) { setAiStatus('idle'); setAiElapsed(0); return; }
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const elapsedTimer = setInterval(() => setAiElapsed((value) => value + 1), 1000);
    setAiStatus('running'); setAiError(null); setAiElapsed(0);
    async function poll() {
      try {
        let status = await getAiTurnStatus(game.id); if (status.status === 'idle') status = await startAiTurn(game.id); if (cancelled) return;
        if (status.status === 'complete' && status.game) { onGame(status.game); return; }
        if (status.status === 'error') { setAiStatus('error'); setAiError(status.error ?? 'AI failed.'); return; }
        timer = setTimeout(() => void poll(), 250);
      } catch (cause) { if (!cancelled) { setAiStatus('error'); setAiError(cause instanceof Error ? cause.message : 'AI failed.'); } }
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); clearInterval(elapsedTimer); };
  }, [aiActive, attempt, game.id, game.revision, onGame]);
  async function retryAi() {
    setAiStatus('running'); setAiError(null);
    try { await startAiTurn(game.id); setAttempt((value) => value + 1); }
    catch (cause) { setAiStatus('error'); setAiError(cause instanceof Error ? cause.message : 'AI failed.'); }
  }
  if (game.phase === 'startingBuild' && (game.opponentMode === 'local' || game.activePlayerId === game.humanPlayerId)) return <StartingBuild game={game} error={error} onGame={onGame} onError={onError} onNew={onNew} />;
  if (game.phase === 'startingBuild') return <main className="setup-shell"><section className="setup-card"><h1>AI is building…</h1><p>Your build is locked. The AI cannot see it.</p><p data-testid="ai-elapsed">{aiElapsed}s elapsed</p>{aiError && <p role="alert" className="error">{aiError}</p>}<button disabled={aiStatus !== 'error'} onClick={() => void retryAi()}>Retry AI</button></section></main>;
  return <Game game={game} error={error} aiStatus={aiStatus} aiElapsed={aiElapsed} aiError={aiError} onGame={onGame} onError={onError} onNew={onNew} onRetry={retryAi} />;
}
function StartingBuild({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (value: string | null) => void; onNew: () => void }) {
  const [saving, setSaving] = useState(false); const proposal = game.humanBuildProposal; const cost = proposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0); const quantities = new Map<string, number>(); for (const id of proposal) quantities.set(id, (quantities.get(id) ?? 0) + 1);
  async function save(next: string[], complete = false) { if (saving) return; setSaving(true); onError(null); try { onGame(await updateBuild(game, next, complete)); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); } finally { setSaving(false); } }
  const builderName = game.opponentMode === 'local' ? (game.activePlayerId === 'ochre' ? 'Player 1' : 'Player 2') : 'Your';
  return <main className="build-shell"><header><div><p className="eyebrow">{builderName} starting build</p><h1>Spend up to 12</h1></div><div className="budget" data-testid="build-budget">{cost} spent · {12 - cost} carries</div><button onClick={onNew}>New game</button></header>{error && <p role="alert" className="error">{error}</p>}
    <div className="market-grid">{Object.values(game.cards).map((card) => <article className="market-card" key={card.id} data-card-name={card.name}><span className="market-card__cost">{card.cost}</span><strong>{card.name}</strong><small>{card.text}</small><div className="quantity"><button aria-label={`Remove ${card.name}`} disabled={saving || !quantities.get(card.id)} onClick={() => { const index = proposal.lastIndexOf(card.id); void save(proposal.filter((_, position) => position !== index)); }}>−</button><span aria-label={`${card.name} quantity`}>{quantities.get(card.id) ?? 0}</span><button aria-label={`Add ${card.name}`} disabled={saving} onClick={() => void save([...proposal, card.id])}>+</button></div></article>)}</div>
    <footer className="build-footer"><p>Base deck: 7 Copper. Chosen cards: {proposal.map((id) => game.cards[id]?.name).join(', ') || 'none'}.{saving ? ' Saving…' : ''}</p><button className="primary" disabled={saving || cost > 12} onClick={() => void save(proposal, true)}>Finish starting build</button></footer>
  </main>;
}
function Game({ game, error, aiStatus, aiElapsed, aiError, onGame, onError, onNew, onRetry }: { game: SafeGameView; error: string | null; aiStatus: string; aiElapsed: number; aiError: string | null; onGame: (game: SafeGameView) => void; onError: (value: string | null) => void; onNew: () => void; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [cullCard, setCullCard] = useState<string | null>(null); const [movementCard, setMovementCard] = useState<string | null>(null); const [trash, setTrash] = useState<string[]>([]);
  const local = game.opponentMode === 'local'; const actor = game.players[game.viewPlayerId]; const availability = new Map(game.actionAvailability.map((item) => [item.cardInstanceId, item]));
  const localTurn = local || game.activePlayerId === game.humanPlayerId; const preview = Boolean(game.previewCommand); const actorName = playerName(game, game.viewPlayerId);
  async function act(action: LegalAction) { setBusy(true); onError(null); try { onGame(await takeAction(game, action.id)); setCullCard(null); setMovementCard(null); setTrash([]); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); } finally { setBusy(false); } }
  async function revisionAction(kind: 'confirm' | 'undo') { setBusy(true); try { onGame(await (kind === 'confirm' ? confirmAction(game) : undoAction(game))); } catch (cause) { onError(cause instanceof Error ? cause.message : `${kind} failed.`); } finally { setBusy(false); } }
  const cardActions = (id: string) => game.legalActions.filter((action) => 'cardInstanceId' in action.command && action.command.cardInstanceId === id);
  function chooseCard(id: string) {
    const info = availability.get(id); if (!info?.enabled) return;
    if (info.selection === 'trashTwo') { setCullCard(id); setMovementCard(null); setTrash([]); return; }
    if (info.selection === 'movement') { setMovementCard(id); setCullCard(null); return; }
    const actions = cardActions(id); if (actions.length === 1) void act(actions[0]!);
  }
  function toggleTrash(id: string) { setTrash((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 2 ? [...current, id] : current); }
  const cullAction = cullCard && trash.length === 2 ? cardActions(cullCard).find((action) => action.command.type === 'playCull' && samePair(action.command.trashInstanceIds, trash)) : undefined;
  const endAction = game.legalActions.find((action) => action.command.type === 'endActionPhase'); const endBuy = game.legalActions.find((action) => action.command.type === 'endBuyPhase');
  return <main className="game-shell"><header className="game-header"><div><p className="eyebrow">First to reduce health to 0</p><h1>Hexdeck</h1></div><div className="health-score"><strong>{playerName(game, 'ochre')} {game.fighters.ochre.health}</strong><span>—</span><strong>{game.fighters.indigo.health} {playerName(game, 'indigo')}</strong></div><button onClick={onNew}>New game</button></header>
    <div className="turn-banner" role="status">{game.winner ? (local ? `${playerName(game, game.winner)} wins` : game.winner === game.humanPlayerId ? 'You win' : 'AI wins') : preview ? (local ? `Turn ${game.turn} · ${actorName} action preview` : `Turn ${game.turn} · action preview`) : local ? `Turn ${game.turn} · ${actorName} ${game.phase}` : localTurn ? `Turn ${game.turn} · your ${game.phase}` : `Turn ${game.turn} · AI ${game.phase} · ${aiStatus} · ${aiElapsed}s`}</div>
    {error && <p role="alert" className="error">{error}</p>}{!local && aiError && <p role="alert" className="error">{aiError} <button onClick={() => void onRetry()}>Retry AI</button></p>}{!local && game.lastAiSummary && <p className="panel"><strong>AI:</strong> {game.lastAiSummary}</p>}
    <section className="panel arena-panel"><div className="range-label" data-testid="range">{game.range} range</div><Board game={game} /></section>
    <section className="panel controls"><button disabled={!game.canUndo || busy} onClick={() => void revisionAction('undo')}>Undo</button><button className="primary" disabled={!game.canConfirm || busy} onClick={() => void revisionAction('confirm')}>Confirm</button>{endAction && <button onClick={() => void act(endAction)}>End Action phase</button>}{endBuy && <button onClick={() => void act(endBuy)}>End Buy phase</button>}{game.previewHidesDraws && <span data-testid="hidden-preview-draw">Drawn cards reveal after confirmation.</span>}</section>
    <section className="panel zones"><div>Draw <strong>{actor.zoneCounts.draw}</strong></div><div>Discard <strong>{actor.zoneCounts.discard}</strong></div><div>Played <strong>{actor.zoneCounts.play}</strong></div><div data-testid="zone-trash">Trash <strong>{game.trashCount}</strong></div><div data-testid="zone-money">Money <strong>{actor.money}</strong></div></section>
    <section className="panel hand-panel"><h2>{local ? `${actorName} hand` : 'Your hand'}</h2><div className="card-row">{actor.hand?.map((card) => {
      if (!card.definitionId) return <div className="card card--hidden" key={card.id} data-testid="hidden-card">Drawn card hidden</div>;
      const definition = game.cards[card.definitionId]!; const info = availability.get(card.id); const selected = trash.includes(card.id);
      return <button key={card.id} className={`card card--${definition.type}${selected ? ' card--target' : ''}${movementCard === card.id ? ' card--selected' : ''}`}  data-card-name={definition.name} data-card-instance-id={card.id} disabled={busy || preview || (!info?.enabled && !cullCard) || (Boolean(cullCard) && !availability.get(cullCard!)?.eligibleCardInstanceIds.includes(card.id))} title={info?.reason ?? undefined} onClick={() => cullCard ? toggleTrash(card.id) : chooseCard(card.id)}><span className="card__cost">{definition.cost}</span><strong>{definition.name}</strong><small>{definition.text}</small>{!info?.enabled && definition.type === 'action' && <em>{info?.reason}</em>}</button>;
    })}</div>{cullCard && <div className="cull-controls"><p>Select exactly two cards. {trash.length}/2 selected.</p><button disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>Preview Cull</button><button onClick={() => { setCullCard(null); setTrash([]); }}>Cancel</button></div>}
    {movementCard && <div className="movement-choices">{cardActions(movementCard).map((action) => <button key={action.id} disabled={preview} onClick={() => void act(action)}>{action.label}</button>)}<button onClick={() => setMovementCard(null)}>Cancel</button></div>}</section>
    <Market game={game} busy={busy || preview} onAction={act} /><Builds game={game} /><Purchases game={game} /><History game={game} />
  </main>;
}
function Market({ game, busy, onAction }: { game: SafeGameView; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  const buys = new Map(game.legalActions.flatMap((action) => action.command.type === 'buyCard' ? [[action.command.definitionId, action] as const] : []));
  return <section className="panel market-panel"><h2>Market</h2><div className="market-grid">{Object.values(game.cards).map((card) => { const action = buys.get(card.id); return <button key={card.id} data-market-card={card.name} className="market-card" disabled={busy || !action} onClick={() => action && void onAction(action)}><span className="market-card__cost">{card.cost}</span><strong>{card.name}</strong><small>{card.text}</small><span className="market-card__count">{card.type === 'action' ? `${game.supply[card.id]} left` : '∞'}</span></button>; })}</div></section>;
}
function Builds({ game }: { game: SafeGameView }) { if (!game.completedBuilds) return null; return <section className="panel builds"><h2>Starting builds</h2><p>{playerName(game, 'ochre')}: {game.completedBuilds.ochre.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p><p>{playerName(game, 'indigo')}: {game.completedBuilds.indigo.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p></section>; }
function Purchases({ game }: { game: SafeGameView }) { return <section className="panel purchases"><h2>Purchases</h2><p data-testid="human-purchases">{playerName(game, 'ochre')}: {game.players.ochre.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p><p data-testid="ai-purchases">{playerName(game, 'indigo')}: {game.players.indigo.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p></section>; }
function playerName(game: SafeGameView, playerId: PlayerId): string { if (game.opponentMode === 'local') return playerId === 'ochre' ? 'Player 1' : 'Player 2'; return playerId === game.humanPlayerId ? 'You' : 'AI'; }
function History({ game }: { game: SafeGameView }) { return <section className="panel history-panel"><h2>History</h2><ol>{game.events.slice(-30).reverse().map((event) => <li key={event.sequence} data-event-type={event.type}><span>{event.playerId}</span><strong>{eventText(game, event.type, event.detail)}</strong></li>)}</ol></section>; }
function eventText(game: SafeGameView, type: string, detail: Record<string, unknown>): string { if (type === 'cardPlayed') return `Played ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'purchase') return `Bought ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'damage') return `Dealt ${String(detail.amount)} damage`; if (type === 'move') return `Moved to space ${String(detail.to)}`; return type.replace(/([A-Z])/g, ' $1'); }
function samePair(left: [string, string], right: string[]): boolean { return left.every((id) => right.includes(id)) && right.every((id) => left.includes(id)); }
