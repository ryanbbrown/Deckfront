import { expect, loadSaved, openScenario, seedScenario, test } from './fixture';

test('AI-immediate-point: the AI takes every available point before buy', async ({ page }) => {
  const { id } = await seedScenario({
    activePlayerId: 'indigo', aiCards: ['shove'],
    positions: {
      'indigo-a': { q: 2, r: 0 }, 'indigo-b': { q: -2, r: 2 },
      'ochre-a': { q: 3, r: 0 }, 'ochre-b': { q: 0, r: -2 }
    }
  });
  await openScenario(page, id, 'AI is choosing its turn');
  await expect(page.getByText('Your respawn phase')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Score')).toContainText('1 AI');
  await expect(page.getByText(/AI scored 1 point/)).toBeVisible();
  const saved = await loadSaved(id);
  expect(saved.state.scores.indigo).toBe(1);
  expect(saved.state.pieces['ochre-a'].position).toBeNull();
  expect(saved.aiTurns.at(-1)?.summary).toContain('AI scored 1 point');
});
