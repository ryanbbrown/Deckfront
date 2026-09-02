import { useCallback, useEffect, useRef, useState } from 'react';
import { STARTING_BUDGET, firstBuyCarry, playerStartingHealth } from '../game';
import type { CardDefinition, CardInstance, PlayerId } from '../game';
import { AI_DIFFICULTIES } from '../shared/api';
import type { AiDifficulty, BrowserAction, GameMode, GameStatistics, GameUpdateView, GameView, PresentationFrame, PresentationSequence, PublicGameEvent, SelectionActionPresentation, SetupCatalog } from '../shared/api';
import { resetGame, takeAction, undoAction, updateBuild } from './api';
import { Board, FighterCounter } from './Board';
import { groupCardCatalog } from './cardCatalog';
import { AI_SETTLE_MS, DRAW_DURATION_MS, DRAW_STAGGER_MS, FlyingCards, HUMAN_SETTLE_MS, PLAY_DURATION_MS, PURCHASE_PREVIEW_MS, PurchasePreview, gameAtFrame, updateGame, useReducedMotion, wait } from './playback';
import type { Flight, PurchaseReveal } from './playback';
import { playerLabel, playerShortLabel } from './playerLabel';

interface GameProps { game: GameView; initialPresentation: PresentationSequence | null; error: string | null; animateAi: boolean; onAnimateAi: (enabled: boolean) => void; onGameId: (id: string) => void; onGame: (game: GameView) => void; onError: (value: string | null) => void; onNew: () => void }
interface CardGroup { definitionId: string; instances: CardInstance[] }
interface AnimationDestination { kind: 'handToPlayed' | 'drawToHand'; definitionId: string }
interface DamageFeedback { id: string; targetId: PlayerId; amount: number }
type PlayedGroup = CardGroup;

export function PreviewTable({ catalog, market, error, animateAi, statistics, statisticsLoading, onAnimateAi, onRefresh, onStart }: {
  catalog: SetupCatalog; market: string[]; error: string | null; animateAi: boolean; statistics: GameStatistics | null; statisticsLoading: boolean;
  onAnimateAi: (enabled: boolean) => void; onRefresh: () => void;
  onStart: (mode: GameMode, startingDraftEnabled: boolean, humanPlayerId?: PlayerId, aiDifficulty?: AiDifficulty) => Promise<void>;
}) {
  const [mode, setMode] = useState<GameMode>('local');
  const [startingDraftEnabled, setStartingDraftEnabled] = useState(false);
  const [human, setHuman] = useState<PlayerId>('ochre');
  const [difficulty, setDifficulty] = useState<AiDifficulty>('expert');
  const [marketOpen, setMarketOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const cards = Object.fromEntries([...catalog.fixedCardIds, ...market].map((id) => [id, catalog.cards[id]!]));
  return <main className="table-shell table-shell--preview" onContextMenuCapture={(event) => inspectCard(event, cards, setInspectedCardId)} onKeyDownCapture={(event) => inspectCardFromKeyboard(event, cards, setInspectedCardId)}>
    <TableHeader title="Set up a match" controls={null} />
    {error ? <p role="alert" className="error">{error}</p> : null}
    <PreviewArena mode={mode} human={human} />
    <CompactMarket cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onView={() => setMarketOpen(true)} />
    <EmptyPlayed />
    <section className="hand-panel table-zone"><div className="zone-title"><h2>Your hand</h2><span>Your opening hand appears here.</span></div><div className="hand-row"><p className="empty-row">Start the game to draw five cards.</p></div></section>
    <SetupRail mode={mode} startingDraftEnabled={startingDraftEnabled} animateAi={animateAi} human={human} difficulty={difficulty} statistics={statistics} statisticsLoading={statisticsLoading} onMode={setMode} onStartingDraft={setStartingDraftEnabled} onAnimateAi={onAnimateAi} onHuman={setHuman} onDifficulty={setDifficulty} onRefresh={onRefresh} onCatalog={() => setCatalogOpen(true)} onStart={() => void onStart(mode, startingDraftEnabled, mode === 'ai' ? human : undefined, mode === 'ai' ? difficulty : undefined)} />
    {marketOpen ? <MarketDialog cards={cards} fixedIds={catalog.fixedCardIds} variableIds={market} onClose={() => setMarketOpen(false)} /> : null}
    {catalogOpen ? <CardCatalogDialog cards={catalog.cards} onClose={() => setCatalogOpen(false)} /> : null}
    {inspectedCardId && cards[inspectedCardId] ? <CardInspectDialog card={cards[inspectedCardId]} onClose={() => setInspectedCardId(null)} /> : null}
  </main>;
}

export function Game({ game, initialPresentation, error, animateAi, onAnimateAi, onGameId, onGame, onError, onNew }: GameProps) {
  const [busy, setBusy] = useState(false);
  const [targetedCard, setTargetedCard] = useState<string | null>(null);
  const [movementCard, setMovementCard] = useState<string | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [pendingHandActionId, setPendingHandActionId] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const initialFrames = initialPresentation?.frames ?? [];
  const initializePlayback = initialFrames.length > 0 && animateAi && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [presentationGame, setPresentationGame] = useState<GameView | null>(() => initializePlayback ? gameAtFrame(game, initialFrames[0]!) : null);
  const [playbackActive, setPlaybackActive] = useState(initializePlayback);
  const [playingAi, setPlayingAi] = useState(() => initializePlayback && initialFrames.some((frame) => game.mode === 'ai' && frame.playerId === game.aiPlayerId));
  const [flights, setFlights] = useState<Flight[]>([]);
  const [destinations, setDestinations] = useState<AnimationDestination[]>([]);
  const [purchaseReveal, setPurchaseReveal] = useState<PurchaseReveal | null>(null);
  const [damageFeedback, setDamageFeedback] = useState<DamageFeedback | null>(null);
  const playbackToken = useRef(0);
  const finalGame = useRef<GameView>(game);
  const reducedMotion = useReducedMotion();
  const handOrders = useRef(new Map<string, string[]>());
  const view = presentationGame ?? game;
  const interactive = !playbackActive && !busy;
  const actor = view.players[view.activePlayerId];
  const actorName = playerLabel(view, view.activePlayerId);
  const availability = new Map((playbackActive ? [] : game.actions.cards).map((item) => [item.cardInstanceId, item]));
  const handGroups = stableHandGroups(actor.hand, `${view.id}:${view.turn}:${view.activePlayerId}`, handOrders.current,
    destinations.filter((item) => item.kind === 'drawToHand').map((item) => item.definitionId));
  const playedDestinationCards = destinations.filter((item) => item.kind === 'handToPlayed').map((item, index) => ({ id: `played-destination-${index}`, definitionId: item.definitionId }));
  const playedDestinationIds = new Set(playedDestinationCards.map((card) => card.id));
  const playedGroups = groupPlayedCards([...actor.played, ...playedDestinationCards], game.cards);
  const victory = view.winner ? victoryMessage(view, view.winner) : null;
  const proposalCost = game.buildProposal.reduce((sum, id) => sum + (game.cards[id]?.cost ?? 0), 0);

  const finishPlayback = useCallback(() => {
    playbackToken.current += 1;
    setFlights([]); setDestinations([]); setPurchaseReveal(null); setDamageFeedback(null); setPresentationGame(null); setPlaybackActive(false); setPlayingAi(false);
    onGame(finalGame.current);
  }, [onGame]);
  async function present(update: GameUpdateView, firstEvent = view.events.length): Promise<GameView> {
    const final = updateGame(update); finalGame.current = final;
    const token = ++playbackToken.current;
    const frames = batchConsecutiveAiPlays(update.presentation.frames, final.aiPlayerId);
    if (!frames.length || reducedMotion) { setPresentationGame(null); setPlaybackActive(false); onGame(final); return final; }
    let eventCursor = firstEvent;
    setPlaybackActive(true); setPlayingAi(frames.some((frame) => final.mode === 'ai' && frame.playerId === final.aiPlayerId)); clearChoice();
    try {
      for (const frame of frames) {
        if (token !== playbackToken.current) return final;
        const isAiFrame = final.mode === 'ai' && frame.playerId === final.aiPlayerId;
        if (isAiFrame && !animateAi) { setPresentationGame(null); setPlaybackActive(false); setPlayingAi(false); onGame(final); return final; }
        const frameEvents = final.events.slice(eventCursor, frame.eventCount); eventCursor = frame.eventCount;
        const damageEvents = frameEvents.filter((event) => event.type === 'damage');
        const visibleTransfers = frame.transfers.filter((transfer) => !transfer.hidden);
        const movementTransfers = visibleTransfers.filter((transfer) => transfer.kind !== 'purchase');
        const purchases = visibleTransfers.filter((transfer) => transfer.kind === 'purchase');
        const remainingWithheld = new Set(movementTransfers.map((transfer) => transfer.card.id));
        const sourceRects = new Map<string, DOMRect>();
        for (const transfer of movementTransfers.filter((item) => item.kind === 'handToPlayed')) {
          const source = document.querySelector<HTMLElement>(`[data-hand-definition-id="${transfer.card.definitionId}"] .full-card`);
          if (source) sourceRects.set(transfer.card.id, source.getBoundingClientRect());
        }
        if (!movementTransfers.length) {
          setPresentationGame(gameAtFrame(final, frame));
          await nextPaint();
          if (token !== playbackToken.current) return final;
          if (isAiFrame && frame.commandType === 'aiTurnStart') await wait(AI_SETTLE_MS);
        }
        let playedCard = false; let damageShown = false;
        const showDamage = async () => {
          if (damageShown || !damageEvents.length) return; damageShown = true;
          for (const event of damageEvents) {
            const targetId = event.detail.targetId; const amount = Number(event.detail.amount);
            if ((targetId !== 'ochre' && targetId !== 'indigo') || !Number.isFinite(amount)) continue;
            setDamageFeedback({ id: `${event.sequence}-${token}`, targetId, amount });
            await wait(isAiFrame ? AI_SETTLE_MS : 320); setDamageFeedback(null);
            if (token !== playbackToken.current) return;
          }
        };
        for (const kind of ['handToPlayed', 'drawToHand'] as const) {
          const batch = movementTransfers.filter((transfer) => transfer.kind === kind);
          if (!batch.length) continue;
          if (kind === 'handToPlayed') playedCard = true;
          const uniqueDestinations = new Map<string, AnimationDestination>();
          for (const transfer of batch) uniqueDestinations.set(`${kind}:${transfer.card.definitionId}`, { kind, definitionId: transfer.card.definitionId });
          setDestinations([...uniqueDestinations.values()]);
          setPresentationGame(gameAtFrame(final, frame, remainingWithheld));
          await nextPaint();
          if (token !== playbackToken.current) return final;
          const nextFlights: Flight[] = [];
          batch.forEach((transfer, index) => {
            const selector = transfer.kind === 'handToPlayed' ? `[data-played-definition-id="${transfer.card.definitionId}"]` : `[data-hand-definition-id="${transfer.card.definitionId}"] .full-card`;
            const placeholder = document.querySelector<HTMLElement>(`[data-animation-destination="${transfer.kind}-${transfer.card.definitionId}"]`);
            const matches = document.querySelectorAll<HTMLElement>(selector);
            const target = placeholder?.querySelector<HTMLElement>('.full-card') ?? placeholder?.querySelector<HTMLElement>('.hand-card-frame') ?? placeholder ?? matches.item(matches.length - 1);
            if (!target) return;
            const to = target.getBoundingClientRect();
            const from = transfer.kind === 'handToPlayed' ? sourceRects.get(transfer.card.id) : new DOMRect(to.left, window.innerHeight + 12, to.width, to.height);
            if (!from) return;
            nextFlights.push({ id: transfer.card.id, card: final.cards[transfer.card.definitionId]!, from, to,
              duration: transfer.kind === 'handToPlayed' ? PLAY_DURATION_MS : DRAW_DURATION_MS,
              delay: index * DRAW_STAGGER_MS, kind: transfer.kind === 'handToPlayed' ? 'play' : 'draw' });
          });
          setFlights(nextFlights);
          if (nextFlights.length) await wait(Math.max(...nextFlights.map((flight) => flight.duration + flight.delay)));
          if (token !== playbackToken.current) return final;
          for (const transfer of batch) remainingWithheld.delete(transfer.card.id);
          setFlights([]); setDestinations([]); setPresentationGame(gameAtFrame(final, frame, remainingWithheld));
          if (kind === 'handToPlayed') {
            if (damageEvents.length) await showDamage(); else await wait(isAiFrame ? AI_SETTLE_MS : HUMAN_SETTLE_MS);
          }
        }
        for (const transfer of purchases) {
          const pile = document.querySelector<HTMLElement>(`[data-market-definition-id="${transfer.card.definitionId}"]`);
          if (!pile) continue;
          setPurchaseReveal({ id: transfer.card.id, card: final.cards[transfer.card.definitionId]!, anchor: pile.getBoundingClientRect() });
          await wait(PURCHASE_PREVIEW_MS); setPurchaseReveal(null);
          if (token !== playbackToken.current) return final;
        }
        if (!playedCard) await showDamage();
      }
    } finally {
      if (token === playbackToken.current) { setFlights([]); setDestinations([]); setPurchaseReveal(null); setDamageFeedback(null); setPresentationGame(null); setPlaybackActive(false); setPlayingAi(false); onGame(final); }
    }
    return final;
  }
  useEffect(() => {
    if (!initialPresentation?.frames.length) return;
    void present({ ...game, presentation: initialPresentation });
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden && playbackActive) finishPlayback(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [finishPlayback, playbackActive]);
  useEffect(() => { if ((reducedMotion || (!animateAi && playingAi)) && playbackActive) finishPlayback(); }, [animateAi, reducedMotion, playingAi, playbackActive]);
  useEffect(() => { if (!playbackActive) finalGame.current = game; }, [game, playbackActive]);

  async function act(action: Pick<BrowserAction, 'id'>) {
    if (!interactive) return;
    setBusy(true); onError(null);
    try { const update = await takeAction(game, action.id); setBusy(false); await present(update); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setBusy(false); }
  }
  async function saveBuild(next: string[], complete = false) {
    if (!interactive) return; setBusy(true); onError(null);
    try { const update = await updateBuild(game, next, complete); setBusy(false); await present(update); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Build failed.'); }
    finally { setBusy(false); }
  }
  async function undo() {
    const current = playbackActive ? finalGame.current : game;
    if (playbackActive) finishPlayback();
    setBusy(true); onError(null);
    try { const update = await undoAction(current); finalGame.current = updateGame(update); onGame(updateGame(update)); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Undo failed.'); }
    finally { setBusy(false); }
  }
  function confirmReset() {
    if (playbackActive) finishPlayback();
    setResetOpen(true);
  }
  async function reset() {
    setResetOpen(false); setBusy(true); onError(null);
    try { const update = await resetGame(finalGame.current); onGameId(update.id); await present(update, 0); clearChoice(); }
    catch (cause) { onError(cause instanceof Error ? cause.message : 'Reset failed.'); }
    finally { setBusy(false); }
  }
  function clearChoice() { setTargetedCard(null); setMovementCard(null); setSelectedTargets([]); setPendingHandActionId(null); }
  function chooseCard(id: string) {
    const info = availability.get(id); if (!info?.enabled) return;
    if (info.selection === 'targets') { setTargetedCard(id); setMovementCard(null); setSelectedTargets([]); return; }
    if (info.selection === 'movement') { setMovementCard(id); setTargetedCard(null); return; }
    if (info.actionId) void act({ id: info.actionId });
  }
  async function playAll(definitionId: string) {
    if (busy) return;
    setBusy(true); onError(null); clearChoice();
    let current = game; const updates: GameUpdateView[] = [];
    const queuedInstanceIds = new Set(current.players[current.activePlayerId].hand
      .filter((card) => card.definitionId === definitionId).map((card) => card.id));
    try {
      while (queuedInstanceIds.size && !current.winner && current.phase === 'action' && current.activePlayerId === game.activePlayerId && !current.actions.selection) {
        const direct = current.actions.cards.find((item) => queuedInstanceIds.has(item.cardInstanceId)
          && item.enabled && item.batchPlayable && item.actionId);
        if (!direct?.actionId) break;
        queuedInstanceIds.delete(direct.cardInstanceId);
        const update = await takeAction(current, direct.actionId); updates.push(update); current = updateGame(update);
      }
      if (updates.length) { setBusy(false); current = await present(combinePlayAllUpdates(updates)); setBusy(true); }
    } catch (cause) {
      if (updates.length) { setBusy(false); current = await present(combinePlayAllUpdates(updates)); setBusy(true); }
      else onGame(current);
      onError(cause instanceof Error ? cause.message : 'Play all failed.');
    } finally { setBusy(false); }
  }
  function toggleTargetGroup(instanceIds: string[]) {
    const eligible = new Set(targetedCard ? availability.get(targetedCard)?.eligibleCardInstanceIds ?? [] : []);
    const candidates = instanceIds.filter((id) => eligible.has(id));
    setSelectedTargets((current) => {
      const selectedHere = candidates.filter((id) => current.includes(id));
      const maximum = targetedCard ? availability.get(targetedCard)?.maximumTargets ?? 0 : 0;
      if (selectedHere.length === candidates.length || current.length >= maximum) return current.filter((id) => !candidates.includes(id));
      const next = candidates.find((id) => !current.includes(id));
      return next && current.length < maximum ? [...current, next] : current;
    });
  }
  const targetInfo = targetedCard ? availability.get(targetedCard) : undefined;
  const targetAction = targetedCard && selectedTargets.length >= (targetInfo?.minimumTargets ?? 0) && selectedTargets.length <= (targetInfo?.maximumTargets ?? 0)
    ? availability.get(targetedCard)?.choices.find((action) => sameSelection(action.targetCardInstanceIds, selectedTargets)) : undefined;
  const targetCount = targetInfo?.minimumTargets === 0 ? `up to ${String(targetInfo.maximumTargets)}`
    : targetInfo?.minimumTargets === targetInfo?.maximumTargets ? String(targetInfo?.maximumTargets)
      : `${String(targetInfo?.minimumTargets)} or ${String(targetInfo?.maximumTargets)}`;
  const targetedInstance = targetedCard ? actor.hand.find((card) => card.id === targetedCard) : undefined;
  const targetedMechanic = targetedInstance ? game.cards[targetedInstance.definitionId]?.mechanic : undefined;
  const targetVerb = targetedMechanic === 'bullRush' || targetedMechanic === 'salvageShot' ? 'discard' : 'trash';
  const targetNoun = targetInfo?.maximumTargets === 1 ? 'card' : 'cards';
  const groupedTargetHint = (targetInfo?.maximumTargets ?? 0) > 1
    ? ' Click a grouped card twice to select two physical copies.' : '';
  const selectedTargetLabel = targetVerb === 'discard' ? 'Discard' : 'Trash';
  const movementChoices = movementCard ? availability.get(movementCard)?.choices ?? [] : [];
  const pendingHandSelection = !playbackActive && (game.actions.selection?.kind === 'discard' || game.actions.selection?.kind === 'optionalTrash')
    ? game.actions.selection : null;
  const pendingHandAction = pendingHandSelection?.choices.find((choice) => choice.id === pendingHandActionId);
  const pendingSkipAction = pendingHandSelection?.kind === 'optionalTrash'
    ? pendingHandSelection.choices.find((choice) => choice.cardInstanceId === null) : undefined;
  const currentSelection = playbackActive ? null : game.actions.selection;
  const pickerSelection = currentSelection?.kind === 'recover' || currentSelection?.kind === 'gain'
    ? currentSelection : null;
  const endAction = game.actions.phases.find((action) => action.kind === 'endAction');
  const endBuy = game.actions.phases.find((action) => action.kind === 'endBuy');
  const turnText = view.winner ? `${playerLabel(view, view.winner)} wins`
    : playbackActive && view.mode === 'ai' && view.activePlayerId === view.aiPlayerId ? 'AI turn'
      : view.phase === 'startingBuild' ? `${actorName} starting build`
        : `Turn ${view.turn} · ${actorName} ${view.phase}`;
  const buys = new Map(game.actions.buys.map((action) => [action.definitionId, action]));
  const marketAction = (id: string): void => {
    if (game.phase === 'startingBuild') void saveBuild([...game.buildProposal, id]);
    else { const buy = buys.get(id); if (buy) void act(buy); }
  };
  return <main className="table-shell" onContextMenuCapture={(event) => inspectCard(event, game.cards, setInspectedCardId)} onKeyDownCapture={(event) => inspectCardFromKeyboard(event, game.cards, setInspectedCardId)}>
    <TableHeader title={turnText} controls={<div className="phase-controls">{game.phase === 'startingBuild' ? <><strong data-testid="build-budget">{proposalCost} / {STARTING_BUDGET} · {firstBuyCarry(proposalCost)} carries</strong><button className="control-button primary" disabled={!interactive || proposalCost > STARTING_BUDGET} onClick={() => void saveBuild(game.buildProposal, true)}>Finish starting build</button></> : null}{game.mode === 'ai' ? <label className="animation-toggle"><input type="checkbox" checked={animateAi} onChange={(event) => onAnimateAi(event.target.checked)} /> Animate AI turns</label> : null}</div>} />
    {error ? <p role="alert" className="error">{error}</p> : null}
    <section className="arena-zone table-zone" data-winner={view.winner ?? undefined}><div className="range-label" data-testid="range">{view.range} · {Math.abs(view.fighters.ochre.position - view.fighters.indigo.position)} {Math.abs(view.fighters.ochre.position - view.fighters.indigo.position) === 1 ? 'space' : 'spaces'}{movementCard && !playbackActive ? <button className="movement-cancel" onClick={clearChoice}>Cancel movement</button> : null}</div><Board game={view} movementChoices={playbackActive ? [] : movementChoices} busy={!interactive} damageFeedback={damageFeedback} onMovement={(choice) => void act(choice)} />{victory ? <div className="victory-sweep" role="status" aria-live="polite" aria-atomic="true"><div className="victory-sweep__result"><span>{victory.kicker}</span><strong>{victory.title}</strong><small>{victory.detail}</small></div></div> : null}</section>
    {game.phase === 'startingBuild' ? <div className="build-strip"><strong>{actorName} selected</strong><div>{game.buildProposal.map((id, index) => <button key={`${id}-${index}`} aria-label={`Remove ${game.cards[id]?.name}`} onClick={() => void saveBuild(game.buildProposal.filter((_, position) => position !== index))}>{game.cards[id]?.name} ×</button>)}</div><span>{game.buildProposal.length ? 'Click a selected card to remove it.' : 'Click market piles to add cards.'}</span></div> : null}
    <CompactMarket cards={game.cards} fixedIds={game.fixedCardIds} variableIds={game.variableCardIds} supply={view.supply} onView={() => setMarketOpen(true)} onCard={marketAction} enabled={(id) => !playbackActive && (game.phase === 'startingBuild' ? !busy : Boolean(buys.get(id)) && !busy)} />
    <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2><div className="played-summary"><div className="played-resources"><strong data-testid="zone-money">{actorName} money: {actor.money}</strong><strong className="mana-counter" data-testid="zone-mana">Mana: {actor.mana}</strong></div><span>Each Treasure type shares one stack. Other cards stack only when consecutive.</span></div></div><div className="played-row" data-testid="played-row">{playedGroups.map((group) => {
      const destination = group.instances.some((card) => playedDestinationIds.has(card.id)) ? `handToPlayed-${group.definitionId}` : undefined;
      const visibleGroup = { ...group, instances: group.instances.filter((card) => !playedDestinationIds.has(card.id)) };
      if (!visibleGroup.instances.length) return <div key={group.instances[0]!.id} className="played-card-slot animation-placeholder" data-played-definition-id={group.definitionId}><article className={`card full-card played-card card--${game.cards[group.definitionId]!.family}`} data-animation-destination={destination} /></div>;
      const pendingAction = pendingHandSelection?.choices.find((choice) => choice.cardInstanceId && visibleGroup.instances.some((card) => card.id === choice.cardInstanceId));
      return <PlayedCard key={visibleGroup.instances[0]!.id} card={game.cards[group.definitionId]!} group={visibleGroup} destination={destination} pendingAction={pendingAction} selected={pendingAction?.id === pendingHandActionId} busy={!interactive} onSelect={setPendingHandActionId} />;
    })}{!playedGroups.length ? <p className="empty-row">Cards move here from your hand.</p> : null}</div></section>
    <section className={`hand-panel table-zone${playbackActive && view.mode === 'ai' && view.activePlayerId === view.aiPlayerId ? ` hand-panel--ai hand-panel--${view.aiPlayerId}` : ''}`}><div className="zone-title"><h2>{playbackActive && view.mode === 'ai' && view.activePlayerId === view.aiPlayerId ? 'AI hand' : `${actorName} hand`}</h2><span>{actor.zoneCounts.hand} physical cards</span></div><div className="hand-control-bar">
      {!playbackActive && targetedCard ? <div className="choice-bar"><p>Select {targetCount} {targetNoun} to {targetVerb}.{groupedTargetHint} {selectedTargets.length} selected.</p><div><button className="control-button primary" disabled={!targetAction} onClick={() => targetAction && void act(targetAction)}>{selectedTargets.length === 0 ? 'Play with no targets' : `${selectedTargetLabel} selected ${selectedTargets.length === 1 ? 'card' : 'cards'}`}</button><button className="control-button" onClick={clearChoice}>Cancel</button></div></div> : pendingHandSelection ? <div className="hand-choice-controls" role="group" aria-label={pendingHandSelection.kind === 'discard' ? 'Discard choice' : 'Trash choice'}><strong>{pendingHandSelection.kind === 'discard' ? 'Select one card to discard' : 'Select one card to trash, or skip'}</strong><button className="control-button primary" disabled={busy || !pendingHandAction} onClick={() => pendingHandAction && void act(pendingHandAction)}>{pendingHandSelection.kind === 'discard' ? 'Confirm discard' : 'Confirm trash'}</button>{pendingSkipAction ? <button className="control-button" disabled={busy} onClick={() => void act(pendingSkipAction)}>Skip</button> : null}</div> : !playbackActive && !movementCard && endAction ? <button className="hand-phase-button" disabled={busy} onClick={() => void act(endAction)}>End Action phase</button> : !playbackActive && !movementCard && endBuy ? <button className="hand-phase-button" disabled={busy} onClick={() => void act(endBuy)}>End Buy phase</button> : null}
    </div><div className="hand-content"><ZonePiles game={view} playerId={view.activePlayerId} /><div className="hand-row" data-testid="hand-grid">{handGroups.map((group, index) => {
      const destination = destinations.some((item) => item.kind === 'drawToHand' && item.definitionId === group.definitionId) ? `drawToHand-${group.definitionId}` : undefined;
      if (!group.instances.length) return <div key={group.definitionId} className="hand-card-slot animation-placeholder" style={{ zIndex: index + 1 }} data-hand-definition-id={group.definitionId} data-animation-destination={destination}><div className="hand-card-frame" /></div>;
      const enabledInstance = group.instances.find((card) => availability.get(card.id)?.enabled) ?? group.instances[0]!;
      const info = availability.get(enabledInstance.id);
      const targetIds = targetedCard ? group.instances.filter((card) => availability.get(targetedCard)?.eligibleCardInstanceIds.includes(card.id)).map((card) => card.id) : [];
      const selectedCount = group.instances.filter((card) => selectedTargets.includes(card.id)).length;
      const pendingActions = pendingHandSelection?.choices.filter((choice) => choice.cardInstanceId && group.instances.some((card) => card.id === choice.cardInstanceId)) ?? [];
      const pendingAction = pendingActions[0];
      const pendingSelected = pendingActions.some((choice) => choice.id === pendingHandActionId);
      const unavailable = playbackActive ? false : pendingHandSelection ? !pendingAction : targetedCard ? targetIds.length === 0 : !info?.enabled;
      const batchPlayableCount = group.instances.filter((card) => { const action = availability.get(card.id); return action?.enabled && action.batchPlayable && Boolean(action.actionId); }).length;
      return <div className="hand-card-slot" key={group.definitionId} style={{ zIndex: index + 1 }} data-hand-definition-id={group.definitionId} data-animation-destination={destination}><div className="hand-card-frame">{group.instances.length > 1 ? <span className="quantity-badge" data-testid={`hand-count-${group.definitionId}`}>×{group.instances.length}</span> : null}<button className={`card full-card card--${game.cards[group.definitionId]!.family}${unavailable ? ' card--unavailable' : ''}${selectedCount ? ' card--target' : ''}${pendingSelected || movementCard === enabledInstance.id || targetedCard === enabledInstance.id ? ' card--selected' : ''}`} data-card-name={game.cards[group.definitionId]!.name} data-card-instance-id={enabledInstance.id} data-card-count={group.instances.length} disabled={!interactive} aria-disabled={unavailable || playbackActive} title={!targetedCard && !pendingHandSelection ? info?.reason ?? undefined : undefined} onClick={() => { if (unavailable || playbackActive) return; if (pendingAction) setPendingHandActionId(pendingAction.id); else if (targetedCard) toggleTargetGroup(targetIds); else chooseCard(enabledInstance.id); }}><CardFace card={game.cards[group.definitionId]!} />{selectedCount ? <span className="selected-count">Selected ×{selectedCount}</span> : null}{!playbackActive && info?.reason && !targetedCard && !pendingHandSelection && game.cards[group.definitionId]!.type === 'action' ? <em>{info.reason}</em> : null}</button>{!playbackActive && batchPlayableCount >= 2 && !targetedCard && !pendingHandSelection ? <button className="play-all-button" disabled={busy} onClick={() => void playAll(group.definitionId)}>Play all</button> : null}</div></div>;
    })}</div></div></section>
    <ActionRail game={view} busy={busy} playbackActive={playbackActive} onUndo={() => void undo()} onReset={confirmReset} onNew={() => { if (playbackActive) finishPlayback(); onNew(); }} onCatalog={() => setCatalogOpen(true)} />
    <FlyingCards flights={flights} renderCard={(card) => <CardFace card={card} />} />
    <PurchasePreview reveal={purchaseReveal} renderCard={(card) => <CardFace card={card} />} />
    {marketOpen ? <MarketDialog cards={game.cards} fixedIds={game.fixedCardIds} variableIds={game.variableCardIds} onClose={() => setMarketOpen(false)} /> : null}
    {catalogOpen ? <CardCatalogDialog cards={game.cards} onClose={() => setCatalogOpen(false)} /> : null}
    {inspectedCardId && game.cards[inspectedCardId] ? <CardInspectDialog card={game.cards[inspectedCardId]} onClose={() => setInspectedCardId(null)} /> : null}
    {pickerSelection ? <CardPicker cards={game.cards} kind={pickerSelection.kind === 'recover' ? 'recover' : 'gain'} choices={pickerSelection.choices} busy={busy} onChoose={(choice) => void act(choice)} /> : null}
    {resetOpen ? <ResetDialog onAccept={() => void reset()} onCancel={() => setResetOpen(false)} /> : null}
  </main>;
}

function TableHeader({ title, controls }: { title: string; controls: React.ReactNode }) { return <header className="table-header"><div className="brand"><h1><a className="brand-home" href="/" aria-label="Deckfront home"><span className="visually-hidden">Deckfront</span><svg className="brand-logo" viewBox="8 0 210 56" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><path d="m27 6 17 6v14c0 11.8-6.8 18.8-17 23.5-10.2-4.7-17-11.7-17-23.5V12z" fill="#c79b38" stroke="#f4e8c3" strokeWidth="2.6" strokeLinejoin="round"/><path d="M20.5 17.5v21h6c5.8 0 8.8-3.4 8.8-10.5s-3-10.5-8.8-10.5z" fill="#102d26" stroke="#f4e8c3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><text x="59" y="39" fill="#e8dfca" fontFamily="'Grenze Gotisch', serif" fontSize="38.5" fontWeight="600">Deckfront</text><path d="M61 48h142" stroke="#c79b38" strokeWidth="2"/><circle cx="210" cy="48" r="2.5" fill="#c79b38" stroke="#f4e8c3" strokeWidth="1"/></svg></a></h1></div><div className="turn-banner" role="status">{title}</div><div className="table-header__controls">{controls}</div></header>; }
function PreviewArena({ mode, human }: { mode: GameMode; human: PlayerId }) {
  const labels = { mode, aiPlayerId: mode === 'ai' ? (human === 'ochre' ? 'indigo' : 'ochre') : null } as const;
  return <section className="arena-zone table-zone"><div className="range-label">Tactical map · Near · 1 space</div><div className="arena battlefield" role="group" aria-label="Six space line arena">{[1,2,3,4,5,6].map((space) => <div className="arena-space" key={space}><span className="arena-space__number">{space}</span><div className="arena-space__fighters">{space === 3 ? <FighterCounter playerId="ochre" health={playerStartingHealth(50, true)} position={space} label={playerLabel(labels, 'ochre')} shortLabel={playerShortLabel(labels, 'ochre')} /> : null}{space === 4 ? <FighterCounter playerId="indigo" health={50} position={space} label={playerLabel(labels, 'indigo')} shortLabel={playerShortLabel(labels, 'indigo')} /> : null}</div></div>)}</div></section>;
}
function EmptyPlayed() { return <section className="played-panel table-zone"><div className="zone-title"><h2>Played this turn</h2></div><div className="played-row"><p className="empty-row">Cards move here from your hand.</p></div></section>; }
function SetupRail({ mode, startingDraftEnabled, animateAi, human, difficulty, statistics, statisticsLoading, onMode, onStartingDraft, onAnimateAi, onHuman, onDifficulty, onRefresh, onCatalog, onStart }: {
  mode: GameMode; startingDraftEnabled: boolean; animateAi: boolean; human: PlayerId; difficulty: AiDifficulty;
  statistics: GameStatistics | null; statisticsLoading: boolean;
  onMode: (mode: GameMode) => void; onStartingDraft: (enabled: boolean) => void; onAnimateAi: (enabled: boolean) => void; onHuman: (playerId: PlayerId) => void;
  onDifficulty: (difficulty: AiDifficulty) => void; onRefresh: () => void; onCatalog: () => void; onStart: () => void;
}) {
  const selectedStatistics = statistics?.difficulties.find((entry) => entry.difficulty === difficulty);
  return <aside className="setup-rail" aria-label="Game setup"><header><span>Game setup</span><h2>New match</h2></header><div className="setup-rail__body">
    <fieldset className="setup-group"><legend>Opponent</legend><div className="setup-options"><button type="button" aria-pressed={mode === 'local'} onClick={() => onMode('local')}>Local players</button><button type="button" aria-pressed={mode === 'ai'} onClick={() => onMode('ai')}>Play against AI</button></div></fieldset>
    {mode === 'ai' ? <><fieldset className="setup-group"><legend>Turn order</legend><div className="setup-options"><button type="button" aria-pressed={human === 'ochre'} onClick={() => onHuman('ochre')}>I go first</button><button type="button" aria-pressed={human === 'indigo'} onClick={() => onHuman('indigo')}>AI goes first</button></div></fieldset><fieldset className="setup-group"><legend>AI strength</legend><div className="setup-options setup-options--four">{AI_DIFFICULTIES.map((value) => <button type="button" key={value} aria-pressed={difficulty === value} onClick={() => onDifficulty(value)}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}</div></fieldset>{statisticsLoading ? <section className="setup-statistics" aria-label={`${difficulty} sitewide results`}><header className="setup-statistics__header"><span>Sitewide record</span><span>{difficulty[0]!.toUpperCase() + difficulty.slice(1)}</span></header><p role="status">Loading results…</p></section> : selectedStatistics ? <section className="setup-statistics" aria-label={`${difficulty} sitewide results`}><header className="setup-statistics__header"><span>Sitewide record</span><span>{difficulty[0]!.toUpperCase() + difficulty.slice(1)}</span></header><div className="setup-statistics__duel"><span className="setup-statistics__side"><span>Human</span><strong>{selectedStatistics.humanWins}</strong></span><span className="setup-statistics__divider">—</span><span className="setup-statistics__side setup-statistics__side--ai"><span>AI</span><strong>{selectedStatistics.aiWins}</strong></span></div><p className="setup-statistics__games">{selectedStatistics.gamesPlayed} {selectedStatistics.gamesPlayed === 1 ? 'game' : 'games'} played</p></section> : null}<label className="setup-switch"><span><strong>Animate AI turns</strong><small>{animateAi ? 'Watch the AI play each card.' : 'Show the final result immediately.'}</small></span><input aria-label="Animate AI turns" type="checkbox" checked={animateAi} onChange={(event) => onAnimateAi(event.target.checked)} /><i aria-hidden="true" /></label></> : null}
    {mode === 'local' ? <label className="setup-switch"><span><strong>Starting draft</strong><small>{startingDraftEnabled ? 'Build a custom opening deck.' : 'Start with 7 Copper and 3 Scrap.'}</small></span><input type="checkbox" checked={startingDraftEnabled} onChange={(event) => onStartingDraft(event.target.checked)} /><i aria-hidden="true" /></label> : null}
    <div className="setup-market-actions"><button className="control-button" onClick={onRefresh}>Refresh market</button><button className="control-button" onClick={onCatalog}>View all cards</button></div>
  </div><button className="control-button primary setup-start" onClick={onStart}>Start game</button></aside>;
}
function CompactMarket({ cards, fixedIds, variableIds, supply, onView, onCard, enabled }: {
  cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[];
  supply?: Record<string, number>; onView: () => void; onCard?: (id: string) => void; enabled?: (id: string) => boolean;
}) {
  const pile = (id: string, fixed: boolean) => {
    const card = cards[id]; if (!card) return null;
    const available = Boolean(onCard && enabled?.(id));
    const quantityRemaining = supply === undefined ? 10 : supply[id] ?? 0;
    const quantity = card.type === 'treasure' ? '∞' : `×${quantityRemaining}`;
    const outOfStock = card.type !== 'treasure' && supply !== undefined && quantityRemaining === 0;
    return <button key={id} data-market-card={card.name} data-market-definition-id={id} className={`${fixed ? 'fixed-pile' : 'kingdom-pile'} family-${card.family}${outOfStock ? ' pile--out-of-stock' : ''}`} aria-disabled={!available} onClick={() => { if (available) onCard?.(id); }}>
      {fixed ? <><span className="fixed-pile__title">{card.name}</span><span className="fixed-pile__art"><img src={`/card-art/${id}.jpg`} alt="" loading="eager" decoding="async" /><span className="fixed-pile__count">{quantity}</span><span className="pile-cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span></span></>
        : <><img src={`/card-art/${id}.jpg`} alt="" loading="eager" decoding="async" /><span className="kingdom-pile__top"><strong className="kingdom-pile__title">{card.name}</strong><span className="kingdom-pile__count">{quantity}</span></span><span className="pile-cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span><span className="kingdom-pile__effect">{card.headline}</span></>}
      {outOfStock ? <span className="pile-stock-label">Out of stock</span> : null}
    </button>;
  };
  return <section className="market-zone table-zone"><div className="zone-title"><h2>Market</h2><button className="text-button" onClick={onView}>Card reference</button></div><div className="market-layout"><section className="market-section"><h3 className="market-section__heading">Fixed piles</h3><div className="pile-grid pile-grid--fixed">{fixedIds.map((id) => pile(id, true))}</div></section><section className="market-section"><h3 className="market-section__heading">Battlefield piles</h3><div className="pile-grid pile-grid--kingdom">{variableIds.map((id) => pile(id, false))}</div></section></div></section>;
}

function cardIdAt(target: Element): string | undefined {
  const source = target.closest<HTMLElement>('[data-card-definition-id],[data-market-definition-id]')
    ?? target.querySelector<HTMLElement>('[data-card-definition-id],[data-market-definition-id]');
  return source?.dataset.cardDefinitionId ?? source?.dataset.marketDefinitionId;
}
function inspectCard(event: React.MouseEvent<HTMLElement>, cards: Record<string, CardDefinition>, show: (id: string) => void) {
  const definitionId = cardIdAt(event.target as Element);
  if (!definitionId || !cards[definitionId]) return;
  event.preventDefault(); event.stopPropagation(); show(definitionId);
}
function inspectCardFromKeyboard(event: React.KeyboardEvent<HTMLElement>, cards: Record<string, CardDefinition>, show: (id: string) => void) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  const definitionId = cardIdAt(event.target as Element);
  if (!definitionId || !cards[definitionId]) return;
  event.preventDefault(); event.stopPropagation(); show(definitionId);
}

export function InstructionsDialog({ onDismiss, onNeverShow }: { onDismiss: () => void; onNeverShow: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="instructions-dialog" aria-labelledby="instructions-title" onClose={onDismiss}>
    <div className="instructions-dialog__surface">
      <header className="instructions-dialog__header"><span>How to play</span><h2 id="instructions-title">Build your deck. Control the distance.</h2><p>Deckfront combines Dominion-style deckbuilding with a tactical battlefield.</p></header>
      <div className="instructions-dialog__content">
        <section className="instructions-deck" aria-labelledby="instructions-deck-title">
          <div className="instructions-section-title"><span className="instructions-section-icon" aria-hidden="true">♜</span><div><small>Your deck</small><h3 id="instructions-deck-title">Build as you battle</h3></div></div>
          <p>Buy stronger cards from the market. Bought cards go into your deck and appear in later hands.</p>
          <div className="starter-deck" aria-label="Your starting deck has 7 Copper cards and 3 Scrap cards"><span><strong>7</strong> Copper</span><b>+</b><span><strong>3</strong> Scrap</span></div>
          <ul className="instructions-rules"><li><strong>No action limit</strong><span>Play every card in your hand if you can.</span></li><li><strong>No buy limit</strong><span>Buy as many cards as your money allows.</span></li></ul>
        </section>
        <section className="instructions-range" aria-labelledby="instructions-range-title">
          <div className="instructions-section-title"><span className="instructions-section-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M24 5v10M24 33v10M5 24h10M33 24h10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span><div><small>The battlefield</small><h3 id="instructions-range-title">Position changes your attacks</h3></div></div>
          <div className="instructions-map" role="img" aria-label="A battlefield with six spaces; fighters are on spaces 2 and 5"><span>1</span><span>2<i className="instructions-fighter instructions-fighter--ochre" /></span><span>3</span><span>4</span><span>5<i className="instructions-fighter instructions-fighter--indigo" /></span><span>6</span></div>
          <p className="instructions-map-caption">Move across six spaces to enter the range your cards need.</p>
          <div className="range-rules">
            <article className="range-rule range-rule--melee"><span aria-hidden="true">⚔</span><div><h4>Melee · Close</h4><p>You and your opponent must be on the same space.</p></div></article>
            <article className="range-rule range-rule--ranged"><span aria-hidden="true">➶</span><div><h4>Ranged · Near or Far</h4><p>You and your opponent must be on different spaces.</p></div></article>
            <article className="range-rule range-rule--mana"><span aria-hidden="true">✦</span><div><h4>Mage · Any range</h4><p>Carry up to 2 unspent mana from turn to turn.</p></div></article>
          </div>
        </section>
      </div>
      <footer><button className="control-button" onClick={() => ref.current?.close()}>Dismiss</button><button className="control-button primary" onClick={() => { onNeverShow(); ref.current?.close(); }}>Don’t show this again</button></footer>
    </div>
  </dialog>;
}

function CardInspectDialog({ card, onClose }: { card: CardDefinition; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    const close = () => onCloseRef.current();
    dialog.addEventListener('close', close); if (!dialog.open) dialog.showModal();
    return () => dialog.removeEventListener('close', close);
  }, []);
  return <dialog ref={ref} className="card-inspect-dialog" aria-label={`${card.name} details`} onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}><div className="card-inspect-frame"><article className={`card full-card card--${card.family}`}><CardFace card={card} /></article><button className="card-inspect-close" aria-label="Close card details" onClick={() => ref.current?.close()} /></div></dialog>;
}

function ModalDialog({ className, surfaceClassName, titleId, kicker, title, closeLabel, onClose, children }: {
  className: string; surfaceClassName: string; titleId: string; kicker: string; title: string; closeLabel: string; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    const close = () => onCloseRef.current();
    dialog.addEventListener('close', close); if (!dialog.open) dialog.showModal();
    return () => dialog.removeEventListener('close', close);
  }, []);
  return <dialog ref={ref} className={className} aria-labelledby={titleId} onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}><div className={surfaceClassName}><header><div><span>{kicker}</span><h2 id={titleId}>{title}</h2></div><button aria-label={closeLabel} onClick={() => ref.current?.close()}>×</button></header>{children}</div></dialog>;
}

function MarketDialog({ cards, fixedIds, variableIds, onClose }: { cards: Record<string, CardDefinition>; fixedIds: readonly string[]; variableIds: readonly string[]; onClose: () => void }) {
  const ids = [...fixedIds, ...variableIds];
  return <ModalDialog className="market-dialog" surfaceClassName="market-dialog__surface" titleId="market-dialog-title" kicker="Complete market" title="Card reference" closeLabel="Close market" onClose={onClose}><div className="market-dialog__grid">{ids.map((id) => <article key={id} className={`card full-card reference-card card--${cards[id]!.family}`} data-card-name={cards[id]!.name}><CardFace card={cards[id]!} /></article>)}</div></ModalDialog>;
}

function CardCatalogDialog({ cards, onClose }: { cards: Record<string, CardDefinition>; onClose: () => void }) {
  const groups = groupCardCatalog(Object.values(cards));
  return <ModalDialog className="catalog-dialog" surfaceClassName="catalog-dialog__surface" titleId="catalog-dialog-title" kicker={`${Object.keys(cards).length} cards`} title="All cards" closeLabel="Close all cards" onClose={onClose}><div className="catalog-dialog__body">{groups.map((group) => <section className="catalog-section" data-catalog-family={group.family} key={group.family}><h3>{group.heading}</h3><div className="catalog-section__grid">{group.cards.map((card) => <div className="catalog-card-frame" key={card.id}><article className={`card full-card catalog-card card--${card.family}`} data-card-name={card.name} data-card-cost={card.cost}><CardFace card={card} /></article></div>)}</div></section>)}</div></ModalDialog>;
}

function ZonePiles({ game, playerId }: { game: GameView; playerId: PlayerId }) {
  const player = game.players[playerId];
  const discard = player.discardTop ? game.cards[player.discardTop.definitionId] : null;
  return <aside className="zone-piles" aria-label={`${playerLabel(game, playerId)} draw and discard piles`}>
    <div className="zone-pile"><div className="card-back" data-testid="draw-pile" aria-label={`${player.zoneCounts.draw} ${cardWord(player.zoneCounts.draw)} in draw pile`}><span>Deckfront</span></div><strong>Draw ×{player.zoneCounts.draw}</strong></div>
    <div className="zone-pile"><div className="discard-top" data-testid="discard-pile" aria-label={`${player.zoneCounts.discard} ${cardWord(player.zoneCounts.discard)} in discard pile`}>{discard ? <article className={`card full-card card--${discard.family}`} data-discard-card={discard.name}><CardFace card={discard} /></article> : <span>Empty</span>}</div><strong>Discard ×{player.zoneCounts.discard}</strong></div>
  </aside>;
}

function CardPicker({ cards, kind, choices, busy, onChoose }: {
  cards: Record<string, CardDefinition>;
  kind: 'recover' | 'gain';
  choices: SelectionActionPresentation[];
  busy: boolean;
  onChoose: (choice: SelectionActionPresentation) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  const groups = new Map<string, SelectionActionPresentation[]>();
  for (const choice of choices) {
    if (!choice.definitionId) continue;
    const group = groups.get(choice.definitionId);
    if (group) group.push(choice); else groups.set(choice.definitionId, [choice]);
  }
  return <dialog ref={ref} className="card-picker" aria-label={kind === 'recover' ? 'Choose a card to recover' : 'Choose a card to gain'} onCancel={(event) => event.preventDefault()}><div className="card-picker__surface"><header><span>{kind === 'recover' ? 'Discard pile' : 'Available supply'}</span><h2>{kind === 'recover' ? 'Choose a card to recover' : 'Choose a card to gain'}</h2></header><div className="card-picker__grid">{[...groups].map(([definitionId, actions]) => { const card = cards[definitionId]!; return <button key={definitionId} className="picker-card-button" disabled={busy} aria-label={actions[0]!.label} onClick={() => onChoose(actions[0]!)}><article className={`card full-card card--${card.family}`} data-picker-card={card.name} data-card-count={actions.length}><CardFace card={card} /></article>{actions.length > 1 ? <span className="quantity-badge" data-testid={`picker-count-${definitionId}`}>×{actions.length}</span> : null}</button>; })}</div></div></dialog>;
}

export function CardFace({ card }: { card: CardDefinition }) { const copyLength = card.headline.length + (card.detail?.length ?? 0); const detailDensity = copyLength > 150 ? ' card__detail--very-dense' : copyLength > 90 ? ' card__detail--dense' : ''; return <span className="card__face" data-card-definition-id={card.id}><span className="card__header"><strong className="card__title">{card.name}</strong></span><img className="card__image" src={`/card-art/${card.id}.jpg`} alt="" loading="eager" decoding="async" /><span className="card__rules"><strong className="card__headline">{card.headline}</strong>{card.detail ? <small className={`card__detail${detailDensity}`}>{card.detail}</small> : null}</span><span className="card__cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span></span>; }
function PlayedCard({ card, group, destination, pendingAction, selected, busy, onSelect }: {
  card: CardDefinition; group: PlayedGroup; destination?: string | undefined; pendingAction?: SelectionActionPresentation | undefined;
  selected: boolean; busy: boolean; onSelect: (actionId: string) => void;
}) {
  const count = group.instances.length;
  const className = `card full-card played-card card--${card.family}${selected ? ' card--selected' : ''}`;
  const attributes = { 'data-played-card-name': card.name, 'data-played-definition-id': card.id, 'data-card-count': count, 'data-animation-destination': destination };
  return <div className="played-card-slot">{count > 1 ? <span className="quantity-badge played-card-count" data-testid={`played-count-${card.id}`}>×{count}</span> : null}{pendingAction ? <button className={className} {...attributes} disabled={busy} aria-label={pendingAction.label} onClick={() => onSelect(pendingAction.id)}><CardFace card={card} /></button> : <article className={className} {...attributes}><CardFace card={card} /></article>}</div>;
}
function ResetDialog({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  return <dialog ref={ref} className="reset-dialog" aria-labelledby="reset-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <div><h2 id="reset-title">Reset this game?</h2><p>This starts a fresh attempt with the same market. Your current attempt will close.</p><footer><button className="control-button primary" onClick={onAccept}>Yes, reset</button><button className="control-button" onClick={onCancel}>Cancel</button></footer></div>
  </dialog>;
}
function ActionRail({ game, busy, playbackActive, onUndo, onReset, onNew, onCatalog }: { game: GameView; busy: boolean; playbackActive: boolean; onUndo: () => void; onReset: () => void; onNew: () => void; onCatalog: () => void }) {
  const log = useRef<HTMLOListElement>(null);
  const newestEvent = game.events.at(-1);
  const newestEventIdentity = newestEvent ? `${newestEvent.sequence}:${newestEvent.type}:${newestEvent.playerId}:${JSON.stringify(newestEvent.detail)}` : '';
  useEffect(() => { const element = log.current; if (element) element.scrollTop = element.scrollHeight; }, [newestEventIdentity]);
  return <aside className="action-rail" aria-label="Action history, deck compositions, and game controls">
    <section className="action-log"><header><div><span>Public record</span><h2>Actions</h2></div></header><ol ref={log} data-testid="action-log">{game.events.map((event) => <li key={event.sequence} className={event.type === 'turn' ? 'action-log__turn' : undefined}><span>{playerLabel(game, event.playerId)}</span><strong>{eventText(game, event)}</strong></li>)}</ol></section>
    <section className="rail-decks"><h2>Deck compositions</h2><div><DeckSummary game={game} playerId="ochre" /><DeckSummary game={game} playerId="indigo" /></div></section>
    <nav className="rail-controls" aria-label="Game controls"><button className="rail-control-button" aria-label="Undo last action" disabled={!game.canUndo || busy} onClick={onUndo}>Undo</button><button className="rail-control-button" disabled={busy || game.phase === 'startingBuild'} onClick={onReset}>Reset</button><button className="rail-control-button" onClick={onNew}>New game</button><button className="rail-control-button" onClick={onCatalog}>View all cards</button>{playbackActive ? <span className="playback-label" role="status" aria-live="polite" aria-atomic="true">Playing AI turn…</span> : null}</nav>
  </aside>;
}
function DeckSummary({ game, playerId }: { game: GameView; playerId: PlayerId }) { const entries = Object.entries(game.players[playerId].deckCounts).sort(([left], [right]) => (game.cards[left]?.name ?? left).localeCompare(game.cards[right]?.name ?? right)); return <section className={`deck-summary deck-summary--${playerId}`} data-testid={`deck-summary-${playerId}`}><h3>{playerLabel(game, playerId)}</h3><div>{entries.map(([id, count]) => <span key={id} data-deck-card={game.cards[id]?.name}><span>{game.cards[id]?.name ?? id}</span><strong>×{count}</strong></span>)}</div></section>; }
function groupCards(cards: CardInstance[]): CardGroup[] { const groups = new Map<string, CardGroup>(); for (const card of cards) { const group = groups.get(card.definitionId); if (group) group.instances.push(card); else groups.set(card.definitionId, { definitionId: card.definitionId, instances: [card] }); } return [...groups.values()]; }
function stableHandGroups(cards: CardInstance[], turnKey: string, orders: Map<string, string[]>, destinationDefinitionIds: readonly string[] = []): CardGroup[] {
  const groups = groupCards(cards);
  const activeDefinitionIds = groups.map((group) => group.definitionId);
  for (const definitionId of destinationDefinitionIds) if (!activeDefinitionIds.includes(definitionId)) activeDefinitionIds.push(definitionId);
  let order = orders.get(turnKey);
  if (!order) { order = [...activeDefinitionIds]; orders.set(turnKey, order); }
  for (const definitionId of activeDefinitionIds) if (!order.includes(definitionId)) order.push(definitionId);
  const positions = new Map(order.map((definitionId, index) => [definitionId, index]));
  const groupsByDefinition = new Map(groups.map((group) => [group.definitionId, group]));
  return activeDefinitionIds.map((definitionId) => groupsByDefinition.get(definitionId) ?? { definitionId, instances: [] })
    .sort((left, right) => positions.get(left.definitionId)! - positions.get(right.definitionId)!);
}
function groupPlayedCards(cards: CardInstance[], definitions: Record<string, CardDefinition>): PlayedGroup[] {
  const groups: PlayedGroup[] = []; const treasureGroups = new Map<string, PlayedGroup>(); let previous: CardInstance | undefined;
  for (const card of cards) {
    if (definitions[card.definitionId]?.type === 'treasure') {
      const existing = treasureGroups.get(card.definitionId);
      if (existing) existing.instances.push(card);
      else { const group = { definitionId: card.definitionId, instances: [card] }; groups.push(group); treasureGroups.set(card.definitionId, group); }
    } else if (previous?.definitionId === card.definitionId && definitions[previous.definitionId]?.type !== 'treasure') groups.at(-1)!.instances.push(card);
    else groups.push({ definitionId: card.definitionId, instances: [card] });
    previous = card;
  }
  return groups;
}
function victoryMessage(game: GameView, winner: PlayerId): { kicker: string; title: string; detail: string } {
  if (game.mode === 'ai') return winner === game.aiPlayerId
    ? { kicker: 'AI victory', title: 'AI wins!', detail: 'The AI controls the battlefield.' }
    : { kicker: 'Human victory', title: 'You win!', detail: 'The battlefield is yours.' };
  return { kicker: 'Match complete', title: `${playerLabel(game, winner)} wins!`, detail: 'The battlefield is theirs.' };
}
function cardWord(count: number): string { return count === 1 ? 'card' : 'cards'; }
function eventPlayerName(game: GameView, value: unknown): string { return value === 'ochre' || value === 'indigo' ? playerLabel(game, value) : 'Unknown player'; }
function eventText(game: GameView, event: PublicGameEvent): string {
  const detail = event.detail;
  const cardName = (): string => game.cards[String(detail.definitionId)]?.name ?? String(detail.definitionId);
  switch (event.type) {
    case 'buildComplete': return `Completed a ${String(detail.count)}-card starting build`;
    case 'cardPlayed': return `Played ${cardName()}`;
    case 'purchase': return `Bought ${cardName()}`;
    case 'damage': return `Dealt ${String(detail.amount)} damage to ${eventPlayerName(game, detail.targetId)}`;
    case 'move': if (detail.source === 'drive') return `Moved both fighters ${String(detail.movement)} to space ${String(detail.to)}`; if (detail.source === 'repellingShot') return `Repelling Shot increased the distance; one fighter moved ${String(detail.movement)} to space ${String(detail.to)}`; if (detail.movement === 'stay') return `Stayed on space ${String(detail.to)}`; return `Moved ${String(detail.movement)} to space ${String(detail.to)}`;
    case 'wallCollision': return `Wall blocked ${String(detail.direction)}; neither fighter moved`;
    case 'condition': return `${String(detail.condition)} ${detail.change === 'set' ? 'applied to' : 'consumed from'} ${eventPlayerName(game, detail.targetId)}`;
    case 'discard': return `Discarded ${cardName()}`;
    case 'recover': return 'Recovered a card to hand';
    case 'gain': return `Gained ${cardName()}`;
    case 'trash': return `Trashed ${cardName()}`;
    case 'draw': return `Drew ${String(detail.count)} ${detail.count === 1 ? 'card' : 'cards'}`;
    case 'phase': return `Started Buy phase with ${String(detail.money)} money`;
    case 'turn': return `Turn ${String(detail.turn)} started`;
    case 'victory': return 'Won the game';
    case 'mana': return `${Number(detail.amount) >= 0 ? 'Gained' : 'Spent'} ${String(Math.abs(Number(detail.amount)))} mana`;
  }
}
function combinePlayAllUpdates(updates: GameUpdateView[]): GameUpdateView {
  const final = updates.at(-1); if (!final) throw new Error('Play all produced no accepted updates.');
  const frames = updates.flatMap((update) => update.presentation.frames); const lastFrame = frames.at(-1);
  if (!lastFrame) return { ...final, presentation: { frames: [] } };
  return { ...final, presentation: { frames: [{ ...lastFrame, commandType: 'playAll', transfers: frames.flatMap((frame) => frame.transfers) }] } };
}
function batchConsecutiveAiPlays(frames: PresentationFrame[], aiPlayerId: PlayerId | null): PresentationFrame[] {
  if (!aiPlayerId) return frames;
  const result: PresentationFrame[] = [];
  for (let index = 0; index < frames.length;) {
    const first = frames[index]!;
    const firstPlay = aiCardPlay(first, aiPlayerId);
    if (!firstPlay) { result.push(first); index += 1; continue; }
    const group = [first]; let nextIndex = index + 1;
    while (nextIndex < frames.length) {
      const next = frames[nextIndex]!; const nextPlay = aiCardPlay(next, aiPlayerId);
      if (nextPlay?.card.definitionId !== firstPlay.card.definitionId) break;
      group.push(next); nextIndex += 1;
    }
    const last = group.at(-1)!;
    result.push(group.length === 1 ? first : { ...last, commandType: 'aiPlayAll', transfers: group.flatMap((frame) => frame.transfers) });
    index = nextIndex;
  }
  return result;
}
function aiCardPlay(frame: PresentationFrame, aiPlayerId: PlayerId) {
  if (frame.playerId !== aiPlayerId) return null;
  const plays = frame.transfers.filter((transfer) => !transfer.hidden && transfer.kind === 'handToPlayed' && transfer.playerId === aiPlayerId);
  return plays.length === 1 ? plays[0]! : null;
}
function nextPaint(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function sameSelection(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((id) => right.includes(id)); }
