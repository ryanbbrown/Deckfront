import { useEffect, useMemo, useState } from 'react';
import { equal } from '../game/hex';
import type { Coordinate, LegalAction, PieceId } from '../game/types';
import type { SafeGameView, StrategyPreset } from '../shared/api';
import { actionsForCard, baselineActionsForPiece, commandDestination, commandPieceIds } from './actionPresentation';
import {
  createGame, getAiTurnStatus, getStrategies, loadGame, startAiTurn, takeAction, undoAction
} from './api';
import { Board } from './Board';

const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';

export function App() {
  const [strategies, setStrategies] = useState<StrategyPreset[]>([]);
  const [game, setGame] = useState<SafeGameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStrategies().then(setStrategies).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load strategies.');
    });
    const savedId = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!savedId) {
      setLoading(false);
      return;
    }
    void loadGame(savedId).then(setGame).catch(() => {
      localStorage.removeItem(ACTIVE_GAME_KEY);
    }).finally(() => setLoading(false));
  }, []);

  async function start(input: { strategyPresetId: string; strategyMarkdown: string; seed?: number | undefined }) {
    setLoading(true);
    setError(null);
    try {
      const created = await createGame(input);
      localStorage.setItem(ACTIVE_GAME_KEY, created.id);
      setGame(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the game.');
    } finally {
      setLoading(false);
    }
  }

  function leaveGame() {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setGame(null);
    setError(null);
  }

  if (loading) return <main className="loading"><p>Loading Hexdeck…</p></main>;
  if (!game) return <Setup strategies={strategies} error={error} onStart={start} />;
  return <Game game={game} error={error} onGame={setGame} onError={setError} onNew={leaveGame} />;
}

function Setup({
  strategies, error, onStart
}: {
  strategies: StrategyPreset[];
  error: string | null;
  onStart: (input: { strategyPresetId: string; strategyMarkdown: string; seed?: number | undefined }) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState('direct-force');
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? strategies[0];
  const [markdown, setMarkdown] = useState('');
  const [seed, setSeed] = useState('');

  useEffect(() => {
    if (selected && !markdown) setMarkdown(selected.markdown);
  }, [selected, markdown]);

  function selectStrategy(id: string) {
    setSelectedId(id);
    const strategy = strategies.find((candidate) => candidate.id === id);
    if (strategy) setMarkdown(strategy.markdown);
  }

  return (
    <main className="setup-shell">
      <section className="setup-card">
        <p className="eyebrow">Interactive prototype</p>
        <h1>Hexdeck</h1>
        <p className="lede">Build a deck. Control two pieces. Ring out the opponent five times.</p>
        <label>
          AI strategy
          <select value={selected?.id ?? ''} onChange={(event) => selectStrategy(event.target.value)}>
            {strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}
          </select>
        </label>
        <label>
          Strategy instructions
          <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={14} />
        </label>
        <label className="seed-field">
          Seed <span>(optional)</span>
          <input value={seed} onChange={(event) => setSeed(event.target.value)} inputMode="numeric" placeholder="Random" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button
          className="primary"
          disabled={!selected || !markdown.trim()}
          onClick={() => onStart({
            strategyPresetId: selected?.id ?? selectedId,
            strategyMarkdown: markdown,
            ...(seed.trim() ? { seed: Number.parseInt(seed, 10) } : {})
          })}
        >
          Start match
        </button>
      </section>
    </main>
  );
}

function Game({
  game, error, onGame, onError, onNew
}: {
  game: SafeGameView;
  error: string | null;
  onGame: (game: SafeGameView) => void;
  onError: (error: string | null) => void;
  onNew: () => void;
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<PieceId | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAttempt, setAiAttempt] = useState(0);
  const human = game.players[game.humanPlayerId];
  const ai = game.players[game.aiPlayerId];
  const isHumanTurn = game.activePlayerId === game.humanPlayerId && !game.winner;
  const isAiTurn = game.activePlayerId === game.aiPlayerId && !game.winner;

  useEffect(() => {
    if (!isAiTurn) {
      setAiStatus('idle');
      setAiError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setAiStatus('running');
    setAiError(null);

    async function poll(): Promise<void> {
      try {
        let status = await getAiTurnStatus(game.id);
        if (status.status === 'idle') {
          status = await startAiTurn(game.id);
        }
        if (cancelled) return;
        if (status.status === 'complete' && status.game) {
          onGame(status.game);
          return;
        }
        if (status.status === 'error') {
          setAiStatus('error');
          setAiError(status.error ?? 'AI turn failed.');
          return;
        }
        timer = setTimeout(() => void poll(), 800);
      } catch (cause) {
        if (cancelled) return;
        setAiStatus('error');
        setAiError(cause instanceof Error ? cause.message : 'AI turn failed.');
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aiAttempt, game.id, game.revision, isAiTurn, onGame]);

  const candidateActions = useMemo(() => {
    let actions = game.legalActions;
    if (selectedCardId) actions = actionsForCard(actions, selectedCardId);
    else if (selectedPieceId) actions = baselineActionsForPiece(actions, selectedPieceId);
    else if (game.phase !== 'respawn') return [];
    if (selectedPieceId && selectedCardId) {
      const narrowed = actions.filter((action) => commandPieceIds(action.command).includes(selectedPieceId));
      if (narrowed.length > 0) actions = narrowed;
    }
    return actions;
  }, [game, selectedCardId, selectedPieceId]);

  async function act(action: LegalAction) {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      onGame(await takeAction(game, action.id));
      setSelectedCardId(null);
      setSelectedPieceId(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    onError(null);
    try {
      onGame(await undoAction(game));
      setSelectedCardId(null);
      setSelectedPieceId(null);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Undo failed.');
    } finally {
      setBusy(false);
    }
  }

  function onHexClick(destination: Coordinate) {
    const matching = candidateActions.filter((action) => {
      const candidate = commandDestination(action.command);
      return candidate && equal(candidate, destination);
    });
    if (matching.length === 1) void act(matching[0]!);
  }

  function onPieceClick(pieceId: PieceId) {
    if (!isHumanTurn || busy) return;
    if (selectedCardId) {
      const matching = actionsForCard(game.legalActions, selectedCardId).filter(
        (action) => commandPieceIds(action.command).includes(pieceId)
      );
      if (matching.length === 1 && !commandDestination(matching[0]!.command)) {
        void act(matching[0]!);
      } else if (matching.length > 0) {
        setSelectedPieceId(pieceId);
      }
      return;
    }
    if (game.pieces[pieceId].ownerId === game.humanPlayerId) setSelectedPieceId(pieceId);
  }

  const enterBuy = game.legalActions.find((action) => action.command.type === 'enterBuyPhase');
  const endTurn = game.legalActions.find((action) => action.command.type === 'endTurn');

  async function retryAiTurn(): Promise<void> {
    setAiStatus('running');
    setAiError(null);
    try {
      await startAiTurn(game.id);
      setAiAttempt((attempt) => attempt + 1);
    } catch (cause) {
      setAiStatus('error');
      setAiError(cause instanceof Error ? cause.message : 'AI turn failed.');
    }
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div>
          <p className="eyebrow">First to five ring-outs</p>
          <h1>Hexdeck</h1>
        </div>
        <div className="score" aria-label="Score">
          <span className="score__side score__side--ochre">You <strong>{game.scores[game.humanPlayerId]}</strong></span>
          <span className="score__dash">—</span>
          <span className="score__side score__side--indigo"><strong>{game.scores[game.aiPlayerId]}</strong> AI</span>
        </div>
        <div className="header-actions">
          <a href={`/api/games/${game.id}/export?redacted=1`}>Share export</a>
          <button className="quiet" onClick={onNew}>New match</button>
        </div>
      </header>

      <section className="turn-banner">
        {game.winner ? `${game.winner === game.humanPlayerId ? 'You win' : 'AI wins'} · ${game.elapsedSeconds}s`
          : isHumanTurn ? `Your ${game.phase} phase`
            : aiStatus === 'error' ? 'AI turn stopped'
              : `AI is choosing its turn · ${game.aiRuntime.model}`}
      </section>
      {error && <p className="error game-error" role="alert">{error}</p>}
      {aiError && (
        <div className="error game-error ai-error" role="alert">
          <span>{aiError}</span>
          <button onClick={() => void retryAiTurn()}>Retry AI turn</button>
        </div>
      )}

      <div className="game-layout">
        <section className="board-panel panel">
          <Board
            game={game}
            candidateActions={candidateActions}
            selectedPieceId={selectedPieceId}
            onPieceClick={onPieceClick}
            onHexClick={onHexClick}
          />
          <div className="board-legend">
            <span><i className="dot dot--ochre" /> You</span>
            <span><i className="dot dot--indigo" /> AI</span>
            <span>◆ Braced</span>
            <span>× Pinned</span>
            <span>● Move ready</span>
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel phase-panel">
            <div className="panel-title"><h2>Turn controls</h2><span>Revision {game.revision}</span></div>
            <div className="control-row">
              <button disabled={!game.canUndo || busy} onClick={() => void undo()}>Undo action</button>
              {enterBuy && <button className="primary" disabled={busy} onClick={() => void act(enterBuy)}>Enter buy phase</button>}
              {endTurn && <button className="primary" disabled={busy} onClick={() => void act(endTurn)}>End turn</button>}
            </div>
            {game.lastAiSummary && <p className="ai-summary"><strong>AI:</strong> {game.lastAiSummary}</p>}
            {candidateActions.length > 0 && (
              <div className="choice-list">
                <p>Legal choices</p>
                {candidateActions.map((action) => (
                  <button key={action.id} disabled={busy} onClick={() => void act(action)}>{action.label}</button>
                ))}
              </div>
            )}
          </section>

          <section className="panel zones">
            <div><span>Draw</span><strong>{human.zoneCounts.draw}</strong></div>
            <div><span>Discard</span><strong>{human.zoneCounts.discard}</strong></div>
            <div><span>Played</span><strong>{human.zoneCounts.play}</strong></div>
            <div><span>Money</span><strong>{human.money}</strong></div>
            <p>AI zones: {ai.zoneCounts.draw} draw · {ai.zoneCounts.hand} hand · {ai.zoneCounts.discard} discard</p>
          </section>
        </aside>
      </div>

      <section className="panel hand-panel">
        <div className="panel-title"><h2>Your hand</h2><span>{human.zoneCounts.hand} cards</span></div>
        <div className="card-row">
          {human.hand?.map((card) => {
            const definition = game.cards[card.definitionId];
            if (!definition) return null;
            const available = actionsForCard(game.legalActions, card.id).length > 0;
            return (
              <button
                key={card.id}
                className={`card card--${definition.type}${selectedCardId === card.id ? ' card--selected' : ''}`}
                disabled={!available || busy}
                onClick={() => {
                  setSelectedCardId(selectedCardId === card.id ? null : card.id);
                  setSelectedPieceId(null);
                }}
              >
                <span className="card__cost">{definition.cost}</span>
                <strong>{definition.name}</strong>
                <small>{definition.text}</small>
              </button>
            );
          })}
          {human.zoneCounts.hand === 0 && <p className="empty">No cards remain in hand.</p>}
        </div>
      </section>

      <div className="lower-layout">
        <Market game={game} busy={busy} onAction={act} />
        <History game={game} />
      </div>
    </main>
  );
}

function Market({ game, busy, onAction }: {
  game: SafeGameView;
  busy: boolean;
  onAction: (action: LegalAction) => Promise<void>;
}) {
  const buyActions = new Map(game.legalActions.flatMap((action) =>
    action.command.type === 'buyCard' ? [[action.command.definitionId, action] as const] : []
  ));
  return (
    <section className="panel market-panel">
      <div className="panel-title"><h2>Shared market</h2><span>One purchase per turn</span></div>
      <div className="market-grid">
        {Object.entries(game.supply).map(([definitionId, count]) => {
          const definition = game.cards[definitionId];
          if (!definition) return null;
          const action = buyActions.get(definitionId);
          return (
            <button
              key={definitionId}
              className={`market-card${action ? ' market-card--affordable' : ''}`}
              disabled={!action || busy}
              onClick={() => action && void onAction(action)}
            >
              <span className="market-card__cost">{definition.cost}</span>
              <strong>{definition.name}</strong>
              <small>{definition.text}</small>
              <span className="market-card__count">{count} left</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function History({ game }: { game: SafeGameView }) {
  return (
    <section className="panel history-panel">
      <div className="panel-title"><h2>Action history</h2><span>{game.events.length} events</span></div>
      <ol>
        {game.events.slice(-24).reverse().map((event) => (
          <li key={event.sequence} className={event.sequence >= game.draftEventStart ? 'history__draft' : ''}>
            <span>{event.playerId}{event.sequence >= game.draftEventStart ? ' · draft' : ''}</span>
            <strong>{describeEvent(game, event)}</strong>
          </li>
        ))}
      </ol>
      {game.events.length === 0 && <p className="empty">The match has not started.</p>}
    </section>
  );
}

function describeEvent(game: SafeGameView, event: SafeGameView['events'][number]): string {
  const text = (key: string): string | null => typeof event.detail[key] === 'string' ? event.detail[key] : null;
  const coordinate = (key: string): string | null => {
    const value = event.detail[key];
    if (!value || typeof value !== 'object' || !('q' in value) || !('r' in value)) return null;
    return `${String(value.q)},${String(value.r)}`;
  };
  const shortPiece = (id: string | null): string => id ? id.replace('ochre-', '').replace('indigo-', '').toUpperCase() : 'piece';
  switch (event.type) {
    case 'cardPlayed': {
      const definitionId = text('definitionId');
      return `Played ${definitionId ? game.cards[definitionId]?.name ?? definitionId : 'card'}`;
    }
    case 'baselineMove': return `Moved ${shortPiece(text('pieceId'))} to ${coordinate('to') ?? 'hex'}`;
    case 'dash': return `Dashed ${shortPiece(text('pieceId'))} to ${coordinate('to') ?? 'hex'}`;
    case 'displacement': return `Displaced ${shortPiece(text('pieceId'))} to ${coordinate('to') ?? 'hex'}`;
    case 'ringOut': return `Rang out ${shortPiece(text('pieceId'))}`;
    case 'purchase': {
      const definitionId = text('definitionId');
      return `Bought ${definitionId ? game.cards[definitionId]?.name ?? definitionId : 'card'}`;
    }
    case 'enterBuyPhase': return 'Entered buy phase';
    case 'endTurn': return 'Ended turn';
    case 'respawn': return `Respawned ${shortPiece(text('pieceId'))}`;
    case 'brace': return `Braced ${shortPiece(text('pieceId'))}`;
    case 'pin': return `Pinned ${shortPiece(text('pieceId'))}`;
    default: return event.type.replace(/([A-Z])/g, ' $1');
  }
}
