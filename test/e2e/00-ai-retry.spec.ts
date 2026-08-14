import { expect, loadSaved, openScenario, seedScenario, test } from './fixture';

test('AI-browser-retry: the UI recovers from one AI process error', async ({ page }) => {
  const { id } = await seedScenario({ cards: [], aiCards: ['copper'], aiFailureMode: 'process' });
  await openScenario(page, id);
  await finishHumanTurn(page);
  await expect(page.getByText('AI turn stopped')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Synthetic one-time AI process failure');
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
  const saved = await loadSaved(id, 3);
  expect(saved.aiTurns).toHaveLength(1);
  expect(saved.state.activePlayerId).toBe('ochre');
  expect(aiBoardChanged(saved)).toBe(true);
});

test('AI-browser-rejected-plan-retry: the UI recovers from one server-rejected AI plan', async ({ page }) => {
  const { id } = await seedScenario({ cards: [], aiCards: ['copper'], aiFailureMode: 'rejected-plan' });
  await openScenario(page, id);
  await finishHumanTurn(page);
  await expect(page.getByText('AI turn stopped')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('AI must take a legal board action before entering the buy phase');
  const rejected = await loadSaved(id, 2);
  expect(rejected.aiTurns).toEqual([]);
  expect(rejected.state.activePlayerId).toBe('indigo');
  await page.getByRole('button', { name: 'Retry AI turn' }).click();
  await expect(page.getByText('Your action phase')).toBeVisible({ timeout: 15_000 });
  const saved = await loadSaved(id, 3);
  expect(saved.aiTurns).toHaveLength(1);
  expect(saved.state.activePlayerId).toBe('ochre');
  expect(aiBoardChanged(saved)).toBe(true);
});

async function finishHumanTurn(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Enter buy phase' }).click();
  await page.getByRole('button', { name: 'End turn' }).click();
}

function aiBoardChanged(saved: Awaited<ReturnType<typeof loadSaved>>): boolean {
  return (['indigo-a', 'indigo-b'] as const).some((pieceId) =>
    JSON.stringify(saved.state.pieces[pieceId].position) !== JSON.stringify(saved.initialState.pieces[pieceId].position)
  );
}
