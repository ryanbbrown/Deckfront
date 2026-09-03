import { useEffect, useRef, useState } from 'react';
import type { PlayerId, RandomIndexSource } from '../game';
import type { AiDifficulty, GameMode, GameStatistics, GameView, PresentationSequence, SetupBattlefield, SetupCatalog } from '../shared/api';
import { createGame, loadGame, loadSetup, loadStatistics } from './api';
import { Game, InstructionsDialog, PreviewTable } from './Game';
import { AI_ANIMATION_KEY, updateGame } from './playback';
import {
  barePlayUrl, battlefieldRangeError, battlefieldUrl, chooseBattlefield, findBattlefieldByCards,
  findBattlefieldByNumber, parsePlayRoute
} from './setupMarket';
import { PublicSite } from './PublicPages';

const ACTIVE_GAME_KEY = 'hexdeck.activeGameId';
const INSTRUCTIONS_DISMISSED_KEY = 'deckfront.instructionsDismissed';
const cryptoRandom: RandomIndexSource = {
  nextInt(maxExclusive) {
    const range = 0x1_0000_0000;
    const limit = range - range % maxExclusive;
    let value = 0;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (value >= limit);
    return value % maxExclusive;
  }
};

export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return <PublicSite page="home" />;
  if (path === '/rules') return <PublicSite page="rules" />;
  if (path === '/about') return <PublicSite page="about" />;
  return <div className="game-app"><PlayApp /></div>;
}

function PlayApp() {
  const [catalog, setCatalog] = useState<SetupCatalog | null>(null);
  const [market, setMarket] = useState<string[]>([]);
  const [battlefieldNumber, setBattlefieldNumber] = useState<number | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animateAi, setAnimateAiState] = useState(() => localStorage.getItem(AI_ANIMATION_KEY) !== 'false');
  const [initialPresentation, setInitialPresentation] = useState<PresentationSequence | null>(null);
  const [statistics, setStatistics] = useState<GameStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(() => localStorage.getItem(INSTRUCTIONS_DISMISSED_KEY) !== 'true');
  const generation = useRef(0);
  const statisticsGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void initialize().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };

    async function initialize() {
      try {
        const setup = await loadSetup();
        let activeGame: GameView | null = null;
        const activeId = localStorage.getItem(ACTIVE_GAME_KEY);
        if (activeId) {
          try { activeGame = await loadGame(activeId); }
          catch { localStorage.removeItem(ACTIVE_GAME_KEY); }
        }
        if (cancelled) return;
        setCatalog(setup);
        const route = parsePlayRoute(window.location.pathname, setup.battlefields);
        const activeBattlefield = activeGame ? findBattlefieldByCards(setup.battlefields, activeGame.variableCardIds) : null;
        if (route.kind === 'battlefield') {
          showBattlefield(route.battlefield);
          if (activeGame && activeBattlefield?.number === route.battlefield.number) setGame(activeGame);
          if (!route.canonical) replaceUrl(battlefieldUrl(route.battlefield.number, window.location));
          return;
        }
        if (route.kind === 'invalid') {
          const selected = chooseBattlefield(cryptoRandom, setup.battlefields);
          showBattlefield(selected);
          setError(battlefieldRangeError(setup.battlefields.length));
          replaceUrl(battlefieldUrl(selected.number, window.location));
          return;
        }
        if (activeGame) {
          setMarket([...activeGame.variableCardIds]);
          setBattlefieldNumber(activeBattlefield?.number ?? null);
          setGame(activeGame);
          replaceUrl(activeBattlefield
            ? battlefieldUrl(activeBattlefield.number, window.location)
            : barePlayUrl(window.location));
          return;
        }
        const selected = chooseBattlefield(cryptoRandom, setup.battlefields);
        showBattlefield(selected);
        replaceUrl(battlefieldUrl(selected.number, window.location));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load setup.');
      }
    }

    function showBattlefield(battlefield: SetupBattlefield) {
      setMarket([...battlefield.variableCardIds]);
      setBattlefieldNumber(battlefield.number);
      setGame(null);
    }
  }, []);

  const setupActive = !loading && catalog !== null && game === null && !training;
  useEffect(() => {
    if (!setupActive) return;
    const requestGeneration = ++statisticsGeneration.current;
    setStatistics(null); setStatisticsLoading(true);
    void loadStatistics().then((loaded) => {
      if (requestGeneration === statisticsGeneration.current) setStatistics(loaded);
    }).catch(() => {
      if (requestGeneration === statisticsGeneration.current) setStatistics(null);
    }).finally(() => {
      if (requestGeneration === statisticsGeneration.current) setStatisticsLoading(false);
    });
    return () => { if (requestGeneration === statisticsGeneration.current) statisticsGeneration.current += 1; };
  }, [setupActive]);

  async function start(mode: GameMode, startingDraftEnabled: boolean, humanPlayerId?: PlayerId, aiDifficulty?: AiDifficulty) {
    const requestGeneration = ++generation.current;
    setTraining(mode === 'ai'); setLoading(mode !== 'ai'); setError(null);
    try {
      const created = await createGame({ mode, variableCardIds: market, startingDraftEnabled,
        ...(mode === 'ai' ? { humanPlayerId, aiDifficulty } : {}) });
      if (requestGeneration !== generation.current) return;
      localStorage.setItem(ACTIVE_GAME_KEY, created.id); setInitialPresentation(created.presentation); setGame(updateGame(created));
    } catch (cause) { if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : 'Could not create game.'); }
    finally { if (requestGeneration === generation.current) { setLoading(false); setTraining(false); } }
  }
  function selectBattlefield(number: number) {
    if (!catalog) return;
    const selected = findBattlefieldByNumber(catalog.battlefields, number);
    if (!selected) return;
    setMarket([...selected.variableCardIds]); setBattlefieldNumber(selected.number); setError(null);
    replaceUrl(battlefieldUrl(selected.number, window.location));
  }
  function refreshBattlefield() {
    if (!catalog) return;
    const selected = chooseBattlefield(cryptoRandom, catalog.battlefields, battlefieldNumber);
    setMarket([...selected.variableCardIds]); setBattlefieldNumber(selected.number); setError(null);
    replaceUrl(battlefieldUrl(selected.number, window.location));
  }
  function setAnimateAi(enabled: boolean) { localStorage.setItem(AI_ANIMATION_KEY, String(enabled)); setAnimateAiState(enabled); }
  function newGame() {
    generation.current += 1; localStorage.removeItem(ACTIVE_GAME_KEY); setInitialPresentation(null);
    if (game && catalog) {
      const selected = findBattlefieldByCards(catalog.battlefields, game.variableCardIds);
      setMarket([...game.variableCardIds]); setBattlefieldNumber(selected?.number ?? null);
      replaceUrl(selected ? battlefieldUrl(selected.number, window.location) : barePlayUrl(window.location));
    }
    setGame(null); setStatistics(null); setStatisticsLoading(true); setError(null); setLoading(false); setTraining(false);
  }
  const gameGeneration = generation.current;
  const content = training ? <main className="training-state"><div><span className="spinner" /><h1>Training opponent…</h1><p>The AI is testing strategies for this market.</p></div></main>
    : loading || !catalog ? <main className="loading">Loading Deckfront…</main>
      : !game ? <PreviewTable catalog={catalog} market={market} battlefieldNumber={battlefieldNumber} error={error} animateAi={animateAi} statistics={statistics} statisticsLoading={statisticsLoading} onAnimateAi={setAnimateAi} onBattlefield={selectBattlefield} onRefresh={refreshBattlefield} onStart={start} />
        : <Game game={game} battlefieldNumber={battlefieldNumber} initialPresentation={initialPresentation} error={error} animateAi={animateAi} onAnimateAi={setAnimateAi} onGameId={(id) => { if (generation.current === gameGeneration) localStorage.setItem(ACTIVE_GAME_KEY, id); }} onGame={(next) => { if (generation.current === gameGeneration) { setInitialPresentation(null); setGame(next); } }} onError={(value) => { if (generation.current === gameGeneration) setError(value); }} onNew={newGame} />;
  return <>{content}{instructionsOpen ? <InstructionsDialog onDismiss={() => setInstructionsOpen(false)} onNeverShow={() => localStorage.setItem(INSTRUCTIONS_DISMISSED_KEY, 'true')} /> : null}</>;
}

function replaceUrl(url: string): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== url) window.history.replaceState(null, '', url);
}
