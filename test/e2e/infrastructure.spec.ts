import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, isolatedRuntimeEvidence, loadSaved, seedScenario, test } from './fixture';

test('ISOLATION-temporary-servers: scenarios use distinct temporary repositories and ports', async () => {
  const first = await seedScenario();
  const firstRuntime = isolatedRuntimeEvidence(first.id);
  const second = await seedScenario();
  const secondRuntime = isolatedRuntimeEvidence(second.id);

  expect(firstRuntime.root.startsWith(path.join(tmpdir(), 'hexdeck-e2e-'))).toBe(true);
  expect(secondRuntime.root.startsWith(path.join(tmpdir(), 'hexdeck-e2e-'))).toBe(true);
  expect(firstRuntime.root).not.toBe(secondRuntime.root);
  expect(firstRuntime.baseURL).not.toBe(secondRuntime.baseURL);
  await expect(fetch(`${firstRuntime.baseURL}/api/health`)).rejects.toThrow();
  expect((await fetch(`${secondRuntime.baseURL}/api/health`)).ok).toBe(true);
  expect((await loadSaved(first.id, 0)).id).toBe(first.id);
  expect((await loadSaved(second.id, 0)).id).toBe(second.id);
});
