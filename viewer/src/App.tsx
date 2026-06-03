import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { coordKey, type BoardState } from '../../src/board/schema';
import type { GameState, PlayerState } from '../../src/core/types';
import { loadBoardBundle, loadReplayBundle, timelineUrlFromLocation, type BoardBundle, type ReplayBundle } from './boardState';
import { buildLayout, hexPoints, hexToPixel } from './hex';

const playerClasses: Record<string, string> = {
  P1: 'player-one',
  P2: 'player-two'
};

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
            <h2>{replay.entry ? `${replay.entry.player} Deck After Turn` : 'Starting Deck'}</h2>
            <DeckState game={replay.deck.game} playerId={replay.entry?.player ?? bundle.state.turn.activePlayer} />
          </section>
        </aside>
      ) : null}
      <BoardView bundle={bundle} title={replay?.timeline.title ?? 'Territory Sandbox'} />
      <aside className="side-panel">
        <header>
          <h2>State</h2>
          <p>
            {bundle.state.turn.activePlayer} · Round {bundle.state.turn.round}
          </p>
        </header>
        <section>
          <h2>Units</h2>
          <UnitList state={bundle.state} />
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

function BoardView({ bundle, title }: { bundle: BoardBundle; title: string }): ReactElement {
  const { state, map } = bundle;
  const blocked = useMemo(() => new Set(map.blocked.map(coordKey)), [map.blocked]);
  const supplyControllerById = useMemo(() => new Map(state.supplyControl.map((center) => [center.id, center.controller])), [state.supplyControl]);
  const layout = useMemo(() => buildLayout(map.hexes, map), [map]);

  return (
    <section className="board-panel" aria-label="Game board">
      <div className="board-header">
        <div>
          <span className="eyebrow">{map.name}</span>
          <h1>{title}</h1>
        </div>
        <div className="turn-pill">
          <span>{state.turn.activePlayer}</span>
          <strong>Round {state.turn.round}</strong>
        </div>
      </div>
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
        </g>
      </svg>
    </section>
  );
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

  return (
    <div className="turn-summary">
      <div className="summary-heading">
        <strong>{entry.player}</strong>
        <span>Round {entry.round}</span>
      </div>
      <p>{entry.summary}</p>
      <p className="reasoning-text">{entry.reasoning}</p>
      <LabeledValues label="Hand" values={entry.deck.drawnHand} />
      <LabeledValues label="Played" values={entry.deck.played} />
      <LabeledValues label="Bought" values={entry.deck.bought} />
      <div className="produced-grid">
        {Object.entries(entry.deck.produced).map(([key, value]) => (
          <span key={key}>
            {key}: <strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function LabeledValues({ label, values }: { label: string; values: string[] }): ReactElement {
  return (
    <div className="labeled-values">
      <span>{label}</span>
      <strong>{values.length > 0 ? values.join(', ') : 'none'}</strong>
    </div>
  );
}

function DeckState({ game, playerId }: { game: GameState; playerId: string }): ReactElement {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return (
    <div className="deck-state">
      <div className="summary-heading">
        <strong>{player?.id ?? playerId}</strong>
        <span>after turn</span>
      </div>
      {player ? <PlayerDeck player={player} game={game} /> : null}
    </div>
  );
}

function PlayerDeck({ player, game }: { player: PlayerState; game: GameState }): ReactElement {
  return (
    <div className="player-deck">
      <LabeledValues label="Hand" values={player.hand.map((cardId) => game.cards[cardId]?.name ?? cardId)} />
      <LabeledValues label="Play" values={player.play.map((cardId) => game.cards[cardId]?.name ?? cardId)} />
      <div className="resource-grid">
        <span>Actions {player.actions}</span>
        <span>Buys {player.buys}</span>
        <span>Money {player.money}</span>
        <span>Draw {player.draw.length}</span>
        <span>Discard {player.discard.length}</span>
      </div>
      <div className="produced-grid">
        {Object.entries(player.attributes).map(([key, value]) => (
          <span key={key}>
            {key}: <strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function UnitList({ state }: { state: BoardState }): ReactElement {
  return (
    <div className="list">
      {state.units.map((unit) => (
        <div key={unit.id} className="list-row">
          <span className={`dot ${playerClasses[unit.player] ?? ''}`} />
          <span>{unit.type}</span>
          <span>
            {unit.hp}/{unit.maxHp} hp
          </span>
          <span>{unit.attack} atk</span>
          <span>
            {unit.col},{unit.row}
          </span>
        </div>
      ))}
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
