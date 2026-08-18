import { useState } from 'react';
import type { CardDefinition, CardInstance, LegalAction, PlayerId } from '../game';
import type { GameView } from '../shared/api';
import { takeAction, undoAction } from './api';
import { Board } from './Board';

interface GameProps {
  game: GameView;
  error: string | null;
  onGame: (game: GameView) => void;
  onError: (value: string | null) => void;
  onNew: () => void;
}
interface CardGroup { definitionId: string; instances: CardInstance[] }
interface PlayedGroup extends CardGroup { firstOrder: number; lastOrder: number }

export function Game({ game, error, onGame, onError, onNew }: GameProps) {
  const [busy, setBusy] = useState(false);
  const [cullCard, setCullCard] = useState<string | null>(null);
  const [movementCard, setMovementCard] = useState<string | null>(null);
  const [trash, setTrash] = useState<string[]>([]);
  const [deckOpen, setDeckOpen] = useState(false);
  const actor = game.players[game.activePlayerId];
  const actorName = playerName(game.activePlayerId);
  const availability = new Map(game.actionAvailability.map((item) => [item.cardInstanceId, item]));
  const handGroups = groupCards(actor.hand);
  const playedGroups = groupPlayedCards(actor.played);
  const distance = Math.abs(game.fighters.ochre.position - game.fighters.indigo.position);

  async function act(action: LegalAction) {
    setBusy(true); onError(null);
    try { onGame(await takeAction(game, action.id)); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  async function undo() {
    setBusy(true); onError(null);
    try { onGame(await undoAction(game)); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Undo failed.'); }
    finally { setBusy(false); }
  }
  function clearChoice() { setCullCard(null); setMovementCard(null); setTrash([]); }
  function cardActions(id: string) { return game.legalActions.filter((action) => 'cardInstanceId' in action.command && action.command.cardInstanceId === id); }
  function chooseCard(id: string) {
    const info = availability.get(id); if (!info?.enabled) return;
    if (info.selection === 'trashOneOrTwo') { setCullCard(id); setMovementCard(null); setTrash([]); return; }
    if (info.selection === 'movement') { setMovementCard(id); setCullCard(null); return; }
    const actions = cardActions(id); if (actions.length === 1) void act(actions[0]!);
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
    ? cardActions(cullCard).find((action) => action.command.type === 'playCull' && sameSelection(action.command.trashInstanceIds, trash))
    : undefined;
  const endAction = game.legalActions.find((action) => action.command.type === 'endActionPhase');
  const endBuy = game.legalActions.find((action) => action.command.type === 'endBuyPhase');
  const turnText = game.winner
    ? `${playerName(game.winner)} wins`
    : `Turn ${game.turn} · ${actorName} ${game.phase}`;

  return <main className="game-shell">
    <header className="game-header"><div><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1></div><FighterScore game={game} /><button className="control-button control-button--secondary" onClick={onNew}>New game</button></header>
    <div className="play-bar"><div className="turn-banner" role="status">{turnText}</div><div className="phase-controls"><strong data-testid="zone-money">{`${actorName} money`}: {actor.money}</strong><button className="control-button control-button--quiet" disabled={!game.canUndo || busy} onClick={() => void undo()}>Undo last action</button>{endAction ? <button className="control-button primary" disabled={busy} onClick={() => void act(endAction)}>End Action phase</button> : null}{endBuy ? <button className="control-button primary" disabled={busy} onClick={() => void act(endBuy)}>End Buy phase</button> : null}</div></div>
    {error ? <p role="alert" className="error">{error}</p> : null}
    <section className="arena-panel"><div className="range-label" data-testid="range">{game.range} · {distance} {distance === 1 ? 'space' : 'spaces'}</div><Board game={game} /></section>
    <section className="panel played-panel" aria-labelledby="played-heading"><div className="section-heading"><h2 id="played-heading">Played this turn</h2><span>Consecutive copies share a stack. Numbers show play order.</span></div><div className="played-row" data-testid="played-row">{playedGroups.length ? playedGroups.map((group) => <PlayedCard key={group.instances[0]!.id} card={game.cards[group.definitionId]!} group={group} />) : <p className="empty-row">Cards move here from your hand.</p>}</div></section>
    <section className="panel hand-panel"><div className="section-heading"><h2>{`${actorName} hand`}</h2><span>{actor.zoneCounts.hand} physical cards</span></div><div className="hand-row" data-testid="hand-grid">{handGroups.map((group, index) => {
      const enabledInstance = group.instances.find((card) => availability.get(card.id)?.enabled) ?? group.instances[0]!;
      const info = availability.get(enabledInstance.id);
      const targetIds = cullCard ? group.instances.filter((card) => availability.get(cullCard)?.eligibleCardInstanceIds.includes(card.id)).map((card) => card.id) : [];
      const selectedCount = group.instances.filter((card) => trash.includes(card.id)).length;
      const disabled = busy || (cullCard ? targetIds.length === 0 : !info?.enabled);
      return <div className="hand-card-slot" key={group.definitionId} style={{ zIndex: index + 1 }}>{group.instances.length > 1 ? <span className="quantity-badge" data-testid={`hand-count-${group.definitionId}`}>×{group.instances.length}</span> : null}<button className={`card portrait-card card--${game.cards[group.definitionId]!.type}${selectedCount ? ' card--target' : ''}${movementCard === enabledInstance.id || cullCard === enabledInstance.id ? ' card--selected' : ''}`} data-card-name={game.cards[group.definitionId]!.name} data-card-instance-id={enabledInstance.id} data-card-count={group.instances.length} disabled={disabled} title={!cullCard ? info?.reason ?? undefined : undefined} onClick={() => cullCard ? toggleTrashGroup(targetIds) : chooseCard(enabledInstance.id)}><CardFace card={game.cards[group.definitionId]!} />{selectedCount ? <span className="selected-count">Selected ×{selectedCount}</span> : null}{!info?.enabled && !cullCard && game.cards[group.definitionId]!.type === 'action' ? <em>{info?.reason}</em> : null}</button></div>;
    })}</div>{cullCard ? <div className="choice-bar"><p>Select 1 or 2 cards. Click a grouped card twice to select two physical copies. {trash.length} selected (maximum 2).</p><div className="choice-bar__actions"><button className="control-button primary" disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>{trash.length === 1 ? 'Trash selected card' : 'Trash selected cards'}</button><button className="control-button control-button--cancel" onClick={clearChoice}>Cancel</button></div></div> : null}{movementCard ? <div className="choice-bar choice-bar--movement"><strong>Choose movement</strong><div className="choice-bar__actions">{cardActions(movementCard).map((action) => <button className="choice-button" key={action.id} aria-label={action.label} disabled={busy} onClick={() => void act(action)}>{movementChoiceText(action)}</button>)}<button className="control-button control-button--cancel" onClick={clearChoice}>Cancel</button></div></div> : null}</section>
    <Market game={game} busy={busy} onAction={act} />
    <button className="deck-toggle" type="button" aria-expanded={deckOpen} aria-controls="deck-drawer" onClick={() => setDeckOpen((open) => !open)}>Deck · {Object.values(actor.deckCounts).reduce((total, count) => total + count, 0)}</button>
    <aside id="deck-drawer" className={`deck-drawer${deckOpen ? ' deck-drawer--open' : ''}`} aria-label="Deck and match details"><div className="drawer-heading"><div><p className="eyebrow">Reference</p><h2>Deck and zones</h2></div><button aria-label="Close deck drawer" onClick={() => setDeckOpen(false)}>×</button></div><Zones game={game} actor={actor} /><DeckSummary game={game} playerId={game.activePlayerId} /><Builds game={game} /><Purchases game={game} /><History game={game} /></aside>
  </main>;
}

export function CardFace({ card, indicators }: { card: CardDefinition; indicators?: React.ReactNode }) {
  return <><span className="card__header"><span className="card__meta">{indicators}<span className="card__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span></span><strong className="card__title">{card.name}</strong></span>{card.money ? <span className="money-value">+{card.money} money</span> : null}<small>{card.text}</small></>;
}
function PlayedCard({ card, group }: { card: CardDefinition; group: PlayedGroup }) {
  const count = group.instances.length;
  const orderText = group.firstOrder === group.lastOrder ? String(group.firstOrder) : `${group.firstOrder}–${group.lastOrder}`;
  const orderLabel = group.firstOrder === group.lastOrder ? `Play order ${group.firstOrder}` : `Play order ${group.firstOrder} through ${group.lastOrder}`;
  const indicators = <><span className="play-order" aria-label={orderLabel}>{orderText}</span>{count > 1 ? <span className="quantity-badge quantity-badge--played" data-testid={`played-count-${card.id}`}>×{count}</span> : null}</>;
  return <article className={`card portrait-card played-card card--${card.type}`} data-played-card-name={card.name} data-card-instance-id={group.instances[0]!.id} data-card-count={count}><CardFace card={card} indicators={indicators} /></article>;
}
function FighterScore({ game }: { game: GameView }) {
  return <div className="health-score">{(['ochre', 'indigo'] as const).map((id) => { const fighter = game.fighters[id]; return <div key={id} className={`score score--${id}`} data-player-score={id}><strong>{playerName(id)}</strong><span>{fighter.health} HP</span><small>{[fighter.aimed ? 'Aimed' : '', fighter.exposed ? 'Next Close-range attack this turn: +2 damage' : ''].filter(Boolean).join(' · ') || 'Ready'}</small></div>; })}</div>;
}
function Market({ game, busy, onAction }: { game: GameView; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  const buys = new Map(game.legalActions.flatMap((action) => action.command.type === 'buyCard' ? [[action.command.definitionId, action] as const] : []));
  return <section className="panel market-panel"><div className="section-heading"><h2>Market</h2><span>Bought cards go to discard.</span></div><div className="market-grid">{Object.values(game.cards).map((card) => { const action = buys.get(card.id); return <button key={card.id} data-market-card={card.name} className="market-card" disabled={busy || !action} onClick={() => action && void onAction(action)}><CardFace card={card} /><span className="market-card__count">{card.type === 'action' ? `${game.supply[card.id]} left` : '∞'}</span></button>; })}</div></section>;
}
function Zones({ game, actor }: { game: GameView; actor: GameView['players'][PlayerId] }) {
  return <section className="drawer-section zones"><h3>Zones</h3><div>Draw <strong>{actor.zoneCounts.draw}</strong></div><div>Hand <strong>{actor.zoneCounts.hand}</strong></div><div>Discard <strong>{actor.zoneCounts.discard}</strong></div><div>Played <strong>{actor.zoneCounts.play}</strong></div><div data-testid="zone-trash">Trash <strong>{game.trashCount}</strong></div></section>;
}
function DeckSummary({ game, playerId }: { game: GameView; playerId: PlayerId }) {
  const counts = game.players[playerId].deckCounts;
  const entries = Object.entries(counts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right));
  return <section className="drawer-section deck-summary" data-testid="deck-summary"><h3>Composition</h3><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}>{game.cards[id]?.name ?? id} ×{count}</span>)}</div></section>;
}
function Builds({ game }: { game: GameView }) {
  if (!game.completedBuilds) return null;
  return <section className="drawer-section builds"><h3>Starting builds</h3><p>{playerName('ochre')}: {game.completedBuilds.ochre.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p><p>{playerName('indigo')}: {game.completedBuilds.indigo.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p></section>;
}
function Purchases({ game }: { game: GameView }) {
  return <section className="drawer-section purchases"><h3>Purchases</h3><p data-testid="player-one-purchases">{playerName('ochre')}: {game.players.ochre.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p><p data-testid="player-two-purchases">{playerName('indigo')}: {game.players.indigo.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p></section>;
}
function History({ game }: { game: GameView }) {
  return <section className="drawer-section history-panel"><h3>Recent events</h3><ol>{game.events.slice(-20).reverse().map((event) => <li key={event.sequence} data-event-type={event.type}><span>{playerName(event.playerId)}</span><strong>{eventText(game, event.type, event.detail)}</strong></li>)}</ol></section>;
}
function groupCards(cards: CardInstance[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const card of cards) { const group = groups.get(card.definitionId); if (group) group.instances.push(card); else groups.set(card.definitionId, { definitionId: card.definitionId, instances: [card] }); }
  return [...groups.values()];
}
function groupPlayedCards(cards: CardInstance[]): PlayedGroup[] {
  const groups: PlayedGroup[] = [];
  for (const [index, card] of cards.entries()) {
    const previous = groups.at(-1);
    if (previous?.definitionId === card.definitionId) { previous.instances.push(card); previous.lastOrder = index + 1; }
    else groups.push({ definitionId: card.definitionId, instances: [card], firstOrder: index + 1, lastOrder: index + 1 });
  }
  return groups;
}
function movementChoiceText(action: LegalAction): string {
  if (action.command.type === 'playFootwork') return action.command.movement === 'left' ? 'Left' : action.command.movement === 'right' ? 'Right' : 'Stay';
  if (action.command.type === 'playDrive') return action.command.direction === 'left' ? 'Move both left' : 'Move both right';
  return action.label;
}
function playerName(playerId: PlayerId): string { return playerId === 'ochre' ? 'Player 1' : 'Player 2'; }
function eventText(game: GameView, type: string, detail: Record<string, unknown>): string { if (type === 'cardPlayed') return `Played ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'purchase') return `Bought ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'damage') return `Dealt ${String(detail.amount)} damage`; if (type === 'move' && detail.source === 'drive') return `Moved both fighters ${String(detail.movement)} to space ${String(detail.to)}`; if (type === 'move' && detail.movement === 'stay') return `Stayed on space ${String(detail.to)}`; if (type === 'move') return `Moved to space ${String(detail.to)}`; if (type === 'wallCollision') return `Wall blocked ${String(detail.direction)}; neither fighter moved`; return type.replace(/([A-Z])/g, ' $1'); }
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
