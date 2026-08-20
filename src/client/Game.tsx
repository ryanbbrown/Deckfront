import { useEffect, useRef, useState } from 'react';
import { STARTING_BUDGET, firstBuyCarry } from '../game';
import type { CardDefinition, CardInstance, PlayerId } from '../game';
import type { BrowserAction, GameMode, GameView, SetupCatalog } from '../shared/api';
import { takeAction, undoAction, updateBuild } from './api';
import { Board } from './Board';

interface GameProps { game: GameView; error: string | null; onGame: (game: GameView) => void; onError: (value: string | null) => void; onNew: () => void }
interface CardGroup { definitionId: string; instances: CardInstance[] }
interface PlayedGroup extends CardGroup { firstOrder: number; lastOrder: number }

export function PreviewTable({ catalog, market, error, onRefresh, onStart }: {
  catalog: SetupCatalog; market: string[]; error: string | null; onRefresh: () => void;
  onStart: (mode: GameMode, humanPlayerId?: PlayerId) => Promise<void>;
}) {
  const [mode, setMode] = useState<GameMode>('local');
  const [human, setHuman] = useState<PlayerId>('ochre');
  const [marketOpen, setMarketOpen] = useState(false);
  const cards = Object.fromEntries([...catalog.fixedCardIds, ...market].map((id) => [id, catalog.cards[id]!]));
  return <main className="table-shell table-shell--preview">
    <TableHeader title="Choose a kingdom" controls={<div className="setup-controls">
      <label><input type="radio" checked={mode === 'local'} onChange={() => setMode('local')} /> Local players</label>
      <label><input type="radio" checked={mode === 'ai'} onChange={() => setMode('ai')} /> Play against AI</label>
      {mode === 'ai' ? <fieldset><legend>Turn order</legend><label><input type="radio" checked={human === 'ochre'} onChange={() => setHuman('ochre')} /> I go first</label><label><input type="radio" checked={human === 'indigo'} onChange={() => setHuman('indigo')} /> AI goes first</label></fieldset> : null}
      <button className="control-button" onClick={onRefresh}>Refresh market</button>
      <button className="control-button" onClick={() => setMarketOpen(true)}>View cards</button>
      <button className="control-button primary" onClick={() => void onStart(mode, mode === 'ai' ? human : undefined)}>Start game</button>
    </div>} />
    {error ? <p role="alert" className="error">{error}</p> : null}
    <PreviewArena />
    <CompactMarket cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onView={() => setMarketOpen(true)} />
    <EmptyPlayed />
    <section className="hand-panel table-zone"><div className="zone-title"><h2>Your hand</h2><span>Cards appear here after both starting builds.</span></div><div className="hand-row"><p className="empty-row">Start the game to build your deck.</p></div></section>
    <EdgeButtons />
    {marketOpen ? <MarketDialog cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onClose={() => setMarketOpen(false)} /> : null}
  </main>;
}

export function Game({ game, error, onGame, onError, onNew }: GameProps) {
  const [busy, setBusy] = useState(false);
  const [cullCard, setCullCard] = useState<string | null>(null);
  const [movementCard, setMovementCard] = useState<string | null>(null);
  const [trash, setTrash] = useState<string[]>([]);
  const [deckOpen, setDeckOpen] = useState(false);
  const [opponentOpen, setOpponentOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const actor = game.players[game.activePlayerId];
  const actorName = playerName(game.activePlayerId);
  const availability = new Map(game.actions.cards.map((item) => [item.cardInstanceId, item]));
  const handGroups = groupCards(actor.hand);
  const playedGroups = groupPlayedCards(actor.played);
  const proposalCost = game.buildProposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0);

  async function act(action: Pick<BrowserAction, 'id'>) {
    setBusy(true); onError(null);
    try { onGame(await takeAction(game, action.id)); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  async function saveBuild(next: string[], complete = false) {
    if (busy) return; setBusy(true); onError(null);
    try { onGame(await updateBuild(game, next, complete)); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); }
    finally { setBusy(false); }
  }
  async function undo() {
    setBusy(true); onError(null);
    try { onGame(await undoAction(game)); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Undo failed.'); }
    finally { setBusy(false); }
  }
  function clearChoice() { setCullCard(null); setMovementCard(null); setTrash([]); }
  function chooseCard(id: string) {
    const info = availability.get(id); if (!info?.enabled) return;
    if (info.selection === 'trashOneOrTwo') { setCullCard(id); setMovementCard(null); setTrash([]); return; }
    if (info.selection === 'movement') { setMovementCard(id); setCullCard(null); return; }
    if (info.actionId) void act({ id: info.actionId });
  }
  function toggleTrashGroup(instanceIds: string[]) {
    const eligible = new Set(cullCard ? availability.get(cullCard)?.eligibleCardInstanceIds ?? [] : []);
    const candidates = instanceIds.filter((id) => eligible.has(id));
    setTrash((current) => {
      const selectedHere = candidates.filter((id) => current.includes(id));
      if (selectedHere.length === candidates.length || current.length >= 2) return current.filter((id) => !candidates.includes(id));
      const next = candidates.find((id) => !current.includes(id));
      return next && current.length < 2 ? [...current, next] : current;
    });
  }
  const cullAction = cullCard && trash.length >= 1 && trash.length <= 2
    ? availability.get(cullCard)?.choices.find((action) => sameSelection(action.targetCardInstanceIds, trash)) : undefined;
  const endAction = game.actions.phases.find((action) => action.kind === 'endAction');
  const endBuy = game.actions.phases.find((action) => action.kind === 'endBuy');
  const turnText = game.winner ? `${playerName(game.winner)} wins`
    : game.phase === 'startingBuild' ? `${actorName} starting build`
      : `Turn ${game.turn} · ${actorName} ${game.phase}`;
  const buys = new Map(game.actions.buys.map((action) => [action.definitionId, action]));
  const marketAction = (id: string): void => {
    if (game.phase === 'startingBuild') void saveBuild([...game.buildProposal, id]);
    else { const buy = buys.get(id); if (buy) void act(buy); }
  };
  return <main className="table-shell">
    <TableHeader title={turnText} controls={<div className="phase-controls">
      {game.phase === 'startingBuild' ? <><strong data-testid="build-budget">{proposalCost} / {STARTING_BUDGET} · {firstBuyCarry(proposalCost)} carries</strong><button className="control-button primary" disabled={busy || proposalCost > STARTING_BUDGET} onClick={() => void saveBuild(game.buildProposal, true)}>Finish starting build</button></> : <>
        <strong data-testid="zone-money">{actorName} money: {actor.money}</strong>
        <button className="control-button" disabled={!game.canUndo || busy} onClick={() => void undo()}>Undo last action</button>
        {endAction ? <button className="control-button primary" disabled={busy} onClick={() => void act(endAction)}>End Action phase</button> : null}
        {endBuy ? <button className="control-button primary" disabled={busy} onClick={() => void act(endBuy)}>End Buy phase</button> : null}
      </>}
      <button className="control-button" onClick={onNew}>New game</button>
    </div>} />
    {error ? <p role="alert" className="error">{error}</p> : null}
    <section className="arena-zone table-zone"><div className="range-label" data-testid="range">{game.range} · {Math.abs(game.fighters.ochre.position - game.fighters.indigo.position)} {Math.abs(game.fighters.ochre.position - game.fighters.indigo.position) === 1 ? 'space' : 'spaces'}</div><Board game={game} /></section>
    {game.phase === 'startingBuild' ? <div className="build-strip"><strong>{actorName} selected</strong><div>{game.buildProposal.map((id, index) => <button key={`${id}-${index}`} aria-label={`Remove ${game.cards[id]?.name}`} onClick={() => void saveBuild(game.buildProposal.filter((_, position) => position !== index))}>{game.cards[id]?.name} ×</button>)}</div><span>{game.buildProposal.length ? 'Click a selected card to remove it.' : 'Click market piles to add cards.'}</span></div> : null}
    {game.actions.selection ? <div className="choice-bar"><strong>{game.actions.selection.kind === 'discard' ? 'Choose a card to discard' : 'Choose a card to recover'}</strong><div>{game.actions.selection.choices.map((action) => <button className="choice-button" key={action.id} aria-label={action.label} disabled={busy} onClick={() => void act(action)}>{action.text}</button>)}</div></div> : null}
    <CompactMarket cards={game.cards} fixedIds={game.fixedCardIds} variableIds={game.variableCardIds} supply={game.supply} onView={() => setMarketOpen(true)} onCard={marketAction} enabled={(id) => game.phase === 'startingBuild' ? !busy : Boolean(buys.get(id)) && !busy} />
    <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2><span>Numbers show play order.</span></div><div className="played-row" data-testid="played-row">{playedGroups.length ? playedGroups.map((group) => <PlayedCard key={group.instances[0]!.id} card={game.cards[group.definitionId]!} group={group} />) : <p className="empty-row">Cards move here from your hand.</p>}</div></section>
    <section className="hand-panel table-zone"><div className="zone-title"><h2>{actorName} hand</h2><span>{actor.zoneCounts.hand} physical cards</span></div><div className="hand-row" data-testid="hand-grid">{handGroups.map((group, index) => {
      const enabledInstance = group.instances.find((card) => availability.get(card.id)?.enabled) ?? group.instances[0]!;
      const info = availability.get(enabledInstance.id);
      const targetIds = cullCard ? group.instances.filter((card) => availability.get(cullCard)?.eligibleCardInstanceIds.includes(card.id)).map((card) => card.id) : [];
      const selectedCount = group.instances.filter((card) => trash.includes(card.id)).length;
      const disabled = busy || (cullCard ? targetIds.length === 0 : !info?.enabled);
      return <div className="hand-card-slot" key={group.definitionId} style={{ zIndex: index + 1 }}>{group.instances.length > 1 ? <span className="quantity-badge" data-testid={`hand-count-${group.definitionId}`}>×{group.instances.length}</span> : null}<button className={`card full-card card--${game.cards[group.definitionId]!.family}${selectedCount ? ' card--target' : ''}${movementCard === enabledInstance.id || cullCard === enabledInstance.id ? ' card--selected' : ''}`} data-card-name={game.cards[group.definitionId]!.name} data-card-instance-id={enabledInstance.id} data-card-count={group.instances.length} disabled={disabled} title={!cullCard ? info?.reason ?? undefined : undefined} onClick={() => cullCard ? toggleTrashGroup(targetIds) : chooseCard(enabledInstance.id)}><CardFace card={game.cards[group.definitionId]!} />{selectedCount ? <span className="selected-count">Selected ×{selectedCount}</span> : null}{!info?.enabled && !cullCard && game.cards[group.definitionId]!.type === 'action' ? <em>{info?.reason}</em> : null}</button></div>;
    })}</div>{cullCard ? <div className="choice-bar choice-bar--overlay"><p>Select 1 or 2 cards. Click a grouped card twice to select two physical copies. {trash.length} selected (maximum 2).</p><div><button className="control-button primary" disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>{trash.length === 1 ? 'Trash selected card' : 'Trash selected cards'}</button><button className="control-button" onClick={clearChoice}>Cancel</button></div></div> : null}{movementCard ? <div className="choice-bar choice-bar--overlay"><strong>Choose movement</strong><div>{(availability.get(movementCard)?.choices ?? []).map((action) => <button className="choice-button" key={action.id} aria-label={action.label} disabled={busy} onClick={() => void act(action)}>{action.text}</button>)}<button className="control-button" onClick={clearChoice}>Cancel</button></div></div> : null}</section>
    <button className="edge-toggle edge-toggle--deck" aria-expanded={deckOpen} onClick={() => setDeckOpen((open) => !open)}>Deck · {Object.values(actor.deckCounts).reduce((total, count) => total + count, 0)}</button>
    <button className="edge-toggle edge-toggle--opponent" aria-expanded={opponentOpen} onClick={() => setOpponentOpen((open) => !open)}>{game.mode === 'ai' ? 'AI' : 'Opponent'}</button>
    <aside className={`side-drawer side-drawer--deck${deckOpen ? ' side-drawer--open' : ''}`} aria-label="Deck and match details"><DrawerHeader title="Deck and zones" onClose={() => setDeckOpen(false)} /><Zones game={game} actor={actor} /><DeckSummary game={game} playerId={game.activePlayerId} /><Builds game={game} /><Purchases game={game} /><History game={game} /></aside>
    <aside className={`side-drawer side-drawer--opponent${opponentOpen ? ' side-drawer--open' : ''}`} aria-label="Opponent details"><DrawerHeader title={game.mode === 'ai' ? 'AI opponent' : 'Opponent'} onClose={() => setOpponentOpen(false)} /><section className="drawer-section"><p>{game.mode === 'ai' ? 'AI turns resolve automatically.' : 'Pass the screen to the other local player.'}</p>{game.training ? <p>Strategy {game.training.strategyId}</p> : null}</section></aside>
    {marketOpen ? <MarketDialog cards={game.cards} fixedIds={game.fixedCardIds} variableIds={game.variableCardIds} onClose={() => setMarketOpen(false)} /> : null}
  </main>;
}

function TableHeader({ title, controls }: { title: string; controls: React.ReactNode }) { return <header className="table-header"><div className="brand"><span>Distance duel</span><h1>Hexdeck</h1></div><div className="turn-banner" role="status">{title}</div>{controls}</header>; }
function PreviewArena() { return <section className="arena-zone table-zone"><div className="range-label">Near · 1 space</div><div className="arena" role="img" aria-label="Five space line arena">{[1,2,3,4,5].map((space) => <div className="arena-space" key={space}><span>{space}</span>{space === 2 ? <div className="fighter fighter--ochre">P1<small>37 HP</small></div> : null}{space === 3 ? <div className="fighter fighter--indigo">P2<small>40 HP</small></div> : null}</div>)}</div></section>; }
function EmptyPlayed() { return <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2></div><div className="played-row"><p className="empty-row">Cards move here from your hand.</p></div></section>; }
function EdgeButtons() { return <><button className="edge-toggle edge-toggle--deck" disabled>Deck</button><button className="edge-toggle edge-toggle--opponent" disabled>Opponent</button></>; }

function CompactMarket({ cards, fixedIds, variableIds, supply, onView, onCard, enabled }: {
  cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[];
  supply?: Record<string, number>; onView: () => void; onCard?: (id: string) => void; enabled?: (id: string) => boolean;
}) {
  const row = (ids: readonly string[]) => <div className="compact-market__row">{ids.map((id) => { const card = cards[id]; if (!card) return null; return <button key={id} data-market-card={card.name} className={`compact-pile pile--${card.family}`} disabled={onCard ? !enabled?.(id) : false} aria-disabled={onCard ? undefined : true} onClick={() => onCard?.(id)}><strong>{card.name}</strong><span className="compact-pile__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span>{supply ? <small>{card.type === 'action' ? `${supply[id]} left` : '∞'}</small> : null}</button>; })}</div>;
  return <section className="market-zone table-zone"><div className="zone-title"><h2>Market</h2><button className="text-button" onClick={onView}>View all cards</button></div><div className="market-group"><span>Fixed</span>{row(fixedIds)}</div><div className="market-group"><span>Kingdom</span>{row(variableIds)}</div></section>;
}

function MarketDialog({ cards, fixedIds, variableIds, onClose }: { cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); const close = () => onClose(); dialog?.addEventListener('close', close); return () => dialog?.removeEventListener('close', close); }, [onClose]);
  const ids = [...fixedIds, ...variableIds];
  return <dialog ref={ref} className="market-dialog" onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}><div className="market-dialog__surface"><header><div><span>Complete market</span><h2>Card reference</h2></div><button aria-label="Close market" onClick={() => ref.current?.close()}>×</button></header><div className="market-dialog__grid">{ids.map((id) => <article key={id} className={`card full-card reference-card card--${cards[id]!.family}`} data-card-name={cards[id]!.name}><CardFace card={cards[id]!} /></article>)}</div></div></dialog>;
}

export function CardFace({ card, indicators }: { card: CardDefinition; indicators?: React.ReactNode }) { return <><span className="card__header"><strong className="card__title">{card.name}</strong><span className="card__meta">{indicators}<span className="card__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span></span></span><span className="card__image" aria-hidden="true" /><span className="card__rules">{card.money ? <b>+{card.money} money</b> : null}<small>{card.text}</small></span></>; }
function PlayedCard({ card, group }: { card: CardDefinition; group: PlayedGroup }) { const count = group.instances.length; const order = group.firstOrder === group.lastOrder ? String(group.firstOrder) : `${group.firstOrder}–${group.lastOrder}`; return <article className={`card full-card played-card card--${card.family}`} data-played-card-name={card.name} data-card-count={count}><CardFace card={card} indicators={<><span className="play-order" aria-label={`Play order ${order}`}>{order}</span>{count > 1 ? <span className="quantity-badge quantity-badge--played" data-testid={`played-count-${card.id}`}>×{count}</span> : null}</>} /></article>; }
function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) { return <div className="drawer-heading"><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}>×</button></div>; }
function Zones({ game, actor }: { game: GameView; actor: GameView['players'][PlayerId] }) { return <section className="drawer-section zones"><h3>Zones</h3><div>Draw <strong>{actor.zoneCounts.draw}</strong></div><div>Hand <strong>{actor.zoneCounts.hand}</strong></div><div>Discard <strong>{actor.zoneCounts.discard}</strong></div><div>Played <strong>{actor.zoneCounts.play}</strong></div><div data-testid="zone-trash">Trash <strong>{game.trashCount}</strong></div></section>; }
function DeckSummary({ game, playerId }: { game: GameView; playerId: PlayerId }) { const entries = Object.entries(game.players[playerId].deckCounts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right)); return <section className="drawer-section deck-summary" data-testid="deck-summary"><h3>Composition</h3><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}>{game.cards[id]?.name ?? id} ×{count}</span>)}</div></section>; }
function Builds({ game }: { game: GameView }) { if (!game.completedBuilds) return null; return <section className="drawer-section builds"><h3>Starting builds</h3><p>Player 1: {game.completedBuilds.ochre.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p><p>Player 2: {game.completedBuilds.indigo.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p></section>; }
function Purchases({ game }: { game: GameView }) { return <section className="drawer-section purchases"><h3>Purchases</h3><p data-testid="player-one-purchases">Player 1: {game.players.ochre.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p><p data-testid="player-two-purchases">Player 2: {game.players.indigo.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p></section>; }
function History({ game }: { game: GameView }) { return <section className="drawer-section history-panel"><h3>Recent events</h3><ol>{game.events.slice(-20).reverse().map((event) => <li key={event.sequence}><span>{playerName(event.playerId)}</span><strong>{eventText(game, event.type, event.detail)}</strong></li>)}</ol></section>; }
function groupCards(cards: CardInstance[]): CardGroup[] { const groups = new Map<string, CardGroup>(); for (const card of cards) { const group = groups.get(card.definitionId); if (group) group.instances.push(card); else groups.set(card.definitionId, { definitionId: card.definitionId, instances: [card] }); } return [...groups.values()]; }
function groupPlayedCards(cards: CardInstance[]): PlayedGroup[] { const groups: PlayedGroup[] = []; for (const [index, card] of cards.entries()) { const previous = groups.at(-1); if (previous?.definitionId === card.definitionId) { previous.instances.push(card); previous.lastOrder = index + 1; } else groups.push({ definitionId: card.definitionId, instances: [card], firstOrder: index + 1, lastOrder: index + 1 }); } return groups; }
function playerName(playerId: PlayerId): string { return playerId === 'ochre' ? 'Player 1' : 'Player 2'; }
function eventText(game: GameView, type: string, detail: Record<string, unknown>): string { if (type === 'cardPlayed') return `Played ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'purchase') return `Bought ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'damage') return `Dealt ${String(detail.amount)} damage`; if (type === 'move') return `Moved to space ${String(detail.to)}`; return type.replace(/([A-Z])/g, ' $1'); }
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
