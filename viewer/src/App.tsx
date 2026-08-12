import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { coordKey, type BoardState } from '../../src/board/schema';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { cloneState } from '../../src/core/state';
import type { CardDefinition, CardId, GameState, PlayerState } from '../../src/core/types';
import { buildBoardAnnotations, type BoardAnnotation } from './annotations';
import { loadBoardBundle, loadReplayBundle, timelineUrlFromLocation, type BoardBundle, type ReplayBundle } from './boardState';
import { buildLayout, hexPoints, hexToPixel } from './hex';
import { buffedUnitStats } from './unitStats';

const playerClasses: Record<string, string> = {
  P1: 'player-one',
  P2: 'player-two'
};

interface PlayedActionSummary {
  card: CardId;
  drawn: CardId[];
}

interface DeckTurnDisplay {
  actions: PlayedActionSummary[];
  treasures: CardId[];
  production: Record<string, number>;
}

export function App(): ReactElement {
  const [bundle, setBundle] = useState<BoardBundle | null>(null);
  const [replay, setReplay] = useState<ReplayBundle | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timelineUrl = timelineUrlFromLocation();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const nextReplay = timelineUrl ? await loadReplayBundle(timelineUrl, replayIndex) : null;
        const next = nextReplay ?? (await loadBoardBundle());
        if (!cancelled) {
          setReplay(nextReplay);
          setBundle(next);
          setError(null);
          setUpdatedAt(new Date());
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    }

    void load();
    const interval = window.setInterval(() => void load(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [replayIndex, timelineUrl]);

  if (!bundle) {
    return (
      <main className="app-shell">
        <section className="board-panel">{error ? <p className="error-text">{error}</p> : <p className="status-text">Loading board...</p>}</section>
      </main>
    );
  }

  return (
    <main className={replay ? 'app-shell replay-layout' : 'app-shell'}>
      {replay ? (
        <aside className="deck-panel">
          <ReplayControls replay={replay} onSelect={setReplayIndex} />
          <section>
            <h2>{replay.entry ? phaseLabel(replay.entry.phase) : 'Replay start'}</h2>
            <TurnSummary replay={replay} />
          </section>
          <section>
            <h2>{replay.entry ? `${replay.entry.player} Deck` : 'Starting Deck'}</h2>
            <DeckChanges replay={replay} game={replay.deck.game} baseGame={replay.initialDeck.game} playerId={replay.entry?.player ?? bundle.state.turn.activePlayer} />
          </section>
        </aside>
      ) : null}
      <BoardView bundle={bundle} replay={replay} game={replay?.deck.game ?? null} title={replay?.timeline.title ?? 'Skirmish'} />
      <aside className="side-panel">
        <header>
          <h2>State</h2>
          <p>
            {bundle.state.turn.activePlayer} · {phaseLabel(bundle.state.turn.phase)} · Round {bundle.state.turn.round}
          </p>
        </header>
        <section>
          <h2>Units</h2>
          <UnitList bundle={bundle} />
        </section>
        <section>
          <h2>Key points</h2>
          <KeyPointList bundle={bundle} />
        </section>
        <footer>
          <span>{updatedAt ? updatedAt.toLocaleTimeString() : 'Not loaded'}</span>
          {error ? <span className="error-text">{error}</span> : null}
        </footer>
      </aside>
    </main>
  );
}

function BoardView({ bundle, replay, game, title }: { bundle: BoardBundle; replay: ReplayBundle | null; game: GameState | null; title: string }): ReactElement {
  const [marketOpen, setMarketOpen] = useState(false);
  const { state, map, unitRules } = bundle;
  const blocked = useMemo(() => new Set(map.blocked.map(coordKey)), [map.blocked]);
  const layout = useMemo(() => buildLayout(map.hexes, map), [map]);
  const annotations = useMemo(
    () => buildBoardAnnotations(replay?.previousState ?? null, state, replay?.entry?.player ?? null, replay?.entry?.action),
    [replay, state]
  );

  return (
    <section className="board-panel" aria-label="Game board">
      <div className="board-header">
        <div>
          <span className="eyebrow">{map.name}</span>
          <h1>{title}</h1>
        </div>
        <div className="board-actions">
          {game ? (
            <button type="button" className="market-toggle" onClick={() => setMarketOpen((open) => !open)} aria-expanded={marketOpen}>
              Market
            </button>
          ) : null}
          <div className="turn-pill">
            <span>{state.turn.activePlayer}</span>
            <strong>{phaseLabel(state.turn.phase)} · Round {state.turn.round}</strong>
          </div>
        </div>
      </div>
      {marketOpen && game ? <MarketOverlay game={game} onClose={() => setMarketOpen(false)} /> : null}
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img">
        <g transform={`translate(${layout.offsetX} ${layout.offsetY})`}>
          {map.hexes.map((hex) => {
            const center = hexToPixel(hex, layout.size, map);
            const key = coordKey(hex);
            return <polygon key={key} className={blocked.has(key) ? 'hex blocked' : 'hex'} points={hexPoints(center, layout.size, map.orientation)} />;
          })}
          {map.deployment.map((zone) =>
            zone.hexes.map((hex) => {
              const center = hexToPixel(hex, layout.size, map);
              return (
                <polygon
                  key={`${zone.player}-${coordKey(hex)}`}
                  className={`home-base ${playerClasses[zone.player] ?? ''}`}
                  points={hexPoints(center, layout.size * 0.91, map.orientation)}
                />
              );
            })
          )}
          {map.keyPoints.map((keyPoint) => {
            const point = hexToPixel(keyPoint, layout.size, map);
            return (
              <g key={keyPoint.id} className={`key-point key-point-${keyPoint.stat}`} transform={`translate(${point.x} ${point.y})`}>
                <polygon className="supply-zone" points={hexPoints({ x: 0, y: 0 }, layout.size * 0.86, map.orientation)} />
                <path className="supply-glyph" d="M 0 -17 L 15 0 L 0 17 L -15 0 Z" />
                <text y="5">{keyPoint.stat.slice(0, 1).toUpperCase()}</text>
              </g>
            );
          })}
          {state.units.map((unit) => {
            const point = hexToPixel(unit, layout.size, map);
            const buffed = buffedUnitStats(unit, unitRules);
            return (
              <g key={unit.id} className={`unit ${playerClasses[unit.player] ?? ''}`} transform={`translate(${point.x} ${point.y})`}>
                <path className="unit-token" d="M -29 -21 L 29 -21 L 34 1 L 0 27 L -34 1 Z" />
                <path className="unit-cap" d="M -20 -13 L 20 -13" />
                <text className="unit-kind" y="-6">{unitLabel(unit.type)}</text>
                <text className="unit-health" y="7">HP {unit.hp}</text>
                <text className="unit-stats" y="18">
                  <tspan className={buffed.attack ? 'stat-buffed' : undefined}>A{unit.attack}</tspan>{' '}
                  <tspan className={buffed.movement ? 'stat-buffed' : undefined}>M{unit.movement}</tspan>{' '}
                  <tspan className={buffed.range ? 'stat-buffed' : undefined}>R{unit.range}</tspan>
                </text>
              </g>
            );
          })}
          <g className="board-annotations" aria-hidden="true">
            {annotations.map((annotation) => (
              <BoardAnnotationView key={annotation.id} annotation={annotation} layoutSize={layout.size} map={map} />
            ))}
          </g>
        </g>
      </svg>
    </section>
  );
}

function MarketOverlay({ game, onClose }: { game: GameState; onClose: () => void }): ReactElement {
  return (
    <div className="market-overlay" role="dialog" aria-label="Market">
      <div className="market-header">
        <div>
          <span className="eyebrow">Deck Market</span>
          <h2>Cards</h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="market-grid">
        {game.config.supply.map((pile) => {
          const card = game.cards[pile.card];
          if (!card) {
            return null;
          }
          return <MarketCard key={pile.card} card={card} remaining={game.supply[pile.card] ?? pile.count} />;
        })}
      </div>
    </div>
  );
}

function MarketCard({ card, remaining }: { card: CardDefinition; remaining: number }): ReactElement {
  return (
    <article className="market-card">
      <header>
        <strong>{card.name}</strong>
        <span>{card.cost} cost</span>
      </header>
      <div className="market-meta">
        <span>{card.type}</span>
        <span>{remaining} left</span>
      </div>
      <p>{describeCard(card)}</p>
    </article>
  );
}

function BoardAnnotationView({
  annotation,
  layoutSize,
  map
}: {
  annotation: BoardAnnotation;
  layoutSize: number;
  map: BoardBundle['map'];
}): ReactElement {
  const target = hexToPixel(annotation.to, layoutSize, map);
  if (!annotation.from) {
    return <AttackImpact annotation={annotation} layoutSize={layoutSize} target={target} />;
  }

  const source = hexToPixel(annotation.from, layoutSize, map);
  const line = insetLine(source, target, layoutSize * 0.36, layoutSize * 0.2);
  const className = annotation.kind === 'movement' ? 'annotation movement' : 'annotation attack';
  const arrow = buildArrow(line, layoutSize * 0.5, layoutSize * 0.22);

  return (
    <g className={`${className} ${playerClasses[annotation.player] ?? ''}`} data-kind={annotation.kind}>
      <path className="annotation-line halo" d={`M ${line.from.x} ${line.from.y} L ${arrow.base.x} ${arrow.base.y}`} />
      <polygon className="annotation-arrow halo" points={arrow.haloPoints} />
      <path className="annotation-line stroke" d={`M ${line.from.x} ${line.from.y} L ${arrow.base.x} ${arrow.base.y}`} />
      <polygon className="annotation-arrow stroke" points={arrow.points} />
      {annotation.kind === 'attack' && annotation.showImpact !== false ? <AttackImpact annotation={annotation} dataKind={false} layoutSize={layoutSize} target={target} /> : null}
    </g>
  );
}

function AttackImpact({
  annotation,
  dataKind = true,
  layoutSize,
  target
}: {
  annotation: BoardAnnotation;
  dataKind?: boolean;
  layoutSize: number;
  target: { x: number; y: number };
}): ReactElement {
  const arm = layoutSize * 0.36;
  return (
    <g className={`annotation attack-impact ${playerClasses[annotation.player] ?? ''}`} data-kind={dataKind ? 'attack' : undefined} transform={`translate(${target.x} ${target.y})`}>
      <circle className="annotation-impact" r={layoutSize * 0.42} />
      <path className="annotation-burst" d={`M ${-arm} ${-arm} L ${arm} ${arm} M ${-arm} ${arm} L ${arm} ${-arm}`} />
      <text className="annotation-damage" y="5">{annotation.label}</text>
    </g>
  );
}

function insetLine(from: { x: number; y: number }, to: { x: number; y: number }, startInset: number, endInset: number): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    return { from, to };
  }

  const ux = dx / length;
  const uy = dy / length;
  const safeStartInset = Math.min(startInset, length / 3);
  const safeEndInset = Math.min(endInset, length / 3);
  return {
    from: { x: from.x + ux * safeStartInset, y: from.y + uy * safeStartInset },
    to: { x: to.x - ux * safeEndInset, y: to.y - uy * safeEndInset }
  };
}

function buildArrow(line: { from: { x: number; y: number }; to: { x: number; y: number } }, arrowLength: number, arrowHalfWidth: number): { base: { x: number; y: number }; points: string; haloPoints: string } {
  const dx = line.to.x - line.from.x;
  const dy = line.to.y - line.from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    const points = `${line.to.x},${line.to.y}`;
    return { base: line.to, points, haloPoints: points };
  }

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const safeArrowLength = Math.min(arrowLength, length * 0.48);
  const base = { x: line.to.x - ux * safeArrowLength, y: line.to.y - uy * safeArrowLength };
  const left = { x: base.x + px * arrowHalfWidth, y: base.y + py * arrowHalfWidth };
  const right = { x: base.x - px * arrowHalfWidth, y: base.y - py * arrowHalfWidth };
  const haloHalfWidth = arrowHalfWidth + 4;
  const haloLength = safeArrowLength + 4;
  const haloBase = { x: line.to.x - ux * haloLength, y: line.to.y - uy * haloLength };
  const haloLeft = { x: haloBase.x + px * haloHalfWidth, y: haloBase.y + py * haloHalfWidth };
  const haloRight = { x: haloBase.x - px * haloHalfWidth, y: haloBase.y - py * haloHalfWidth };

  return {
    base,
    points: `${line.to.x},${line.to.y} ${left.x},${left.y} ${right.x},${right.y}`,
    haloPoints: `${line.to.x},${line.to.y} ${haloLeft.x},${haloLeft.y} ${haloRight.x},${haloRight.y}`
  };
}

function ReplayControls({ replay, onSelect }: { replay: ReplayBundle; onSelect: (index: number) => void }): ReactElement {
  const isFirst = replay.index <= 0;
  const isLast = replay.index >= replay.timeline.entries.length;
  return (
    <section className="replay-panel">
      <h2>Replay</h2>
      <div className="replay-controls">
        <button type="button" onClick={() => onSelect(0)} disabled={isFirst}>
          Start
        </button>
        <button type="button" onClick={() => onSelect(replay.index - 1)} disabled={isFirst}>
          Prev
        </button>
        <span>
          {replay.index + 1} / {replay.timeline.entries.length + 1}
        </span>
        <button type="button" onClick={() => onSelect(replay.index + 1)} disabled={isLast}>
          Next
        </button>
        <button type="button" onClick={() => onSelect(replay.timeline.entries.length)} disabled={isLast}>
          End
        </button>
      </div>
    </section>
  );
}

function TurnSummary({ replay }: { replay: ReplayBundle }): ReactElement {
  const { entry } = replay;
  if (!entry) {
    return (
      <div className="turn-summary">
        <div className="summary-heading">
          <strong>Start</strong>
          <span>before action 1</span>
        </div>
        <p>Initial board state.</p>
        <p className="reasoning-text">Use Next to step through the replayed actions.</p>
      </div>
    );
  }
  const deckDisplay = entry.phase === 'setup' ? buildDeckTurnDisplay(replay) : null;

  return (
    <div className="turn-summary">
      <div className="summary-heading">
        <strong>{entry.player}</strong>
        <span>Round {entry.round}</span>
      </div>
      <p>{entry.summary}</p>
      <p className="reasoning-text">{entry.reasoning}</p>
      {entry.phase === 'setup' ? (deckDisplay ? <>
        <CardDelta label="Starting Hand" cards={entry.deck.drawnHand} game={replay.deck.game} emptyText="none" />
        <ActionFlow actions={deckDisplay.actions} game={replay.deck.game} />
        <CardDelta label="Treasures" cards={deckDisplay.treasures} game={replay.deck.game} emptyText="none" />
        <ProductionGrid production={deckDisplay.production} />
        <LabeledValues label="Bought" values={entry.deck.bought} />
      </> : null) : <LabeledValues label="Activated" values={[entry.action.activation.unit]} />}
    </div>
  );
}

function phaseLabel(phase: 'setup' | 'activation'): string {
  return phase === 'setup' ? 'Setup' : 'Activation';
}

function ActionFlow({ actions, game }: { actions: PlayedActionSummary[]; game: GameState }): ReactElement {
  return (
    <div className="action-flow">
      <span>Action Flow</span>
      {actions.length > 0 ? (
        <ol>
          {actions.map((action, index) => (
            <li key={`${action.card}-${index}`}>
              <strong>{cardName(game, action.card)}</strong>
              {action.drawn.length > 0 ? <span>drew {formatCardList(action.drawn, game)}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <em>none</em>
      )}
    </div>
  );
}

function ProductionGrid({ production }: { production: Record<string, number> }): ReactElement {
  const entries = Object.entries(production).filter(([, value]) => value !== 0);
  return (
    <div className="production-block">
      <span>Production</span>
      <div className="produced-grid">
        {entries.length > 0 ? (
          entries.map(([key, value]) => (
            <span key={key}>
              {formatProductionKey(key)}: <strong>{value}</strong>
            </span>
          ))
        ) : (
          <em>none</em>
        )}
      </div>
    </div>
  );
}

function buildDeckTurnDisplay(replay: ReplayBundle): DeckTurnDisplay {
  const entry = replay.entry;
  const deckBefore = replay.deckBefore;
  if (!entry || entry.phase !== 'setup' || !deckBefore) {
    return { actions: [], treasures: [], production: {} };
  }

  try {
    let game = cloneState(deckBefore.game);
    const rng = SeededRng.fromState(deckBefore.rngState);
    const actions: PlayedActionSummary[] = [];
    const treasures: CardId[] = [];
    let buyMoney: number | null = null;

    for (const action of entry.deck.actions ?? []) {
      const player = game.players[game.activePlayer];
      if (!player) {
        break;
      }

      if (action.type === 'playAction') {
        const handBefore = [...player.hand];
        const card = handBefore[action.handIndex];
        const handWithoutPlayed = [...handBefore];
        handWithoutPlayed.splice(action.handIndex, 1);
        game = applyAction(game, action, rng);
        const handAfter = game.players[game.activePlayer]?.hand ?? [];
        if (card) {
          actions.push({ card, drawn: subtractCardCounts(handAfter, handWithoutPlayed) });
        }
        continue;
      }

      if (action.type === 'moveToBuy') {
        treasures.push(...player.hand.filter((card) => game.cards[card]?.type === 'treasure'));
        game = applyAction(game, action, rng);
        buyMoney = game.players[game.activePlayer]?.money ?? buyMoney;
        continue;
      }

      if (action.type === 'buyCard' && buyMoney === null) {
        buyMoney = player.money;
      }
      game = applyAction(game, action, rng);
    }

    return {
      actions,
      treasures,
      production: deckProduction(entry.deck.produced, buyMoney)
    };
  } catch {
    return { actions: [], treasures: [], production: deckProduction(entry.deck.produced, null) };
  }
}

function deckProduction(produced: Record<string, number>, buyMoney: number | null): Record<string, number> {
  const production: Record<string, number> = {};
  if (buyMoney !== null && buyMoney > 0) {
    production.money = buyMoney;
  }
  for (const [key, value] of Object.entries(produced)) {
    if (key !== 'money' && value !== 0) {
      production[key] = value;
    }
  }
  return production;
}

function LabeledValues({ label, values }: { label: string; values: string[] }): ReactElement {
  return (
    <div className="labeled-values">
      <span>{label}</span>
      <strong>{values.length > 0 ? values.join(', ') : 'none'}</strong>
    </div>
  );
}

function DeckChanges({ replay, game, baseGame, playerId }: { replay: ReplayBundle; game: GameState; baseGame: GameState; playerId: string }): ReactElement {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const basePlayer = baseGame.players.find((candidate) => candidate.id === playerId);
  const baseCards = basePlayer ? playerCards(basePlayer) : game.config.setup.startingDeck;
  const drafted = initialDraftedCards(replay, baseCards);
  const bought = replay.timeline.entries
    .slice(0, replay.index)
    .flatMap((entry) => entry.player === playerId && entry.phase === 'setup' ? entry.deck.bought.map((card) => resolveCardId(game, card)) : []);
  const acquired = [...drafted, ...bought];
  const ownedCards = player ? playerCards(player) : [];
  const expectedCards = [...baseCards, ...bought];
  const trashed = subtractCardCounts(expectedCards, ownedCards);

  return (
    <div className="deck-state">
      <div className="summary-heading">
        <strong>{player?.id ?? playerId}</strong>
        <span>{ownedCards.length} cards</span>
      </div>
      <CardDelta label="Bought" cards={acquired} game={game} emptyText="none yet" />
      <CardDelta label="Trashed" cards={trashed} game={game} emptyText="none" />
      {player ? <PlayerDeck player={player} game={game} /> : null}
    </div>
  );
}

function PlayerDeck({ player, game }: { player: PlayerState; game: GameState }): ReactElement {
  return (
    <div className="player-deck">
      <LabeledValues label="Hand" values={player.hand.map((cardId) => game.cards[cardId]?.name ?? cardId)} />
      <div className="resource-grid">
        <span>Draw {player.draw.length}</span>
        <span>Discard {player.discard.length}</span>
        <span>Play {player.play.length}</span>
      </div>
    </div>
  );
}

function CardDelta({ label, cards, game, emptyText }: { label: string; cards: string[]; game: GameState; emptyText: string }): ReactElement {
  const grouped = groupCards(cards, game);
  return (
    <div className="card-delta">
      <span>{label}</span>
      <div className="card-chips">
        {grouped.length > 0 ? (
          grouped.map((card) => (
            <span key={card.name}>
              {card.name}
              {card.count > 1 ? ` x${card.count}` : ''}
            </span>
          ))
        ) : (
          <em>{emptyText}</em>
        )}
      </div>
    </div>
  );
}

function playerCards(player: PlayerState): string[] {
  return [...player.draw, ...player.hand, ...player.discard, ...player.play];
}

function initialDraftedCards(replay: ReplayBundle, baseCards: string[]): string[] {
  const draft = replay.deck.game.config.setup.draft;
  return draft ? subtractCardCounts(baseCards, Array(draft.baseCount).fill(draft.baseCard)) : [];
}

function subtractCardCounts(expected: string[], actual: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const card of actual) {
    remaining.set(card, (remaining.get(card) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (const card of expected) {
    const count = remaining.get(card) ?? 0;
    if (count > 0) {
      remaining.set(card, count - 1);
    } else {
      missing.push(card);
    }
  }
  return missing;
}

function groupCards(cards: string[], game: GameState): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const name = cardName(game, card);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((left, right) => left.name.localeCompare(right.name));
}

function resolveCardId(game: GameState, card: string): string {
  if (game.cards[card]) {
    return card;
  }

  const normalized = card.toLowerCase();
  for (const definition of Object.values(game.cards)) {
    if (definition.name.toLowerCase() === normalized) {
      return definition.id;
    }
  }
  return card;
}

function formatCardList(cards: string[], game: GameState): string {
  return cards.map((card) => cardName(game, card)).join(', ');
}

function formatProductionKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function cardName(game: GameState, card: string): string {
  return game.cards[card]?.name ?? card;
}

function describeCard(card: CardDefinition): string {
  const phrases: string[] = [];
  if (card.treasure) {
    phrases.push(`+${card.treasure} money`);
  }
  for (const effect of card.effects ?? []) {
    if (effect.kind === 'grant') {
      phrases.push(...describeGrantEffect(effect));
    } else if (effect.kind === 'discard') {
      phrases.push(`${effect.optional ? 'may discard' : 'discard'} ${formatCount(effect.count, 'card')}`);
    } else if (effect.kind === 'trash') {
      phrases.push(`${effect.optional ? 'may trash' : 'trash'} ${formatCount(effect.count, 'card')}`);
    } else if (effect.kind === 'lookahead') {
      phrases.push(`look at ${formatCount(effect.count, 'card')}; choose ${effect.choices.join(', ')}`);
    } else if (effect.kind === 'vp') {
      phrases.push(`+${effect.points} VP`);
    }
  }
  if (card.victoryPoints) {
    phrases.push(`${card.victoryPoints} VP`);
  }
  return phrases.length > 0 ? phrases.join('; ') : 'No immediate effect.';
}

function describeGrantEffect(effect: NonNullable<CardDefinition['effects']>[number] & { kind: 'grant' }): string[] {
  const phrases: string[] = [];
  if (effect.cards) {
    phrases.push(`+${formatCount(effect.cards, 'card')}`);
  }
  if (effect.actions) {
    phrases.push(`+${formatCount(effect.actions, 'action')}`);
  }
  if (effect.buys) {
    phrases.push(`+${formatCount(effect.buys, 'buy', 'buys')}`);
  }
  if (effect.money) {
    phrases.push(`+${effect.money} money`);
  }
  for (const [key, value] of Object.entries(effect.attributes ?? {})) {
    phrases.push(`+${value} ${formatProductionKey(key)}`);
  }
  for (const [key, value] of Object.entries(effect.persistentAttributes ?? {})) {
    phrases.push(`+${value} persistent ${formatProductionKey(key)}`);
  }
  return phrases;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function UnitList({ bundle }: { bundle: BoardBundle }): ReactElement {
  const { state, unitRules } = bundle;
  return (
    <div className="list">
      {state.units.map((unit) => {
        const buffed = buffedUnitStats(unit, unitRules);
        return (
          <div key={unit.id} className="list-row unit-list-row">
            <span className={`dot ${playerClasses[unit.player] ?? ''}`} />
            <span>{unit.type}</span>
            <span>HP {unit.hp}</span>
            <span className={buffed.attack ? 'stat-buffed' : undefined}>atk {unit.attack}</span>
            <span className={buffed.movement ? 'stat-buffed' : undefined}>mv {unit.movement}</span>
            <span className={buffed.range ? 'stat-buffed' : undefined}>rng {unit.range}</span>
          </div>
        );
      })}
    </div>
  );
}

function KeyPointList({ bundle }: { bundle: BoardBundle }): ReactElement {
  const { state, map } = bundle;
  const unitByCoord = new Map(state.units.map((unit) => [coordKey(unit), unit]));
  return (
    <div className="supply-list">
      {map.keyPoints.map((point) => {
        return (
          <div key={point.id} className="supply-row">
            <strong>{point.stat}</strong>
            <span>{formatPointOccupant(unitByCoord.get(coordKey(point)))}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatPointOccupant(unit: BoardState['units'][number] | undefined): string {
  return unit ? `${unit.player} ${unit.type}` : 'empty';
}

function unitLabel(type: string): string {
  return type
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('');
}
