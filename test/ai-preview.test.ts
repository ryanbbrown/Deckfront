import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAiBriefing } from '../src/ai/briefing';
import { createGame } from '../src/game';
import type { CardInstance, GameState } from '../src/game';

const execute = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const previewCli = path.join(projectRoot, 'src/ai/previewCli.ts');
const tsx = path.join(projectRoot, 'node_modules/.bin/tsx');
let temporaryDirectory = '';

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

describe('AI preview boundary', () => {
  it('reveals the AI deck contents without revealing human private cards', () => {
    const state = createGame(12);
    state.activePlayerId = 'indigo';
    const human = state.players.ochre;
    const secretIds = [...human.deck.draw, ...human.deck.hand].map((card) => card.id);
    state.events = Array.from({ length: 35 }, (_, sequence) => ({
      sequence,
      type: 'baselineMove' as const,
      playerId: sequence % 2 === 0 ? 'ochre' as const : 'indigo' as const,
      detail: { marker: `public-${sequence}` }
    }));
    const briefing = buildAiBriefing(state, 'indigo', 0);
    const exposedStrings = collectStrings(briefing);

    expect(briefing.ai.hand).toEqual(state.players.indigo.deck.hand.map((card) => ({
      ...card,
      definition: expect.objectContaining({ id: card.definitionId })
    })));
    expect(briefing.humanPublicCounts).toEqual({
      draw: human.deck.draw.length,
      hand: human.deck.hand.length,
      discard: human.deck.discard.length,
      play: human.deck.play.length
    });
    for (const secretId of secretIds) expect(exposedStrings).not.toContain(secretId);
    expect(briefing).not.toHaveProperty('human');
    expect(briefing).not.toHaveProperty('recentPublicEvents');
    expect(briefing.publicEvents).toHaveLength(35);
    expect(briefing.publicEvents[0]?.detail).toEqual({ marker: 'public-0' });
    expect(briefing.publicEvents.at(-1)?.detail).toEqual({ marker: 'public-34' });
  });

  it('rejects the buy phase until the deterministic best point is scored', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-preview-test-'));
    const snapshotPath = path.join(temporaryDirectory, 'snapshot.json');
    const sessionPath = path.join(temporaryDirectory, 'session.json');
    const state = scoringFixture();
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      gameId: 'preview-test',
      baseRevision: 7,
      aiPlayerId: 'indigo',
      state
    }));

    const initial = await preview('init', ['--snapshot', snapshotPath, '--session', sessionPath]);
    expect(initial.briefing.maximumPointsAvailable).toBe(1);
    const rejected = await preview('enter-buy', ['--session', sessionPath]);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('1 point(s) are available');

    const shove = initial.briefing.legalActions.find((action: PreviewAction) =>
      action.command.type === 'playShove' && action.command.targetId === 'ochre-a'
    );
    if (!shove) throw new Error('Expected a scoring Shove action.');
    const scored = await preview('take-action', ['--session', sessionPath, '--action-id', shove.id]);
    expect(scored.briefing.pointsScoredThisPreview).toBe(1);
    expect(scored.briefing.scores.indigo).toBe(1);
    const undone = await preview('undo', ['--session', sessionPath]);
    expect(undone.briefing.pointsScoredThisPreview).toBe(0);
    await preview('take-action', ['--session', sessionPath, '--action-id', shove.id]);
    const restarted = await preview('restart', ['--session', sessionPath]);
    expect(restarted.briefing.pointsScoredThisPreview).toBe(0);
    await preview('take-action', ['--session', sessionPath, '--action-id', shove.id]);
    const buy = await preview('enter-buy', ['--session', sessionPath]);
    expect(buy.ok).toBe(true);
    expect(buy.briefing.phase).toBe('buy');

    const original = JSON.parse(await readFile(snapshotPath, 'utf8')) as { state: GameState };
    expect(original.state.scores.indigo).toBe(0);
    expect(original.state.pieces['ochre-a'].position).toEqual({ q: 3, r: 0 });
  });

  it('rejects a buy-only turn when a legal board action is available', async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'hexdeck-preview-test-'));
    const snapshotPath = path.join(temporaryDirectory, 'snapshot.json');
    const sessionPath = path.join(temporaryDirectory, 'session.json');
    let seed = 0;
    while (createGame(seed).activePlayerId !== 'indigo') seed += 1;
    const state = createGame(seed);
    state.players.indigo.turnsTaken = 2;
    await writeFile(snapshotPath, JSON.stringify({
      schemaVersion: 1,
      gameId: 'non-opening-preview-test',
      baseRevision: 9,
      aiPlayerId: 'indigo',
      state
    }));

    const initial = await preview('init', ['--snapshot', snapshotPath, '--session', sessionPath]);
    expect(initial.briefing.maximumPointsAvailable).toBe(0);
    expect(initial.briefing.legalActions.length).toBeGreaterThan(0);

    const rejected = await preview('enter-buy', ['--session', sessionPath]);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toContain('Take a legal board action before entering the buy phase');
  });
});

interface PreviewAction {
  id: string;
  command: { type: string; targetId?: string };
}

interface PreviewResponse {
  ok: boolean;
  error?: string;
  briefing: {
    maximumPointsAvailable: number;
    pointsScoredThisPreview: number;
    scores: Record<string, number>;
    phase: string;
    legalActions: PreviewAction[];
  };
}

async function preview(operation: string, args: string[]): Promise<PreviewResponse> {
  const result = await execute(tsx, [previewCli, operation, ...args], { cwd: projectRoot });
  return JSON.parse(result.stdout) as PreviewResponse;
}

function scoringFixture(): GameState {
  const state = createGame(1);
  state.activePlayerId = 'indigo';
  state.phase = 'action';
  state.scores = { ochre: 0, indigo: 0 };
  state.pieces['indigo-a'].position = { q: 2, r: 0 };
  state.pieces['indigo-b'].position = { q: 0, r: -1 };
  state.pieces['ochre-a'].position = { q: 3, r: 0 };
  state.pieces['ochre-b'].position = { q: -1, r: 1 };
  const indigo = state.players.indigo;
  const shove = findCard(indigo.deck, 'shove');
  for (const zone of [indigo.deck.draw, indigo.deck.hand, indigo.deck.discard, indigo.deck.play]) {
    const index = zone.findIndex((card) => card.id === shove.id);
    if (index >= 0) zone.splice(index, 1);
  }
  indigo.deck.hand.push(shove);
  return state;
}

function findCard(
  deck: GameState['players']['ochre']['deck'],
  definitionId: string
): CardInstance {
  const card = [...deck.draw, ...deck.hand, ...deck.discard, ...deck.play]
    .find((candidate) => candidate.definitionId === definitionId);
  if (!card) throw new Error(`Missing ${definitionId} fixture card.`);
  return card;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}
