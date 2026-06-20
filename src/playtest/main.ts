import { commitTurn } from './commitTurn';
import { initPlaytestRun, validateReplayBundle } from './run';

interface InitArgs {
  run?: string;
  ruleset?: string;
  map?: string;
  board?: string;
  units?: string;
  players?: string[];
  title?: string;
}

interface ValidateArgs {
  timelinePath?: string;
  strict?: boolean;
  strictDeck?: boolean;
  strictWin?: boolean;
}

interface CommitTurnArgs {
  run?: string;
  deckResult?: string;
  boardResult?: string;
  summary?: string;
  reasoning?: string;
  winEvents?: string;
  terminalWinEvents?: string;
  strictWin?: boolean;
}

export async function runPlaytestCli(argv: string[], output: (message: string) => void = console.log): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    output(helpText());
    return;
  }

  if (command === 'validate') {
    const args = parseValidateArgs(rest);
    if (!args.timelinePath) {
      throw new Error('Missing timeline path');
    }
    const bundle = await validateReplayBundle(args.timelinePath, {
      strict: args.strict ?? false,
      strictDeck: args.strictDeck ?? false,
      strictWin: args.strictWin ?? false
    });
    output(`Valid replay bundle: ${bundle.timeline.title} (${bundle.entries.length} entries)`);
    return;
  }

  if (command === 'init') {
    const args = parseInitArgs(rest);
    if (!args.run) {
      throw new Error('Missing required --run path');
    }
    if (!args.ruleset) {
      throw new Error('Missing required --ruleset id');
    }
    if (!args.map) {
      throw new Error('Missing required --map id');
    }
    const paths = await initPlaytestRun({
      root: args.run,
      ruleset: args.ruleset,
      map: args.map,
      ...(args.board ? { boardPath: args.board } : {}),
      ...(args.units ? { unitsPath: args.units } : {}),
      ...(args.players ? { players: args.players } : {}),
      ...(args.title ? { title: args.title } : {})
    });
    output(`Initialized playtest run: ${paths.root}`);
    return;
  }

  if (command === 'commit-turn') {
    const args = parseCommitTurnArgs(rest);
    if (!args.run) {
      throw new Error('Missing required --run path');
    }
    if (!args.deckResult) {
      throw new Error('Missing required --deck-result path');
    }
    if (!args.boardResult) {
      throw new Error('Missing required --board-result path');
    }
    if (!args.summary) {
      throw new Error('Missing required --summary text');
    }
    if (!args.reasoning) {
      throw new Error('Missing required --reasoning text');
    }
    const entry = await commitTurn({
      run: args.run,
      deckResultPath: args.deckResult,
      boardResultPath: args.boardResult,
      summary: args.summary,
      reasoning: args.reasoning,
      ...(args.winEvents ? { winEventsPath: args.winEvents } : {}),
      ...(args.terminalWinEvents ? { terminalWinEventsPath: args.terminalWinEvents } : {}),
      strictWin: args.strictWin ?? false
    });
    output(`Committed replay entry: ${entry.id}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseValidateArgs(argv: string[]): ValidateArgs {
  const args: ValidateArgs = {};
  for (const arg of argv) {
    if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--strict-deck') {
      args.strictDeck = true;
    } else if (arg === '--strict-win') {
      args.strictWin = true;
    } else if (!args.timelinePath) {
      args.timelinePath = arg;
    } else {
      throw new Error(`Unknown validate argument: ${arg}`);
    }
  }
  return args;
}

function parseInitArgs(argv: string[]): InitArgs {
  const args: InitArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      args.run = requireValue(argv, ++index, '--run');
    } else if (arg === '--ruleset') {
      args.ruleset = requireValue(argv, ++index, '--ruleset');
    } else if (arg === '--map') {
      args.map = requireValue(argv, ++index, '--map');
    } else if (arg === '--board') {
      args.board = requireValue(argv, ++index, '--board');
    } else if (arg === '--units') {
      args.units = requireValue(argv, ++index, '--units');
    } else if (arg === '--players') {
      args.players = requireValue(argv, ++index, '--players').split(',').map((player) => player.trim()).filter((player) => player.length > 0);
    } else if (arg === '--title') {
      args.title = requireValue(argv, ++index, '--title');
    } else {
      throw new Error(`Unknown init argument: ${String(arg)}`);
    }
  }
  return args;
}

function parseCommitTurnArgs(argv: string[]): CommitTurnArgs {
  const args: CommitTurnArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') {
      args.run = requireValue(argv, ++index, '--run');
    } else if (arg === '--deck-result') {
      args.deckResult = requireValue(argv, ++index, '--deck-result');
    } else if (arg === '--board-result') {
      args.boardResult = requireValue(argv, ++index, '--board-result');
    } else if (arg === '--summary') {
      args.summary = requireValue(argv, ++index, '--summary');
    } else if (arg === '--reasoning') {
      args.reasoning = requireValue(argv, ++index, '--reasoning');
    } else if (arg === '--win-events') {
      args.winEvents = requireValue(argv, ++index, '--win-events');
    } else if (arg === '--terminal-win-events') {
      args.terminalWinEvents = requireValue(argv, ++index, '--terminal-win-events');
    } else if (arg === '--strict-win') {
      args.strictWin = true;
    } else {
      throw new Error(`Unknown commit-turn argument: ${String(arg)}`);
    }
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

function helpText(): string {
  return [
    'Usage: bun run playtest -- <command>',
    '',
    'Commands:',
    '  validate [--strict] [--strict-deck] [--strict-win] <timeline.json>',
    '  init --run <path> --ruleset <id> --map <id> [--board <file>] [--units <file>] [--players P1,P2] [--title <title>]',
    '  commit-turn --run <path> --deck-result <file> --board-result <file> --summary <text> --reasoning <text> [--win-events <file>] [--terminal-win-events <file>] [--strict-win]'
  ].join('\n');
}

if (import.meta.main) {
  runPlaytestCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
