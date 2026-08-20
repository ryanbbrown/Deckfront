import { useEffect, useRef, useState } from 'react';
import { STARTING_BUDGET, firstBuyCarry } from '../game';
import type { CardDefinition, CardInstance, PlayerId } from '../game';
import { AI_DIFFICULTIES } from '../shared/api';
import type { AiDifficulty, BrowserAction, GameMode, GameView, PublicGameEvent, SetupCatalog } from '../shared/api';
import { takeAction, undoAction, updateBuild } from './api';
import { Board } from './Board';

interface GameProps { game: GameView; error: string | null; onGame: (game: GameView) => void; onError: (value: string | null) => void; onNew: () => void }
interface CardGroup { definitionId: string; instances: CardInstance[] }
type PlayedGroup = CardGroup;

export function PreviewTable({ catalog, market, error, onRefresh, onStart }: {
  catalog: SetupCatalog; market: string[]; error: string | null; onRefresh: () => void;
  onStart: (mode: GameMode, humanPlayerId?: PlayerId, aiDifficulty?: AiDifficulty) => Promise<void>;
}) {
  const [mode, setMode] = useState<GameMode>('local');
  const [human, setHuman] = useState<PlayerId>('ochre');
  const [difficulty, setDifficulty] = useState<AiDifficulty>('expert');
  const [marketOpen, setMarketOpen] = useState(false);
  const cards = Object.fromEntries([...catalog.fixedCardIds, ...market].map((id) => [id, catalog.cards[id]!]));
  return <main className="table-shell table-shell--preview">
    <TableHeader title="Choose a kingdom" controls={<div className="setup-controls">
      <label><input type="radio" checked={mode === 'local'} onChange={() => setMode('local')} /> Local players</label>
      <label><input type="radio" checked={mode === 'ai'} onChange={() => setMode('ai')} /> Play against AI</label>
      {mode === 'ai' ? <><fieldset><legend>Turn order</legend><label><input type="radio" checked={human === 'ochre'} onChange={() => setHuman('ochre')} /> I go first</label><label><input type="radio" checked={human === 'indigo'} onChange={() => setHuman('indigo')} /> AI goes first</label></fieldset><label>AI strength<select aria-label="AI strength" value={difficulty} onChange={(event) => setDifficulty(event.target.value as AiDifficulty)}>{AI_DIFFICULTIES.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label></> : null}
      <button className="control-button" onClick={onRefresh}>Refresh market</button>
      <button className="control-button" onClick={() => setMarketOpen(true)}>View cards</button>
      <button className="control-button primary" onClick={() => void onStart(mode, mode === 'ai' ? human : undefined, mode === 'ai' ? difficulty : undefined)}>Start game</button>
    </div>} />
    {error ? <p role="alert" className="error">{error}</p> : null}
    <PreviewArena />
    <CompactMarket cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onView={() => setMarketOpen(true)} />
    <EmptyPlayed />
    <section className="hand-panel table-zone"><div className="zone-title"><h2>Your hand</h2><span>Cards appear here after both starting builds.</span></div><div className="hand-row"><p className="empty-row">Start the game to build your deck.</p></div></section>
    {marketOpen ? <MarketDialog cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onClose={() => setMarketOpen(false)} /> : null}
  </main>;
}

export function Game({ game, error, onGame, onError, onNew }: GameProps) {
  const [busy, setBusy] = useState(false);
  const [cullCard, setCullCard] = useState<string | null>(null);
  const [movementCard, setMovementCard] = useState<string | null>(null);
  const [trash, setTrash] = useState<string[]>([]);
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
    <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2><span>Consecutive copies share a stack.</span></div><div className="played-row" data-testid="played-row">{playedGroups.length ? playedGroups.map((group) => <PlayedCard key={group.instances[0]!.id} card={game.cards[group.definitionId]!} group={group} />) : <p className="empty-row">Cards move here from your hand.</p>}</div></section>
    <section className="hand-panel table-zone"><div className="zone-title"><h2>{actorName} hand</h2><span>{actor.zoneCounts.hand} physical cards</span></div><div className="hand-row" data-testid="hand-grid">{handGroups.map((group, index) => {
      const enabledInstance = group.instances.find((card) => availability.get(card.id)?.enabled) ?? group.instances[0]!;
      const info = availability.get(enabledInstance.id);
      const targetIds = cullCard ? group.instances.filter((card) => availability.get(cullCard)?.eligibleCardInstanceIds.includes(card.id)).map((card) => card.id) : [];
      const selectedCount = group.instances.filter((card) => trash.includes(card.id)).length;
      const unavailable = cullCard ? targetIds.length === 0 : !info?.enabled;
      return <div className="hand-card-slot" key={group.definitionId} style={{ zIndex: index + 1 }}>{group.instances.length > 1 ? <span className="quantity-badge" data-testid={`hand-count-${group.definitionId}`}>×{group.instances.length}</span> : null}<button className={`card full-card card--${game.cards[group.definitionId]!.family}${unavailable ? ' card--unavailable' : ''}${selectedCount ? ' card--target' : ''}${movementCard === enabledInstance.id || cullCard === enabledInstance.id ? ' card--selected' : ''}`} data-card-name={game.cards[group.definitionId]!.name} data-card-instance-id={enabledInstance.id} data-card-count={group.instances.length} disabled={busy} aria-disabled={unavailable} title={!cullCard ? info?.reason ?? undefined : undefined} onClick={() => { if (unavailable) return; if (cullCard) toggleTrashGroup(targetIds); else chooseCard(enabledInstance.id); }}><CardFace card={game.cards[group.definitionId]!} />{selectedCount ? <span className="selected-count">Selected ×{selectedCount}</span> : null}{!info?.enabled && !cullCard && game.cards[group.definitionId]!.type === 'action' ? <em>{info?.reason}</em> : null}</button></div>;
    })}</div>{cullCard ? <div className="choice-bar choice-bar--overlay"><p>Select 1 or 2 cards. Click a grouped card twice to select two physical copies. {trash.length} selected (maximum 2).</p><div><button className="control-button primary" disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>{trash.length === 1 ? 'Trash selected card' : 'Trash selected cards'}</button><button className="control-button" onClick={clearChoice}>Cancel</button></div></div> : null}{movementCard ? <div className="choice-bar choice-bar--overlay"><strong>Choose movement</strong><div>{(availability.get(movementCard)?.choices ?? []).map((action) => <button className="choice-button" key={action.id} aria-label={action.label} disabled={busy} onClick={() => void act(action)}>{action.text}</button>)}<button className="control-button" onClick={clearChoice}>Cancel</button></div></div> : null}</section>
    <ActionRail game={game} />
    {marketOpen ? <MarketDialog cards={game.cards} fixedIds={game.fixedCardIds} variableIds={game.variableCardIds} onClose={() => setMarketOpen(false)} /> : null}
  </main>;
}

function TableHeader({ title, controls }: { title: string; controls: React.ReactNode }) { return <header className="table-header"><div className="brand"><span>Distance duel</span><h1>Hexdeck</h1></div><div className="turn-banner" role="status">{title}</div>{controls}</header>; }
function PreviewArena() { return <section className="arena-zone table-zone"><div className="range-label">Near · 1 space</div><div className="arena" role="img" aria-label="Five space line arena">{[1,2,3,4,5].map((space) => <div className="arena-space" key={space}><span>{space}</span>{space === 2 ? <div className="fighter fighter--ochre">P1<small>37 HP</small></div> : null}{space === 3 ? <div className="fighter fighter--indigo">P2<small>40 HP</small></div> : null}</div>)}</div></section>; }
function EmptyPlayed() { return <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2></div><div className="played-row"><p className="empty-row">Cards move here from your hand.</p></div></section>; }
function CompactMarket({ cards, fixedIds, variableIds, supply, onView, onCard, enabled }: {
  cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[];
  supply?: Record<string, number>; onView: () => void; onCard?: (id: string) => void; enabled?: (id: string) => boolean;
}) {
  const [inspection, setInspection] = useState<{ id: string; left: number; top: number } | null>(null);
  const inspectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!inspection) return;
    const dismiss = (event: PointerEvent) => { if (!inspectionRef.current?.contains(event.target as Node)) setInspection(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspection(null); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [inspection]);
  const inspect = (event: React.MouseEvent, id: string) => {
    event.preventDefault();
    setInspection({ id, left: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 156)), top: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 228)) });
  };
  const row = (ids: readonly string[]) => <div className="compact-market__row">{ids.map((id) => { const card = cards[id]; if (!card) return null; const available = Boolean(onCard && enabled?.(id)); return <span key={id} className="compact-pile-slot" onContextMenu={(event) => inspect(event, id)}><button data-market-card={card.name} className={`compact-pile pile--${card.family}`} aria-disabled={!available} onClick={() => { if (available) onCard?.(id); }}><strong>{card.name}</strong><span className="compact-pile__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span>{supply ? <small>{card.type === 'action' ? `${supply[id]} left` : '∞'}</small> : null}</button></span>; })}</div>;
  const inspectedCard = inspection ? cards[inspection.id] : null;
  return <section className="market-zone table-zone"><div className="zone-title"><h2>Market</h2><button className="text-button" onClick={onView}>View all cards</button></div><div className="market-group"><span>Fixed</span>{row(fixedIds)}</div><div className="market-group"><span>Kingdom</span>{row(variableIds)}</div>{inspection && inspectedCard ? <aside ref={inspectionRef} className="market-card-popover" role="dialog" aria-label={`${inspectedCard.name} details`} style={{ left: inspection.left, top: inspection.top }}><article className={`card full-card card--${inspectedCard.family}`}><CardFace card={inspectedCard} /></article></aside> : null}</section>;
}

function MarketDialog({ cards, fixedIds, variableIds, onClose }: { cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    const close = () => onCloseRef.current();
    dialog.addEventListener('close', close); if (!dialog.open) dialog.showModal();
    return () => dialog.removeEventListener('close', close);
  }, []);
  const ids = [...fixedIds, ...variableIds];
  return <dialog ref={ref} className="market-dialog" onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}><div className="market-dialog__surface"><header><div><span>Complete market</span><h2>Card reference</h2></div><button aria-label="Close market" onClick={() => ref.current?.close()}>×</button></header><div className="market-dialog__grid">{ids.map((id) => <article key={id} className={`card full-card reference-card card--${cards[id]!.family}`} data-card-name={cards[id]!.name}><CardFace card={cards[id]!} /></article>)}</div></div></dialog>;
}

export function CardFace({ card, indicators }: { card: CardDefinition; indicators?: React.ReactNode }) { const dense = card.text.length > 140; return <><span className="card__header"><strong className="card__title">{card.name}</strong><span className="card__meta">{indicators}<span className="card__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span></span></span><span className="card__image" aria-hidden="true" /><span className={`card__rules${dense ? ' card__rules--dense' : ''}`}>{card.money ? <b>+{card.money} money</b> : null}<small>{card.text}</small></span></>; }
function PlayedCard({ card, group }: { card: CardDefinition; group: PlayedGroup }) { const count = group.instances.length; return <article className={`card full-card played-card card--${card.family}`} data-played-card-name={card.name} data-card-count={count}><CardFace card={card} indicators={count > 1 ? <span className="quantity-badge quantity-badge--played" data-testid={`played-count-${card.id}`}>×{count}</span> : undefined} /></article>; }
function ActionRail({ game }: { game: GameView }) {
  const log = useRef<HTMLOListElement>(null);
  const newestEvent = game.events.at(-1);
  const newestEventIdentity = newestEvent ? `${newestEvent.sequence}:${newestEvent.type}:${newestEvent.playerId}:${JSON.stringify(newestEvent.detail)}` : '';
  useEffect(() => { const element = log.current; if (element) element.scrollTop = element.scrollHeight; }, [newestEventIdentity]);
  return <aside className="action-rail" aria-label="Action history and deck compositions">
    <section className="action-log"><header><span>Public record</span><h2>Actions</h2></header><ol ref={log} data-testid="action-log">{game.events.map((event) => <li key={event.sequence} className={event.type === 'turn' ? 'action-log__turn' : undefined}><span>{playerName(event.playerId)}</span><strong>{eventText(game, event)}</strong></li>)}</ol></section>
    <section className="rail-decks"><h2>Deck compositions</h2><div><DeckSummary game={game} playerId="ochre" /><DeckSummary game={game} playerId="indigo" /></div></section>
  </aside>;
}
function DeckSummary({ game, playerId }: { game: GameView; playerId: PlayerId }) { const entries = Object.entries(game.players[playerId].deckCounts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right)); return <section className={`deck-summary deck-summary--${playerId}`} data-testid={`deck-summary-${playerId}`}><h3>{playerName(playerId)}</h3><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}><span>{game.cards[id]?.name ?? id}</span><strong>×{count}</strong></span>)}</div></section>; }
function groupCards(cards: CardInstance[]): CardGroup[] { const groups = new Map<string, CardGroup>(); for (const card of cards) { const group = groups.get(card.definitionId); if (group) group.instances.push(card); else groups.set(card.definitionId, { definitionId: card.definitionId, instances: [card] }); } return [...groups.values()]; }
function groupPlayedCards(cards: CardInstance[]): PlayedGroup[] { const groups: PlayedGroup[] = []; for (const card of cards) { const previous = groups.at(-1); if (previous?.definitionId === card.definitionId) previous.instances.push(card); else groups.push({ definitionId: card.definitionId, instances: [card] }); } return groups; }
function playerName(playerId: PlayerId): string { return playerId === 'ochre' ? 'Player 1' : 'Player 2'; }
function eventPlayerName(value: unknown): string { return value === 'ochre' || value === 'indigo' ? playerName(value) : 'Unknown player'; }
function eventText(game: GameView, event: PublicGameEvent): string {
  const detail = event.detail;
  const cardName = (): string => game.cards[String(detail.definitionId)]?.name ?? String(detail.definitionId);
  switch (event.type) {
    case 'buildComplete': return `Completed a ${String(detail.count)}-card starting build`;
    case 'cardPlayed': return `Played ${cardName()}`;
    case 'purchase': return `Bought ${cardName()}`;
    case 'damage': return `Dealt ${String(detail.amount)} damage to ${eventPlayerName(detail.targetId)}`;
    case 'move': if (detail.source === 'drive') return `Moved both fighters ${String(detail.movement)} to space ${String(detail.to)}`; if (detail.source === 'repellingShot') return `Repelling Shot increased the distance; one fighter moved ${String(detail.movement)} to space ${String(detail.to)}`; if (detail.movement === 'stay') return `Stayed on space ${String(detail.to)}`; return `Moved ${String(detail.movement)} to space ${String(detail.to)}`;
    case 'wallCollision': return `Wall blocked ${String(detail.direction)}; neither fighter moved`;
    case 'condition': return `${String(detail.condition)} ${detail.change === 'set' ? 'applied to' : 'consumed from'} ${eventPlayerName(detail.targetId)}`;
    case 'discard': return `Discarded ${cardName()}`;
    case 'recover': return 'Recovered a card to the top of the deck';
    case 'trash': return `Trashed ${cardName()}`;
    case 'draw': return `Drew ${String(detail.count)} ${detail.count === 1 ? 'card' : 'cards'}`;
    case 'phase': return `Started Buy phase with ${String(detail.money)} money`;
    case 'turn': return `Turn ${String(detail.turn)} started`;
    case 'victory': return 'Won the game';
    case 'mana': return `${Number(detail.amount) >= 0 ? 'Gained' : 'Spent'} ${String(Math.abs(Number(detail.amount)))} mana`;
  }
}
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
