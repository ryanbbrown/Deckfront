import { useEffect, useRef, useState } from 'react';
import type { PlayerId, RandomIndexSource } from '../game';
import type { AiDifficulty, GameMode, GameStatistics, GameView, PresentationSequence, SetupCatalog } from '../shared/api';
import { createGame, loadGame, loadSetup, loadStatistics } from './api';
import { Game, InstructionsDialog, PreviewTable } from './Game';
import { AI_ANIMATION_KEY, updateGame } from './playback';
import { chooseTrainedVariableCards } from './setupMarket';
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
    void loadSetup().then(async (setup) => {
      setCatalog(setup); setMarket(chooseTrainedVariableCards(cryptoRandom, setup.trainedVariableCardSets));
      const id = localStorage.getItem(ACTIVE_GAME_KEY);
      if (!id) return;
      try { setGame(await loadGame(id)); }
      catch { localStorage.removeItem(ACTIVE_GAME_KEY); }
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load setup.')).finally(() => setLoading(false));
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
  function setAnimateAi(enabled: boolean) { localStorage.setItem(AI_ANIMATION_KEY, String(enabled)); setAnimateAiState(enabled); }
  function newGame() { generation.current += 1; localStorage.removeItem(ACTIVE_GAME_KEY); setInitialPresentation(null); setGame(null); setStatistics(null); setStatisticsLoading(true); setError(null); setLoading(false); setTraining(false); if (catalog) setMarket(chooseTrainedVariableCards(cryptoRandom, catalog.trainedVariableCardSets, market)); }
  const gameGeneration = generation.current;
  const content = training ? <main className="training-state"><div><span className="spinner" /><h1>Training opponent…</h1><p>The AI is testing strategies for this market.</p></div></main>
    : loading || !catalog ? <main className="loading">Loading Deckfront…</main>
      : !game ? <PreviewTable catalog={catalog} market={market} error={error} animateAi={animateAi} statistics={statistics} statisticsLoading={statisticsLoading} onAnimateAi={setAnimateAi} onRefresh={() => setMarket(chooseTrainedVariableCards(cryptoRandom, catalog.trainedVariableCardSets, market))} onStart={start} />
        : <Game game={game} initialPresentation={initialPresentation} error={error} animateAi={animateAi} onAnimateAi={setAnimateAi} onGameId={(id) => localStorage.setItem(ACTIVE_GAME_KEY, id)} onGame={(next) => { if (generation.current === gameGeneration) { setInitialPresentation(null); setGame(next); } }} onError={(value) => { if (generation.current === gameGeneration) setError(value); }} onNew={newGame} />;
  return <>{content}{instructionsOpen ? <InstructionsDialog onDismiss={() => setInstructionsOpen(false)} onNeverShow={() => localStorage.setItem(INSTRUCTIONS_DISMISSED_KEY, 'true')} /> : null}</>;
}
