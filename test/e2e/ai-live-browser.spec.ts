import { expect, loadSaved, openScenario, seedScenario, test } from './fixture';

test('AI-LIVE-browser-smoke: configured ThinHarness completes a visible browser handoff', async ({ page }) => {
  const { id } = await seedScenario({
    activePlayerId: 'indigo', aiCards: ['copper'],
    positions: {
      'ochre-a': { q: -2, r: 0 }, 'ochre-b': { q: -2, r: 2 },
      'indigo-a': { q: 2, r: 0 }, 'indigo-b': { q: 2, r: -2 }
    }
  });
  await openScenario(page, id, 'AI is choosing its turn');
  await expect(page.getByText('Your action phase')).toBeVisible();
  const saved = await loadSaved(id);
  const moved = (['indigo-a', 'indigo-b'] as const).some((pieceId) =>
    JSON.stringify(saved.state.pieces[pieceId].position) !== JSON.stringify(saved.initialState.pieces[pieceId].position)
  );
  expect(moved).toBe(true);
  expect(saved.aiTurns.at(-1)?.summary).toMatch(/baseline move|played/);
});
