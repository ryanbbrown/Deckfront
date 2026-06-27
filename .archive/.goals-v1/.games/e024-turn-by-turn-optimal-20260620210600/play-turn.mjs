import { mkdir, writeFile } from 'node:fs/promises';
import { runCli } from '../../src/cli/main.ts';
import { runPlaytestCli } from '../../src/playtest/main.ts';

const run = '.games/e024-turn-by-turn-optimal-20260620210600';
const config = 'rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6/deck.yaml';

const [turnId, player, deckActionsJson, boardActionsJson, summary, reasoning] = process.argv.slice(2);

if (!turnId || !player || !deckActionsJson || !boardActionsJson || !summary || !reasoning) {
  throw new Error('Usage: bun play-turn.mjs <turnId> <player> <deckActionsJson> <boardActionsJson> <summary> <reasoning>');
}

const deckActions = JSON.parse(deckActionsJson);
const boardActions = JSON.parse(boardActionsJson);
const deckActionsPath = `${run}/actions/${turnId}.deck.json`;
const boardActionsPath = `${run}/actions/${turnId}.board.json`;
const deckResultPath = `${run}/results/${turnId}.deck.result.json`;
const boardResultPath = `${run}/results/${turnId}.board.result.json`;

await mkdir(`${run}/actions`, { recursive: true });
await mkdir(`${run}/results`, { recursive: true });
await writeFile(
  deckActionsPath,
  `${JSON.stringify({ schemaVersion: 1, turnId, player, actions: deckActions }, null, 2)}\n`
);
await writeFile(
  boardActionsPath,
  `${JSON.stringify({ schemaVersion: 1, turnId, player, actions: boardActions }, null, 2)}\n`
);

const output = (message) => console.log(message);
await runCli(['deck-turn', '--config', config, '--state', `${run}/deck.json`, '--actions', deckActionsPath, '--result', deckResultPath], output);
await runCli(['board-turn', '--state', `${run}/board.json`, '--deck-result', deckResultPath, '--actions', boardActionsPath, '--result', boardResultPath], output);
await runPlaytestCli(['commit-turn', '--run', run, '--deck-result', deckResultPath, '--board-result', boardResultPath, '--summary', summary, '--reasoning', reasoning], output);
await runPlaytestCli(['validate', '--strict', '--strict-deck', `${run}/timeline.json`], output);
