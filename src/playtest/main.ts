import { initPlaytestRun, validateReplayBundle } from './run';

interface InitArgs {
  run?: string;
  ruleset?: string;
  map?: string;
  units?: string;
  players?: string[];
  title?: string;
}

export async function runPlaytestCli(argv: string[], output: (message: string) => void = console.log): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    output(helpText());
    return;
  }

  if (command === 'validate') {
    const timelinePath = rest[0];
    if (!timelinePath) {
      throw new Error('Missing timeline path');
    }
    const bundle = await validateReplayBundle(timelinePath);
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
      ...(args.units ? { unitsPath: args.units } : {}),
      ...(args.players ? { players: args.players } : {}),
      ...(args.title ? { title: args.title } : {})
    });
    output(`Initialized playtest run: ${paths.root}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
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
    '  validate <timeline.json>',
    '  init --run <path> --ruleset <id> --map <id> [--units <file>] [--players P1,P2] [--title <title>]'
  ].join('\n');
}

if (import.meta.main) {
  runPlaytestCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
