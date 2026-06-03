import { loadGameConfig } from '../config/loadGameConfig';
import { applyAction } from '../core/engine';
import { listLegalActions } from '../core/legalActions';
import { SeededRng, shuffle, type Rng } from '../core/random';
import { drawCards, setupGame } from '../core/state';
import type { GameState } from '../core/types';
import { InteractiveInputAdapter, parseIntegerChoice, scriptedInputFromFile, type InputAdapter } from './modes';
import { loadPersistedGame, savePersistedGame, stateFileExists } from './persistence';
import { renderResults, renderState } from './render';

export interface CliArgs {
  config?: string;
  seed: number;
  script?: string;
  state?: string;
  maxActions?: number;
  startingDecks: string[];
  help: boolean;
}

export async function runCli(argv: string[], output: (message: string) => void = console.log): Promise<GameState> {
  const args = parseArgs(argv);
  if (args.help) {
    output(helpText());
    throw new HelpRequested();
  }
  if (!args.config) {
    throw new Error('Missing required --config path');
  }

  const config = await loadGameConfig(args.config);
  const loaded = args.state && (await stateFileExists(args.state)) ? await loadPersistedGame(args.state) : undefined;
  const rng = loaded ? SeededRng.fromState(loaded.rngState) : new SeededRng(args.seed);
  const input = args.script ? await scriptedInputFromFile(args.script) : new InteractiveInputAdapter();
  let state = loaded ? loaded.game : setupGame(config, rng);
  if (!loaded && args.startingDecks.length > 0) {
    applyStartingDeckOverrides(state, args.startingDecks, rng);
  }
  let acceptedActions = 0;

  if (args.state && !loaded) {
    await savePersistedGame(args.state, { schemaVersion: 1, rngState: rng.snapshot(), game: state });
  }

  while (!state.ended) {
    if (args.maxActions !== undefined && acceptedActions >= args.maxActions) {
      break;
    }
    const actions = listLegalActions(state);
    output(renderState(state, actions));
    const choice = await readValidChoice(input, actions.length, output);
    state = applyAction(state, actions[choice - 1]!.action, rng);
    acceptedActions += 1;
    if (args.state) {
      await savePersistedGame(args.state, { schemaVersion: 1, rngState: rng.snapshot(), game: state });
    }
  }
  if (state.ended) {
    output(renderResults(state));
  }
  return state;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { seed: 1, startingDecks: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--config') {
      args.config = requireValue(argv, ++index, '--config');
    } else if (arg === '--seed') {
      args.seed = parseIntegerChoice(requireValue(argv, ++index, '--seed'));
    } else if (arg === '--script') {
      args.script = requireValue(argv, ++index, '--script');
    } else if (arg === '--state') {
      args.state = requireValue(argv, ++index, '--state');
    } else if (arg === '--max-actions') {
      args.maxActions = parseIntegerChoice(requireValue(argv, ++index, '--max-actions'));
    } else if (arg === '--starting-deck') {
      args.startingDecks.push(requireValue(argv, ++index, '--starting-deck'));
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error('--seed must be an integer');
  }
  if (args.maxActions !== undefined && (!Number.isInteger(args.maxActions) || args.maxActions < 0)) {
    throw new Error('--max-actions must be a non-negative integer');
  }
  return args;
}

function applyStartingDeckOverrides(state: GameState, overrides: string[], rng: Rng): void {
  for (const override of overrides) {
    const [maybePlayer, maybeCards] = override.includes('=') ? override.split('=', 2) : [undefined, override];
    const playerIds = maybePlayer ? [maybePlayer.trim()] : state.players.map((player) => player.id);
    const cards = parseCardList(maybeCards ?? '');
    if (cards.length === 0) {
      throw new Error('--starting-deck must include at least one card');
    }
    for (const cardId of cards) {
      if (!state.cards[cardId]) {
        throw new Error(`Unknown starting deck card: ${cardId}`);
      }
    }
    for (const playerId of playerIds) {
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!player) {
        throw new Error(`Unknown starting deck player: ${playerId}`);
      }
      player.draw = shuffle(cards, rng);
      player.hand = [];
      player.discard = [];
      player.play = [];
      player.freeTrashUsed = false;
      drawCards(player, state.config.setup.handSize, rng);
    }
  }
}

function parseCardList(value: string): string[] {
  return value
    .split(',')
    .map((cardId) => cardId.trim())
    .filter((cardId) => cardId.length > 0);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function readValidChoice(input: InputAdapter, optionCount: number, output: (message: string) => void): Promise<number> {
  while (true) {
    const choice = await input.nextChoice();
    if (Number.isInteger(choice) && choice >= 1 && choice <= optionCount) {
      return choice;
    }
    output(`Invalid choice: ${String(choice)}`);
  }
}

function helpText(): string {
  return [
    'Usage: bun run src/cli/main.ts --config <path> [--seed <number>] [--script <path>]',
    '',
    'Options:',
    '  --config <path>  YAML game definition',
    '  --seed <number>  Deterministic shuffle seed (default: 1)',
    '  --script <path> Numeric choices, one per line',
    '  --state <path>   Persist and resume game state from JSON',
    '  --max-actions <number> Stop after this many accepted actions',
    '  --starting-deck <cards> Override new-game starting deck; use P1=card,card for one player',
    '  --help           Show this help'
  ].join('\n');
}

class HelpRequested extends Error {}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error) => {
    if (error instanceof HelpRequested) {
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
