import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiTurnCoordinator } from '../src/server/aiCoordinator';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe.skipIf(process.env.HEXDECK_LIVE_AI !== '1')('live ThinHarness distance duel', () => {
  it('LIVE-AI-001: independently builds and completes one full AI turn through the real bridge', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-live-'));
    try {
      const service = new GameService(new FileGameRepository(path.join(directory, 'games')));
      const created = await service.create({ seed: 11, firstPlayerId: 'indigo', strategyPresetId: 'close-pressure', strategyMarkdown: '# Close pressure\nChoose Footwork, Feint, and Drive for the build. During the turn, make useful legal plays, then end the Action phase and end the Buy phase.' });
      const human = await service.updateHumanBuild(created.id, created.revision, ['aim', 'volley'], true);
      const runner = new ThinHarnessAiRunner({ projectRoot: root, traceDirectory: path.join(directory, 'traces'), model: process.env.HEXDECK_AI_MODEL ?? 'openai:gpt-5.6-luna', effort: process.env.HEXDECK_AI_EFFORT ?? 'low', timeoutMilliseconds: 240_000 });
      const coordinator = new AiTurnCoordinator(service, runner); await coordinator.start(created.id);
      let status = await coordinator.status(created.id);
      for (let count = 0; status.status === 'running' && count < 300; count += 1) { await new Promise((resolve) => setTimeout(resolve, 1000)); status = await coordinator.status(created.id); }
      expect(status.status).toBe('complete'); expect(status.game?.completedBuilds?.indigo.length).toBeGreaterThan(0); expect(status.game?.activePlayerId).toBe('ochre'); expect(status.game?.turn).toBe(2); expect(human.completedBuilds).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 300_000);
});
