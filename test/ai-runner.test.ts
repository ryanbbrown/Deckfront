import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ThinHarnessAiRunner } from '../src/server/aiRunner';
import { GameService } from '../src/server/gameService';
import { FileGameRepository } from '../src/server/persistence';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('ThinHarness bridge schemas and trace privacy', () => {
  it('returns a validated fake build and action without persisting private briefing zones', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hexdeck-runner-'));
    try {
      const service = new GameService(new FileGameRepository(path.join(directory, 'games'))); const created = await service.create({ seed: 4, firstPlayerId: 'indigo', strategyPresetId: 'close-pressure', strategyMarkdown: '# edited trace strategy sentinel' });
      const human = await service.updateHumanBuild(created.id, created.revision, [], true);
      const runner = new ThinHarnessAiRunner({ projectRoot: root, traceDirectory: path.join(directory, 'traces'), model: 'fake', effort: 'low', timeoutMilliseconds: 30_000, fakeModel: true });
      const build = await runner.run(await service.getRecord(created.id)); expect(build).toMatchObject({ schemaVersion: 2, kind: 'build', definitionIds: ['footwork', 'feint', 'drive'], summary: 'Built the requested strategy package.' });
      if (build.kind !== 'build') throw new Error('Expected build'); await service.commitAiBuild(created.id, build.baseRevision, build.definitionIds, build.summary, build.durationSeconds);
      const action = await runner.run(await service.getRecord(created.id)); expect(action).toMatchObject({ schemaVersion: 2, kind: 'action', summary: 'Selected the next deterministic strategy action.' });
      const trace = await readFile(action.tracePath!, 'utf8'); expect(trace).toContain('# edited trace strategy sentinel'); expect(trace).toContain('Selected the next deterministic strategy action.'); expect(trace).not.toContain('drawContentsUnordered'); expect(trace).not.toContain('"hand"'); expect(human.completedBuilds).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
