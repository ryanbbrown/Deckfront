import { applyAction } from '../core/engine';
import { listLegalActions } from '../core/legalActions';
import type { GameState } from '../core/types';
import { InteractiveInputAdapter, parseIntegerChoice, scriptedInputFromFile, type InputAdapter } from './modes';
import { renderResults, renderState } from './render';
import { loadDeckSession } from './session';
import { runBoardTurnCli, runDeckTurnCli, runLegalActionsCli } from './structured';

export interface CliArgs {
  config?: string;
  seed: number;
  script?: string;
  state?: string;
  maxActions?: number;
  startingDecks: string[];
  drafts: string[];
  help: boolean;
}

export async function runCli(argv: string[], output: (message: string) => void = console.log): Promise<GameState> {
  if (argv[0] === 'legal-actions') {
    await runLegalActionsCli(argv.slice(1), output);
    return undefined as never;
  }
  if (argv[0] === 'deck-turn') {
    await runDeckTurnCli(argv.slice(1), output);
    return undefined as never;
  }
  if (argv[0] === 'board-turn') {
    await runBoardTurnCli(argv.slice(1), output);
    return undefined as never;
  }

  const args = parseArgs(argv);
  if (args.help) {
    output(helpText());
    throw new HelpRequested();
  }
  if (!args.config) {
    throw new Error('Missing required --config path');
  }

  const input = args.script ? await scriptedInputFromFile(args.script) : new InteractiveInputAdapter();
  const session = await loadDeckSession({
    config: args.config,
    seed: args.seed,
    ...(args.state ? { state: args.state } : {}),
    startingDecks: args.startingDecks,
    drafts: args.drafts
  });
  let state = session.game;
  let acceptedActions = 0;

  while (!state.ended) {
    if (args.maxActions !== undefined && acceptedActions >= args.maxActions) {
      break;
    }
    const actions = listLegalActions(state);
    output(renderState(state, actions));
    const choice = await readValidChoice(input, actions.length, output);
    state = applyAction(state, actions[choice - 1]!.action, session.rng);
    acceptedActions += 1;
    await session.save(state);
  }
  if (state.ended) {
    output(renderResults(state));
  }
  return state;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { seed: 1, startingDecks: [], drafts: [], help: false };
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
    } else if (arg === '--draft') {
      args.drafts.push(requireValue(argv, ++index, '--draft'));
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  if (args.startingDecks.length > 0 && args.drafts.length > 0) {
    throw new Error('--draft cannot be combined with --starting-deck');
  }
  if (!Number.isInteger(args.seed)) {
    throw new Error('--seed must be an integer');
  }
  if (args.maxActions !== undefined && (!Number.isInteger(args.maxActions) || args.maxActions < 0)) {
    throw new Error('--max-actions must be a non-negative integer');
  }
  return args;
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
    '  --draft <cards> Build 7 copper plus up to 12 cost of drafted cards; unspent money carries to first turn',
    '  legal-actions --config <path> --state <path> --json',
    '  deck-turn --config <path> --state <path> --actions <file> --result <file>',
    '  board-turn --state <board.json> --deck-result <file> --actions <file> --result <file>',
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
