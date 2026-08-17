import { useEffect, useState } from 'react';
import type { CardDefinition, LegalAction, PlayerId } from '../game';
import type { OpponentMode, SafeGameView, StrategyPreset } from '../shared/api';
import { createGame, getAiTurnStatus, getStrategies, loadGame, startAiTurn, takeAction, undoAction, updateBuild } from './api';
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
  useEffect(() => { const preset = strategies.find((strategy) => strategy.id === id) ?? strategies[0]; if (preset) setMarkdown(preset.markdown); }, [id, strategies]);
  const local = opponentMode === 'local';
  return <main className="setup-shell"><section className="setup-card"><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1><p className="lede">Build a deck, control distance, and reduce the opponent to 0 health.</p>
    <fieldset><legend>Opponent</legend><label><input type="radio" checked={!local} onChange={() => setOpponentMode('ai')} /> AI</label><label><input type="radio" checked={local} onChange={() => setOpponentMode('local')} /> Local player</label></fieldset>
    {!local && <><label>AI strategy<select aria-label="AI strategy" value={selected?.id ?? ''} onChange={(event) => setId(event.target.value)}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
    <label>Strategy instructions<textarea aria-label="Strategy instructions" rows={10} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /></label></>}
    <fieldset><legend>First player</legend><label><input type="radio" checked={first === 'ochre'} onChange={() => setFirst('ochre')} /> {local ? 'Player 1' : 'Human'}</label><label><input type="radio" checked={first === 'indigo'} onChange={() => setFirst('indigo')} /> {local ? 'Player 2' : 'AI'}</label></fieldset>
    <label>Seed (optional)<input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></label>{error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={!selected || (!local && !markdown.trim())} onClick={() => void onStart({ strategyPresetId: selected?.id ?? id, strategyMarkdown: markdown || '# Local game', firstPlayerId: first, opponentMode, ...(seed ? { seed: Number(seed) } : {}) })}>Start game</button>
  </section></main>;
}

function Match({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (error: string | null) => void; onNew: () => void }) {
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'error'>('idle'); const [aiError, setAiError] = useState<string | null>(null); const [attempt, setAttempt] = useState(0); const [aiElapsed, setAiElapsed] = useState(0);
  const aiActive = game.opponentMode === 'ai' && game.activePlayerId === game.aiPlayerId && !game.winner;
  useEffect(() => {
    if (!aiActive) { setAiStatus('idle'); setAiError(null); setAiElapsed(0); return; }
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; const elapsedTimer = setInterval(() => setAiElapsed((value) => value + 1), 1000);
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
  async function retryAi() { setAiStatus('running'); setAiError(null); try { await startAiTurn(game.id); setAttempt((value) => value + 1); } catch (cause) { setAiStatus('error'); setAiError(cause instanceof Error ? cause.message : 'AI failed.'); } }
  if (game.phase === 'startingBuild' && (game.opponentMode === 'local' || game.activePlayerId === game.humanPlayerId)) return <StartingBuild game={game} error={error} onGame={onGame} onError={onError} onNew={onNew} />;
  if (game.phase === 'startingBuild') return <main className="setup-shell"><section className="setup-card"><h1>AI is building…</h1><p>Your build is locked. The AI cannot see it.</p><p data-testid="ai-elapsed">{aiElapsed}s elapsed</p>{aiError && <p role="alert" className="error">{aiError}</p>}<button disabled={aiStatus !== 'error'} onClick={() => void retryAi()}>Retry AI</button></section></main>;
  return <Game game={game} error={error} aiStatus={aiStatus} aiElapsed={aiElapsed} aiError={aiError} onGame={onGame} onError={onError} onNew={onNew} onRetry={retryAi} />;
}

function StartingBuild({ game, error, onGame, onError, onNew }: { game: SafeGameView; error: string | null; onGame: (game: SafeGameView) => void; onError: (value: string | null) => void; onNew: () => void }) {
  const [saving, setSaving] = useState(false); const proposal = game.humanBuildProposal; const cost = proposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0); const quantities = new Map<string, number>(); for (const id of proposal) quantities.set(id, (quantities.get(id) ?? 0) + 1);
  async function save(next: string[], complete = false) { if (saving) return; setSaving(true); onError(null); try { onGame(await updateBuild(game, next, complete)); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); } finally { setSaving(false); } }
  const builderName = game.opponentMode === 'local' ? (game.activePlayerId === 'ochre' ? 'Player 1' : 'Player 2') : 'Your';
  return <main className="build-shell"><header><div><p className="eyebrow">{builderName} starting build</p><h1>Spend up to 12</h1></div><div className="budget" data-testid="build-budget">{cost} spent · {12 - cost} carries</div><button onClick={onNew}>New game</button></header>{error && <p role="alert" className="error">{error}</p>}
    <div className="market-grid">{Object.values(game.cards).map((card) => <article className="market-card" key={card.id} data-card-name={card.name}><CardFace card={card} /><div className="quantity"><button aria-label={`Remove ${card.name}`} disabled={saving || !quantities.get(card.id)} onClick={() => { const index = proposal.lastIndexOf(card.id); void save(proposal.filter((_, position) => position !== index)); }}>−</button><span aria-label={`${card.name} quantity`}>{quantities.get(card.id) ?? 0}</span><button aria-label={`Add ${card.name}`} disabled={saving} onClick={() => void save([...proposal, card.id])}>+</button></div></article>)}</div>
    <footer className="build-footer"><p>Base deck: 7 Copper. Chosen cards: {proposal.map((id) => game.cards[id]?.name).join(', ') || 'none'}.{saving ? ' Saving…' : ''}</p><button className="primary" disabled={saving || cost > 12} onClick={() => void save(proposal, true)}>Finish starting build</button></footer>
  </main>;
}

function Game({ game, error, aiStatus, aiElapsed, aiError, onGame, onError, onNew, onRetry }: { game: SafeGameView; error: string | null; aiStatus: string; aiElapsed: number; aiError: string | null; onGame: (game: SafeGameView) => void; onError: (value: string | null) => void; onNew: () => void; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [cullCard, setCullCard] = useState<string | null>(null); const [movementCard, setMovementCard] = useState<string | null>(null); const [trash, setTrash] = useState<string[]>([]);
  const local = game.opponentMode === 'local'; const actor = game.players[game.viewPlayerId]; const availability = new Map(game.actionAvailability.map((item) => [item.cardInstanceId, item])); const actorName = playerName(game, game.viewPlayerId);
  async function act(action: LegalAction) { setBusy(true); onError(null); try { onGame(await takeAction(game, action.id)); setCullCard(null); setMovementCard(null); setTrash([]); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); } finally { setBusy(false); } }
  async function undo() { setBusy(true); onError(null); try { onGame(await undoAction(game)); setCullCard(null); setMovementCard(null); setTrash([]); } catch (cause) { onError(cause instanceof Error ? cause.message : 'Undo failed.'); } finally { setBusy(false); } }
  const cardActions = (id: string) => game.legalActions.filter((action) => 'cardInstanceId' in action.command && action.command.cardInstanceId === id);
  function chooseCard(id: string) {
    const info = availability.get(id); if (!info?.enabled) return;
    if (info.selection === 'trashOneOrTwo') { setCullCard(id); setMovementCard(null); setTrash([]); return; }
    if (info.selection === 'movement') { setMovementCard(id); setCullCard(null); return; }
    const actions = cardActions(id); if (actions.length === 1) void act(actions[0]!);
  }
  function toggleTrash(id: string) { setTrash((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 2 ? [...current, id] : current); }
  const cullAction = cullCard && trash.length >= 1 && trash.length <= 2 ? cardActions(cullCard).find((action) => action.command.type === 'playCull' && sameSelection(action.command.trashInstanceIds, trash)) : undefined;
  const endAction = game.legalActions.find((action) => action.command.type === 'endActionPhase'); const endBuy = game.legalActions.find((action) => action.command.type === 'endBuyPhase');
  const turnText = game.winner ? (local ? `${playerName(game, game.winner)} wins` : game.winner === game.humanPlayerId ? 'You win' : 'AI wins') : local ? `Turn ${game.turn} · ${actorName} ${game.phase}` : game.activePlayerId === game.humanPlayerId ? `Turn ${game.turn} · your ${game.phase}` : `Turn ${game.turn} · AI ${game.phase} · ${aiStatus} · ${aiElapsed}s`;
  return <main className="game-shell"><header className="game-header"><div><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1></div><FighterScore game={game} /><button onClick={onNew}>New game</button></header>
    <div className="play-bar"><div className="turn-banner" role="status">{turnText}</div><div className="phase-controls"><strong data-testid="zone-money">{local ? `${actorName} money` : 'Money'}: {actor.money}</strong><button disabled={!game.canUndo || busy} onClick={() => void undo()}>Undo last action</button>{endAction && <button className="primary" disabled={busy} onClick={() => void act(endAction)}>End Action phase</button>}{endBuy && <button className="primary" disabled={busy} onClick={() => void act(endBuy)}>End Buy phase</button>}</div></div>
    {error && <p role="alert" className="error">{error}</p>}{!local && aiError && <p role="alert" className="error">{aiError} <button onClick={() => void onRetry()}>Retry AI</button></p>}{!local && game.lastAiSummary && <p className="ai-summary"><strong>AI:</strong> {game.lastAiSummary}</p>}
    <section className="arena-panel"><div className="range-label" data-testid="range">{game.range} range</div><Board game={game} /></section>
    <section className="zones"><div>Draw <strong>{actor.zoneCounts.draw}</strong></div><div>Discard <strong>{actor.zoneCounts.discard}</strong></div><div>Played <strong>{actor.zoneCounts.play}</strong></div><div data-testid="zone-trash">Trash <strong>{game.trashCount}</strong></div></section>
    <section className="panel hand-panel"><div className="section-heading"><h2>{local ? `${actorName} hand` : 'Your hand'}</h2><span>{actor.zoneCounts.hand} cards</span></div><div className="card-row" data-testid="hand-grid">{actor.hand?.map((card) => {
      const definition = game.cards[card.definitionId]!; const info = availability.get(card.id); const selected = trash.includes(card.id);
      return <button key={card.id} className={`card card--${definition.type}${selected ? ' card--target' : ''}${movementCard === card.id ? ' card--selected' : ''}`} data-card-name={definition.name} data-card-instance-id={card.id} disabled={busy || (!info?.enabled && !cullCard) || (Boolean(cullCard) && !availability.get(cullCard!)?.eligibleCardInstanceIds.includes(card.id))} title={info?.reason ?? undefined} onClick={() => cullCard ? toggleTrash(card.id) : chooseCard(card.id)}><CardFace card={definition} />{!info?.enabled && definition.type === 'action' && <em>{info?.reason}</em>}</button>;
    })}</div>{cullCard && <div className="choice-bar"><p>Select 1 or 2 cards: Cull itself, cards remaining in your hand, or both. {trash.length} selected (maximum 2).</p><button className="primary" disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>{trash.length === 1 ? 'Trash selected card' : 'Trash selected cards'}</button><button onClick={() => { setCullCard(null); setTrash([]); }}>Cancel</button></div>}
    {movementCard && <div className="choice-bar"><strong>Choose movement</strong>{cardActions(movementCard).map((action) => <button key={action.id} disabled={busy} onClick={() => void act(action)}>{action.label}</button>)}<button onClick={() => setMovementCard(null)}>Cancel</button></div>}</section>
    <DeckSummary game={game} playerId={game.viewPlayerId} /><Market game={game} busy={busy} onAction={act} /><Builds game={game} /><Purchases game={game} /><History game={game} />
  </main>;
}

function CardFace({ card }: { card: CardDefinition }) { return <><span className="card__cost">{card.cost}</span><strong>{card.name}</strong>{card.money && <span className="money-value">+{card.money} money</span>}<small>{card.text}</small></>; }
function FighterScore({ game }: { game: SafeGameView }) { return <div className="health-score">{(['ochre', 'indigo'] as const).map((id) => { const fighter = game.fighters[id]; return <div key={id} className={`score score--${id}`} data-player-score={id}><strong>{playerName(game, id)}</strong><span>{fighter.health} HP</span><small>{[fighter.aimed ? 'Aimed' : '', fighter.exposed ? 'Next Close-range attack this turn: +2 damage' : ''].filter(Boolean).join(' · ') || 'Ready'}</small></div>; })}</div>; }
function DeckSummary({ game, playerId }: { game: SafeGameView; playerId: PlayerId }) { const counts = game.players[playerId].deckCounts; if (!counts) return null; const entries = Object.entries(counts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right)); return <section className="panel deck-summary" data-testid="deck-summary"><h2>Deck</h2><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}>{game.cards[id]?.name ?? id} ×{count}</span>)}</div></section>; }
function Market({ game, busy, onAction }: { game: SafeGameView; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) { const buys = new Map(game.legalActions.flatMap((action) => action.command.type === 'buyCard' ? [[action.command.definitionId, action] as const] : [])); return <section className="panel market-panel"><div className="section-heading"><h2>Market</h2><span>Bought cards go to discard.</span></div><div className="market-grid">{Object.values(game.cards).map((card) => { const action = buys.get(card.id); return <button key={card.id} data-market-card={card.name} className="market-card" disabled={busy || !action} onClick={() => action && void onAction(action)}><CardFace card={card} /><span className="market-card__count">{card.type === 'action' ? `${game.supply[card.id]} left` : '∞'}</span></button>; })}</div></section>; }
function Builds({ game }: { game: SafeGameView }) { if (!game.completedBuilds) return null; return <section className="panel builds"><h2>Starting builds</h2><p>{playerName(game, 'ochre')}: {game.completedBuilds.ochre.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p><p>{playerName(game, 'indigo')}: {game.completedBuilds.indigo.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p></section>; }
function Purchases({ game }: { game: SafeGameView }) { return <section className="panel purchases"><h2>Purchases</h2><p data-testid="human-purchases">{playerName(game, 'ochre')}: {game.players.ochre.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p><p data-testid="ai-purchases">{playerName(game, 'indigo')}: {game.players.indigo.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p></section>; }
function playerName(game: SafeGameView, playerId: PlayerId): string { if (game.opponentMode === 'local') return playerId === 'ochre' ? 'Player 1' : 'Player 2'; return playerId === game.humanPlayerId ? 'You' : 'AI'; }
function History({ game }: { game: SafeGameView }) { return <section className="panel history-panel"><h2>History</h2><ol>{game.events.slice(-30).reverse().map((event) => <li key={event.sequence} data-event-type={event.type}><span>{playerName(game, event.playerId)}</span><strong>{eventText(game, event.type, event.detail)}</strong></li>)}</ol></section>; }
function eventText(game: SafeGameView, type: string, detail: Record<string, unknown>): string { if (type === 'cardPlayed') return `Played ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'purchase') return `Bought ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'damage') return `Dealt ${String(detail.amount)} damage`; if (type === 'move' && detail.source === 'drive') return `Moved both fighters ${String(detail.movement)} to space ${String(detail.to)}`; if (type === 'move' && detail.movement === 'stay') return `Stayed on space ${String(detail.to)}`; if (type === 'move') return `Moved to space ${String(detail.to)}`; if (type === 'wallCollision') return `Wall blocked ${String(detail.direction)}; neither fighter moved`; return type.replace(/([A-Z])/g, ' $1'); }
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
