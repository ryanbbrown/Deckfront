import { useState } from 'react';
import type { CardDefinition, CardInstance, LegalAction, PlayerId } from '../game';
import type { AiTurnRecap, SafeGameView } from '../shared/api';
import { takeAction, undoAction } from './api';
import { Board } from './Board';

interface GameProps {
  game: SafeGameView;
  error: string | null;
  aiStatus: string;
  aiElapsed: number;
  aiError: string | null;
  onGame: (game: SafeGameView) => void;
  onError: (value: string | null) => void;
  onNew: () => void;
  onRetry: () => Promise<void>;
}
interface HandGroup { definitionId: string; instances: CardInstance[] }

export function Game({ game, error, aiStatus, aiElapsed, aiError, onGame, onError, onNew, onRetry }: GameProps) {
  const [busy, setBusy] = useState(false);
  const [cullCard, setCullCard] = useState<string | null>(null);
  const [movementCard, setMovementCard] = useState<string | null>(null);
  const [trash, setTrash] = useState<string[]>([]);
  const [deckOpen, setDeckOpen] = useState(false);
  const local = game.opponentMode === 'local';
  const actor = game.players[game.viewPlayerId];
  const actorName = playerName(game, game.viewPlayerId);
  const availability = new Map(game.actionAvailability.map((item) => [item.cardInstanceId, item]));
  const handGroups = groupCards(actor.hand ?? []);
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
    ? local ? `${playerName(game, game.winner)} wins` : game.winner === game.humanPlayerId ? 'You win' : 'AI wins'
    : local ? `Turn ${game.turn} · ${actorName} ${game.phase}`
    : game.activePlayerId === game.humanPlayerId ? `Turn ${game.turn} · your ${game.phase}` : `Turn ${game.turn} · AI ${game.phase} · ${aiStatus} · ${aiElapsed}s`;

  return <main className="game-shell">
    <header className="game-header"><div><p className="eyebrow">Distance duel</p><h1>Hexdeck</h1></div><FighterScore game={game} /><button onClick={onNew}>New game</button></header>
    <div className="play-bar"><div className="turn-banner" role="status">{turnText}</div><div className="phase-controls"><strong data-testid="zone-money">{local ? `${actorName} money` : 'Money'}: {actor.money}</strong><button disabled={!game.canUndo || busy} onClick={() => void undo()}>Undo last action</button>{endAction ? <button className="primary" disabled={busy} onClick={() => void act(endAction)}>End Action phase</button> : null}{endBuy ? <button className="primary" disabled={busy} onClick={() => void act(endBuy)}>End Buy phase</button> : null}</div></div>
    {error ? <p role="alert" className="error">{error}</p> : null}
    {!local && aiError ? <p role="alert" className="error">{aiError} <button onClick={() => void onRetry()}>Retry AI</button></p> : null}
    {!local && game.lastAiTurnRecap ? <AiTurnRecapPanel recap={game.lastAiTurnRecap} cards={game.cards} /> : null}
    {!local && !game.lastAiTurnRecap && game.lastAiSummary ? <p className="ai-summary"><strong>AI:</strong> {game.lastAiSummary}</p> : null}
    <section className="arena-panel"><div className="range-label" data-testid="range">{game.range} · {distance} {distance === 1 ? 'space' : 'spaces'}</div><Board game={game} /></section>
    <section className="panel played-panel" aria-labelledby="played-heading"><div className="section-heading"><h2 id="played-heading">Played this turn</h2><span>Cards stay here until cleanup.</span></div><div className="played-row" data-testid="played-row">{actor.played?.length ? actor.played.map((card, index) => <PlayedCard key={card.id} card={game.cards[card.definitionId]!} order={index + 1} instanceId={card.id} />) : <p className="empty-row">Cards move here from your hand.</p>}</div></section>
    <section className="panel hand-panel"><div className="section-heading"><h2>{local ? `${actorName} hand` : 'Your hand'}</h2><span>{actor.zoneCounts.hand} physical cards</span></div><div className="hand-row" data-testid="hand-grid">{handGroups.map((group, index) => {
      const enabledInstance = group.instances.find((card) => availability.get(card.id)?.enabled) ?? group.instances[0]!;
      const info = availability.get(enabledInstance.id);
      const targetIds = cullCard ? group.instances.filter((card) => availability.get(cullCard)?.eligibleCardInstanceIds.includes(card.id)).map((card) => card.id) : [];
      const selectedCount = group.instances.filter((card) => trash.includes(card.id)).length;
      const disabled = busy || (cullCard ? targetIds.length === 0 : !info?.enabled);
      return <div className="hand-card-slot" key={group.definitionId} style={{ zIndex: index + 1 }}><button className={`card portrait-card card--${game.cards[group.definitionId]!.type}${selectedCount ? ' card--target' : ''}${movementCard === enabledInstance.id || cullCard === enabledInstance.id ? ' card--selected' : ''}`} data-card-name={game.cards[group.definitionId]!.name} data-card-instance-id={enabledInstance.id} data-card-count={group.instances.length} disabled={disabled} title={!cullCard ? info?.reason ?? undefined : undefined} onClick={() => cullCard ? toggleTrashGroup(targetIds) : chooseCard(enabledInstance.id)}>{group.instances.length > 1 ? <span className="quantity-badge" data-testid={`hand-count-${group.definitionId}`}>×{group.instances.length}</span> : null}<CardFace card={game.cards[group.definitionId]!} />{selectedCount ? <span className="selected-count">Selected ×{selectedCount}</span> : null}{!info?.enabled && !cullCard && game.cards[group.definitionId]!.type === 'action' ? <em>{info?.reason}</em> : null}</button></div>;
    })}</div>{cullCard ? <div className="choice-bar"><p>Select 1 or 2 cards. Click a grouped card twice to select two physical copies. {trash.length} selected (maximum 2).</p><button className="primary" disabled={!cullAction} onClick={() => cullAction && void act(cullAction)}>{trash.length === 1 ? 'Trash selected card' : 'Trash selected cards'}</button><button onClick={clearChoice}>Cancel</button></div> : null}{movementCard ? <div className="choice-bar"><strong>Choose movement</strong>{cardActions(movementCard).map((action) => <button key={action.id} disabled={busy} onClick={() => void act(action)}>{action.label}</button>)}<button onClick={clearChoice}>Cancel</button></div> : null}</section>
    <Market game={game} busy={busy} onAction={act} />
    <button className="deck-toggle" type="button" aria-expanded={deckOpen} aria-controls="deck-drawer" onClick={() => setDeckOpen((open) => !open)}>Deck · {Object.values(actor.deckCounts ?? {}).reduce((total, count) => total + count, 0)}</button>
    <aside id="deck-drawer" className={`deck-drawer${deckOpen ? ' deck-drawer--open' : ''}`} aria-label="Deck and match details"><div className="drawer-heading"><div><p className="eyebrow">Reference</p><h2>Deck and zones</h2></div><button aria-label="Close deck drawer" onClick={() => setDeckOpen(false)}>×</button></div><Zones game={game} actor={actor} /><DeckSummary game={game} playerId={game.viewPlayerId} /><Builds game={game} /><Purchases game={game} /><History game={game} /></aside>
  </main>;
}

export function CardFace({ card }: { card: CardDefinition }) {
  return <><span className="card__cost">{card.cost}</span><strong>{card.name}</strong>{card.money ? <span className="money-value">+{card.money} money</span> : null}<small>{card.text}</small></>;
}
function PlayedCard({ card, order, instanceId }: { card: CardDefinition; order: number; instanceId: string }) {
  return <article className={`card portrait-card played-card card--${card.type}`} data-played-card-name={card.name} data-card-instance-id={instanceId}><span className="play-order">{order}</span><CardFace card={card} /></article>;
}
function FighterScore({ game }: { game: SafeGameView }) {
  return <div className="health-score">{(['ochre', 'indigo'] as const).map((id) => { const fighter = game.fighters[id]; return <div key={id} className={`score score--${id}`} data-player-score={id}><strong>{playerName(game, id)}</strong><span>{fighter.health} HP</span><small>{[fighter.aimed ? 'Aimed' : '', fighter.exposed ? 'Next Close-range attack this turn: +2 damage' : ''].filter(Boolean).join(' · ') || 'Ready'}</small></div>; })}</div>;
}
function Market({ game, busy, onAction }: { game: SafeGameView; busy: boolean; onAction: (action: LegalAction) => Promise<void> }) {
  const buys = new Map(game.legalActions.flatMap((action) => action.command.type === 'buyCard' ? [[action.command.definitionId, action] as const] : []));
  return <section className="panel market-panel"><div className="section-heading"><h2>Market</h2><span>Bought cards go to discard.</span></div><div className="market-grid">{Object.values(game.cards).map((card) => { const action = buys.get(card.id); return <button key={card.id} data-market-card={card.name} className="market-card" disabled={busy || !action} onClick={() => action && void onAction(action)}><CardFace card={card} /><span className="market-card__count">{card.type === 'action' ? `${game.supply[card.id]} left` : '∞'}</span></button>; })}</div></section>;
}
function Zones({ game, actor }: { game: SafeGameView; actor: SafeGameView['players'][PlayerId] }) {
  return <section className="drawer-section zones"><h3>Zones</h3><div>Draw <strong>{actor.zoneCounts.draw}</strong></div><div>Hand <strong>{actor.zoneCounts.hand}</strong></div><div>Discard <strong>{actor.zoneCounts.discard}</strong></div><div>Played <strong>{actor.zoneCounts.play}</strong></div><div data-testid="zone-trash">Trash <strong>{game.trashCount}</strong></div></section>;
}
function DeckSummary({ game, playerId }: { game: SafeGameView; playerId: PlayerId }) {
  const counts = game.players[playerId].deckCounts; if (!counts) return null;
  const entries = Object.entries(counts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right));
  return <section className="drawer-section deck-summary" data-testid="deck-summary"><h3>Composition</h3><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}>{game.cards[id]?.name ?? id} ×{count}</span>)}</div></section>;
}
function Builds({ game }: { game: SafeGameView }) {
  if (!game.completedBuilds) return null;
  return <section className="drawer-section builds"><h3>Starting builds</h3><p>{playerName(game, 'ochre')}: {game.completedBuilds.ochre.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p><p>{playerName(game, 'indigo')}: {game.completedBuilds.indigo.map((id) => game.cards[id]?.name).join(', ') || 'No cards'}</p></section>;
}
function Purchases({ game }: { game: SafeGameView }) {
  return <section className="drawer-section purchases"><h3>Purchases</h3><p data-testid="human-purchases">{playerName(game, 'ochre')}: {game.players.ochre.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p><p data-testid="ai-purchases">{playerName(game, 'indigo')}: {game.players.indigo.purchases.map((id) => game.cards[id]?.name).join(', ') || 'None'}</p></section>;
}
function History({ game }: { game: SafeGameView }) {
  return <section className="drawer-section history-panel"><h3>Recent events</h3><ol>{game.events.slice(-20).reverse().map((event) => <li key={event.sequence} data-event-type={event.type}><span>{playerName(game, event.playerId)}</span><strong>{eventText(game, event.type, event.detail)}</strong></li>)}</ol></section>;
}
function AiTurnRecapPanel({ recap, cards }: { recap: AiTurnRecap; cards: SafeGameView['cards'] }) {
  const purchases = recap.purchases.map((purchase) => cards[purchase.definitionId]?.name ?? purchase.definitionId).join(', ');
  const summary = `AI turn ${recap.turn} · ${recap.actions.length} ${recap.actions.length === 1 ? 'Action' : 'Actions'} · ${recap.totalDamage} damage · ${purchases ? `bought ${purchases}` : 'no purchase'}`;
  const actionOrder = new Map(recap.actions.map((action, index) => [action.card.id, index + 1]));
  const treasureMoney = new Map(recap.treasures.map((treasure) => [treasure.card.id, treasure.money]));
  const unplayed = new Set(recap.unplayed.map((card) => card.id));
  const trashed = new Set(recap.actions.flatMap((action) => action.trashed.map((card) => card.id)));
  const statusFor = (card: CardInstance) => actionOrder.has(card.id) ? `Played #${actionOrder.get(card.id)}` : treasureMoney.has(card.id) ? `Provided ${treasureMoney.get(card.id)} money` : trashed.has(card.id) ? 'Trashed' : unplayed.has(card.id) ? 'Not played' : 'Available';
  return <details className="ai-recap" data-testid="ai-turn-recap"><summary><strong>{summary}</strong><span>Show full turn</span></summary><div className="recap-body"><RecapCards title="Starting hand" cards={recap.startingHand} definitions={cards} statusFor={statusFor} />
    <section><h3>Cards drawn</h3>{recap.draws.length ? <ol>{recap.draws.map((draw, index) => <li key={draw.card.id}><strong>{index + 1}. {cards[draw.card.definitionId]?.name}</strong><span>Drawn by {cards[draw.sourceDefinitionId]?.name ?? draw.sourceDefinitionId} · {statusFor(draw.card)}</span></li>)}</ol> : <p>None</p>}</section>
    <section><h3>Actions played</h3>{recap.actions.length ? <ol>{recap.actions.map((action, index) => <li key={action.card.id}><strong>{index + 1}. {cards[action.card.definitionId]?.name}</strong><span>{action.label}{action.movements.length ? ` · ${action.movements.join(', ')}` : ''}{action.damage ? ` · ${action.damage} damage` : ''}{action.drawnCardIds.length ? ` · drew ${action.drawnCardIds.length}` : ''}{action.trashed.length ? ` · trashed ${action.trashed.map((card) => cards[card.definitionId]?.name).join(', ')}` : ''}</span></li>)}</ol> : <p>None</p>}</section>
    <section><h3>Treasures used</h3>{recap.treasures.length ? <ul>{recap.treasures.map((treasure) => <li key={treasure.card.id}><strong>{cards[treasure.card.definitionId]?.name}</strong><span>Provided {treasure.money} money</span></li>)}</ul> : <p>None</p>}<p>{recap.moneyAvailable} money available{recap.startingMoney ? `, including ${recap.startingMoney} carried from the starting build` : ''}.</p></section>
    <RecapCards title="Cards left unplayed at cleanup" cards={recap.unplayed} definitions={cards} statusFor={statusFor} />
    <section><h3>Purchases</h3><p>{purchases || 'None'} · {recap.unspentMoney} money left unspent when Buy ended.</p></section>
  </div></details>;
}
function RecapCards({ title, cards, definitions, statusFor }: { title: string; cards: CardInstance[]; definitions: SafeGameView['cards']; statusFor: (card: CardInstance) => string }) {
  return <section><h3>{title}</h3>{cards.length ? <div className="recap-cards">{cards.map((card) => <div className="recap-card" key={card.id}><strong>{definitions[card.definitionId]?.name}</strong><span>{statusFor(card)}</span></div>)}</div> : <p>None</p>}</section>;
}
function groupCards(cards: CardInstance[]): HandGroup[] {
  const groups = new Map<string, HandGroup>();
  for (const card of cards) { const group = groups.get(card.definitionId); if (group) group.instances.push(card); else groups.set(card.definitionId, { definitionId: card.definitionId, instances: [card] }); }
  return [...groups.values()];
}
function playerName(game: SafeGameView, playerId: PlayerId): string { if (game.opponentMode === 'local') return playerId === 'ochre' ? 'Player 1' : 'Player 2'; return playerId === game.humanPlayerId ? 'You' : 'AI'; }
function eventText(game: SafeGameView, type: string, detail: Record<string, unknown>): string { if (type === 'cardPlayed') return `Played ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'purchase') return `Bought ${game.cards[String(detail.definitionId)]?.name ?? detail.definitionId}`; if (type === 'damage') return `Dealt ${String(detail.amount)} damage`; if (type === 'move' && detail.source === 'drive') return `Moved both fighters ${String(detail.movement)} to space ${String(detail.to)}`; if (type === 'move' && detail.movement === 'stay') return `Stayed on space ${String(detail.to)}`; if (type === 'move') return `Moved to space ${String(detail.to)}`; if (type === 'wallCollision') return `Wall blocked ${String(detail.direction)}; neither fighter moved`; return type.replace(/([A-Z])/g, ' $1'); }
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
