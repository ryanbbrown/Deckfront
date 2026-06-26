import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { boardStateSchema } from '../board/schema';
import { listLegalActions } from '../core/legalActions';
import { executeBoardTurn, loadBoardRulesContext, readBoardTurnInput, readDeckTurnResult } from '../playtest/boardTurn';
import { readDeckTurnInput, executeDeckTurn, type DeckSnapshot } from '../playtest/deckTurn';
import { savePersistedGame } from './persistence';
import { renderState } from './render';
import { loadDeckSession } from './session';

interface StructuredBaseArgs {
  config?: string;
  seed: number;
  state?: string;
  startingDecks: string[];
  drafts: string[];
}

interface LegalActionsArgs extends StructuredBaseArgs {
  json: boolean;
}

interface DeckTurnArgs extends StructuredBaseArgs {
  actions?: string;
  result?: string;
}

interface BoardTurnArgs {
  state?: string;
  deckResult?: string;
  actions?: string;
  result?: string;
}

export async function runLegalActionsCli(argv: string[], output: (message: string) => void): Promise<void> {
  const args = parseLegalActionsArgs(argv);
  if (!args.config) {
    throw new Error('Missing required --config path');
  }

  const session = await loadDeckSession({
    config: args.config,
    seed: args.seed,
    ...(args.state ? { state: args.state } : {}),
    startingDecks: args.startingDecks,
    drafts: args.drafts
  });
  const actions = listLegalActions(session.game);
  const activePlayer = session.game.players[session.game.activePlayer]?.id;

  if (!args.json) {
    output(renderState(session.game, actions));
    return;
  }

  output(JSON.stringify(
    {
      schemaVersion: 1,
      activePlayer,
      phase: session.game.phase,
      actions: actions.map((action, index) => ({
        index: index + 1,
        description: action.description,
        action: action.action
      }))
    },
    null,
    2
  ));
}

export async function runDeckTurnCli(argv: string[], output: (message: string) => void): Promise<void> {
  const args = parseDeckTurnArgs(argv);
  if (!args.config) {
    throw new Error('Missing required --config path');
  }
  if (!args.state) {
    throw new Error('Missing required --state path');
  }
  if (!args.actions) {
    throw new Error('Missing required --actions path');
  }
  if (!args.result) {
    throw new Error('Missing required --result path');
  }

  const session = await loadDeckSession({
    config: args.config,
    seed: args.seed,
    state: args.state,
    startingDecks: args.startingDecks,
    drafts: args.drafts
  });
  const input = await readDeckTurnInput(args.actions);
  const runRoot = dirname(args.state);
  const beforePath = join('snapshots', `${input.turnId}.before.deck.json`);
  const afterPath = join('snapshots', `${input.turnId}.after.deck.json`);
  const beforeSnapshot: DeckSnapshot = {
    schemaVersion: 1,
    rngState: session.rng.snapshot(),
    game: session.game
  };
  const executed = executeDeckTurn(beforeSnapshot, input, { beforePath, afterPath });

  await mkdir(join(runRoot, 'snapshots'), { recursive: true });
  await mkdir(dirname(args.result), { recursive: true });
  await writeFile(join(runRoot, beforePath), `${JSON.stringify(executed.before, null, 2)}\n`);
  await writeFile(join(runRoot, afterPath), `${JSON.stringify(executed.after, null, 2)}\n`);
  await writeFile(args.result, `${JSON.stringify(executed.result, null, 2)}\n`);
  await savePersistedGame(args.state, executed.after);
  output(`Deck turn complete: ${args.result}`);
}

export async function runBoardTurnCli(argv: string[], output: (message: string) => void): Promise<void> {
  const args = parseBoardTurnArgs(argv);
  if (!args.state) {
    throw new Error('Missing required --state path');
  }
  if (!args.deckResult) {
    throw new Error('Missing required --deck-result path');
  }
  if (!args.actions) {
    throw new Error('Missing required --actions path');
  }
  if (!args.result) {
    throw new Error('Missing required --result path');
  }

  const board = boardStateSchema.parse(JSON.parse(await readFile(args.state, 'utf8')) as unknown);
  const deckResult = await readDeckTurnResult(args.deckResult);
  const input = await readBoardTurnInput(args.actions);
  const context = await loadBoardRulesContext(board);
  const runRoot = dirname(args.state);
  const beforePath = join('snapshots', `${input.turnId}.before.board.json`);
  const afterPath = join('snapshots', `${input.turnId}.after.board.json`);
  const executed = executeBoardTurn(board, deckResult, input, context, { beforePath, afterPath });

  await mkdir(join(runRoot, 'snapshots'), { recursive: true });
  await mkdir(dirname(args.result), { recursive: true });
  await writeFile(join(runRoot, beforePath), `${JSON.stringify(executed.before, null, 2)}\n`);
  await writeFile(join(runRoot, afterPath), `${JSON.stringify(executed.after, null, 2)}\n`);
  await writeFile(args.result, `${JSON.stringify(executed.result, null, 2)}\n`);
  await writeFile(args.state, `${JSON.stringify(executed.after, null, 2)}\n`);
  output(`Board turn complete: ${args.result}`);
}

function parseLegalActionsArgs(argv: string[]): LegalActionsArgs {
  const args: LegalActionsArgs = { seed: 1, startingDecks: [], drafts: [], json: false };
  parseStructuredBaseArgs(argv, args, (arg) => {
    if (arg === '--json') {
      args.json = true;
      return true;
    }
    return false;
  });
  return args;
}

function parseDeckTurnArgs(argv: string[]): DeckTurnArgs {
  const args: DeckTurnArgs = { seed: 1, startingDecks: [], drafts: [] };
  parseStructuredBaseArgs(argv, args, (arg, argv, index) => {
    if (arg === '--actions') {
      args.actions = requireValue(argv, index + 1, '--actions');
      return 1;
    }
    if (arg === '--result') {
      args.result = requireValue(argv, index + 1, '--result');
      return 1;
    }
    return false;
  });
  return args;
}

function parseBoardTurnArgs(argv: string[]): BoardTurnArgs {
  const args: BoardTurnArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--state') {
      args.state = requireValue(argv, ++index, '--state');
    } else if (arg === '--deck-result') {
      args.deckResult = requireValue(argv, ++index, '--deck-result');
    } else if (arg === '--actions') {
      args.actions = requireValue(argv, ++index, '--actions');
    } else if (arg === '--result') {
      args.result = requireValue(argv, ++index, '--result');
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  return args;
}

function parseStructuredBaseArgs(
  argv: string[],
  args: StructuredBaseArgs,
  parseExtra: (arg: string, argv: string[], index: number) => boolean | number
): void {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      args.config = requireValue(argv, ++index, '--config');
    } else if (arg === '--seed') {
      args.seed = parseIntegerChoice(requireValue(argv, ++index, '--seed'));
    } else if (arg === '--state') {
      args.state = requireValue(argv, ++index, '--state');
    } else if (arg === '--starting-deck') {
      args.startingDecks.push(requireValue(argv, ++index, '--starting-deck'));
    } else if (arg === '--draft') {
      args.drafts.push(requireValue(argv, ++index, '--draft'));
    } else {
      const extra = parseExtra(String(arg), argv, index);
      if (extra === true) {
        continue;
      }
      if (typeof extra === 'number') {
        index += extra;
        continue;
      }
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }

  if (!Number.isInteger(args.seed)) {
    throw new Error('--seed must be an integer');
  }
  if (args.startingDecks.length > 0 && args.drafts.length > 0) {
    throw new Error('--draft cannot be combined with --starting-deck');
  }
}

function parseIntegerChoice(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    return Number.NaN;
  }
  return Number(value);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}
