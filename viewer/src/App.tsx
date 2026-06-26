import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { coordKey, type BoardState } from '../../src/board/schema';
import { applyAction } from '../../src/core/engine';
import { SeededRng } from '../../src/core/random';
import { cloneState } from '../../src/core/state';
import type { CardDefinition, CardId, GameState, PlayerState } from '../../src/core/types';
import { loadBoardBundle, loadReplayBundle, timelineUrlFromLocation, type BoardBundle, type ReplayBundle } from './boardState';
import { buildLayout, hexPoints, hexToPixel } from './hex';

const playerClasses: Record<string, string> = {
  P1: 'player-one',
  P2: 'player-two'
};

type BoardUnit = BoardState['units'][number];
type AnnotationKind = 'movement' | 'recruitment' | 'attack';

const draftBaseCard = 'copper';
const draftBaseCount = 7;

interface BoardAnnotation {
  id: string;
  kind: AnnotationKind;
  player: string;
  from: BoardUnit | null;
  to: BoardUnit;
  label: string;
}

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
            <h2>Turn</h2>
            <TurnSummary replay={replay} />
          </section>
          <section>
            <h2>{replay.entry ? `${replay.entry.player} Deck Changes` : 'Starting Deck'}</h2>
            <DeckChanges replay={replay} game={replay.deck.game} baseGame={replay.initialDeck.game} playerId={replay.entry?.player ?? bundle.state.turn.activePlayer} />
          </section>
        </aside>
      ) : null}
      <BoardView bundle={bundle} replay={replay} game={replay?.deck.game ?? null} title={replay?.timeline.title ?? 'Territory Sandbox'} />
      <aside className="side-panel">
        <header>
          <h2>State</h2>
          <p>
            {bundle.state.turn.activePlayer} · Round {bundle.state.turn.round}
          </p>
        </header>
        <section>
          <h2>Units</h2>
          <UnitList bundle={bundle} />
        </section>
        <section>
          <h2>Supply</h2>
          <SupplyList bundle={bundle} />
        </section>
        <section>
          <h2>Saved Supply</h2>
          <SavedSupplyList state={bundle.state} />
        </section>
        <section>
          <h2>Home</h2>
          <HomeBaseList map={bundle.map} />
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
  const { state, map } = bundle;
  const blocked = useMemo(() => new Set(map.blocked.map(coordKey)), [map.blocked]);
  const supplyControllerById = useMemo(() => new Map(state.supplyControl.map((center) => [center.id, center.controller])), [state.supplyControl]);
  const layout = useMemo(() => buildLayout(map.hexes, map), [map]);
  const annotations = useMemo(() => buildBoardAnnotations(replay?.previousState ?? null, state, replay?.entry?.player ?? null), [replay, state]);

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
            <strong>Round {state.turn.round}</strong>
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
          {map.homeBases.map((homeBase) =>
            homeBase.hexes.map((hex) => {
              const center = hexToPixel(hex, layout.size, map);
              return (
                <polygon
                  key={`${homeBase.id}-${coordKey(hex)}`}
                  className={`home-base ${playerClasses[homeBase.player] ?? ''}`}
                  points={hexPoints(center, layout.size * 0.91, map.orientation)}
                />
              );
            })
          )}
          {map.supplyCenters.map((center) => {
            const point = hexToPixel(center, layout.size, map);
            const controller = supplyControllerById.get(center.id) ?? null;
            return (
              <g key={center.id} className={`supply ${controller ? playerClasses[controller] ?? '' : ''}`} transform={`translate(${point.x} ${point.y})`}>
                <polygon className="supply-zone" points={hexPoints({ x: 0, y: 0 }, layout.size * 0.86, map.orientation)} />
                <path className="supply-glyph" d="M 0 -17 L 15 0 L 0 17 L -15 0 Z" />
                <text y="5">{controller ?? ''}</text>
              </g>
            );
          })}
          {state.units.map((unit) => {
            const point = hexToPixel(unit, layout.size, map);
            return (
              <g key={unit.id} className={`unit ${playerClasses[unit.player] ?? ''}`} transform={`translate(${point.x} ${point.y})`}>
                <path className="unit-token" d="M -29 -21 L 29 -21 L 34 1 L 0 27 L -34 1 Z" />
                <path className="unit-cap" d="M -20 -13 L 20 -13" />
                <text className="unit-kind" y="-1">{unitLabel(unit.type)}</text>
                <text className="unit-health" y="14">
                  {unit.hp}/{unit.maxHp}
                </text>
              </g>
            );
          })}
          {map.supplyCenters.map((center) => {
            const point = hexToPixel(center, layout.size, map);
            const controller = supplyControllerById.get(center.id) ?? null;
            return (
              <polygon
                key={`${center.id}-outline`}
                className={`supply-outline ${controller ? playerClasses[controller] ?? '' : ''}`}
                points={hexPoints(point, layout.size * 0.9, map.orientation)}
              />
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
  if (annotation.kind === 'recruitment') {
    const badge = { x: target.x + layoutSize * 0.5, y: target.y - layoutSize * 0.5 };
    return (
      <g className={`annotation recruitment ${playerClasses[annotation.player] ?? ''}`} data-kind="recruitment" transform={`translate(${badge.x} ${badge.y})`}>
        <circle className="annotation-ring outer" r={layoutSize * 0.38} />
        <circle className="annotation-ring inner" r={layoutSize * 0.24} />
        <path className="annotation-plus" d="M -8 0 L 8 0 M 0 -8 L 0 8" />
      </g>
    );
  }

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
      {annotation.kind === 'attack' ? <AttackImpact annotation={annotation} dataKind={false} layoutSize={layoutSize} target={target} /> : null}
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

function buildBoardAnnotations(previousState: BoardState | null, state: BoardState, activePlayer: string | null): BoardAnnotation[] {
  if (!previousState || !activePlayer) {
    return [];
  }

  const currentUnitsById = new Map(state.units.map((unit) => [unit.id, unit]));
  const previousUnitsById = new Map(previousState.units.map((unit) => [unit.id, unit]));
  const activeUnits = state.units.filter((unit) => unit.player === activePlayer);
  const annotations: BoardAnnotation[] = [];

  for (const current of state.units) {
    const previous = previousUnitsById.get(current.id);
    if (!previous) {
      annotations.push({
        id: `recruitment-${current.id}`,
        kind: 'recruitment',
        player: current.player,
        from: null,
        to: current,
        label: '+'
      });
      continue;
    }

    if (coordKey(previous) !== coordKey(current)) {
      annotations.push({
        id: `movement-${current.id}`,
        kind: 'movement',
        player: current.player,
        from: previous,
        to: current,
        label: ''
      });
    }
  }

  for (const previous of previousState.units) {
    if (previous.player === activePlayer) {
      continue;
    }

    const current = currentUnitsById.get(previous.id);
    const damage = current ? previous.hp - current.hp : previous.hp;
    if (damage <= 0) {
      continue;
    }

    annotations.push({
      id: `attack-${previous.id}`,
      kind: 'attack',
      player: activePlayer,
      from: nearestUnit(activeUnits, current ?? previous),
      to: current ?? previous,
      label: current ? `-${damage}` : 'KO'
    });
  }

  return annotations;
}

function nearestUnit(units: BoardUnit[], target: BoardUnit): BoardUnit | null {
  let nearest: BoardUnit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const unit of units) {
    const colDistance = unit.col - target.col;
    const rowDistance = unit.row - target.row;
    const distance = colDistance * colDistance + rowDistance * rowDistance;
    if (distance < nearestDistance) {
      nearest = unit;
      nearestDistance = distance;
    }
  }

  return nearest;
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
          <span>before turn 1</span>
        </div>
        <p>Initial board state.</p>
        <p className="reasoning-text">Use Next to step through the replayed turns.</p>
      </div>
    );
  }
  const deckDisplay = buildDeckTurnDisplay(replay);

  return (
    <div className="turn-summary">
      <div className="summary-heading">
        <strong>{entry.player}</strong>
        <span>Round {entry.round}</span>
      </div>
      <p>{entry.summary}</p>
      <p className="reasoning-text">{entry.reasoning}</p>
      <CardDelta label="Starting Hand" cards={entry.deck.drawnHand} game={replay.deck.game} emptyText="none" />
      <ActionFlow actions={deckDisplay.actions} game={replay.deck.game} />
      <CardDelta label="Treasures" cards={deckDisplay.treasures} game={replay.deck.game} emptyText="none" />
      <ProductionGrid production={deckDisplay.production} />
      <LabeledValues label="Bought" values={entry.deck.bought} />
    </div>
  );
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
  if (!entry || !deckBefore) {
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
    .filter((entry) => entry.player === playerId)
    .flatMap((entry) => entry.deck.bought.map((card) => resolveCardId(game, card)));
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
  if (!replay.state.ruleset.includes('highmove-center6')) {
    return [];
  }
  return subtractCardCounts(baseCards, Array(draftBaseCount).fill(draftBaseCard));
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
  const { state, units } = bundle;
  return (
    <div className="list">
      {state.units.map((unit) => {
        const movement = units[unit.type]?.movement;
        return (
          <div key={unit.id} className="list-row unit-list-row">
            <span className={`dot ${playerClasses[unit.player] ?? ''}`} />
            <span>{unit.type}</span>
            <span>
              {unit.hp}/{unit.maxHp}
            </span>
            <span>atk {unit.attack}</span>
            <span>mv {movement ?? '?'}</span>
            <span className="unit-coord">
              {unit.col},{unit.row}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SupplyList({ bundle }: { bundle: BoardBundle }): ReactElement {
  const { state, map } = bundle;
  const unitByCoord = new Map(state.units.map((unit) => [coordKey(unit), unit]));
  const supplyControllerById = new Map(state.supplyControl.map((center) => [center.id, center.controller]));
  return (
    <div className="supply-list">
      {map.supplyCenters.map((center) => {
        const controller = supplyControllerById.get(center.id) ?? null;
        return (
          <div key={center.id} className="supply-row">
            <strong>{center.id.replace('center-', '')}</strong>
            <span>{controller ? `controlled by ${controller}` : 'uncontrolled'}</span>
            <span>{formatSupplyOccupant(unitByCoord.get(coordKey(center)))}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatSupplyOccupant(unit: BoardState['units'][number] | undefined): string {
  return unit ? `${unit.player} ${unit.type}` : 'empty';
}

function SavedSupplyList({ state }: { state: BoardState }): ReactElement {
  return (
    <div className="list">
      {state.supply.map((supply) => (
        <div key={supply.player} className="list-row two-column">
          <span>{supply.player}</span>
          <span>{supply.amount}</span>
        </div>
      ))}
    </div>
  );
}

function HomeBaseList({ map }: { map: BoardBundle['map'] }): ReactElement {
  return (
    <div className="list">
      {map.homeBases.map((homeBase) => (
        <div key={homeBase.id} className="list-row two-column">
          <span>{homeBase.player}</span>
          <span>{homeBase.hexes.map(coordKey).join(' · ')}</span>
        </div>
      ))}
    </div>
  );
}

function unitLabel(type: string): string {
  return type
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('');
}
