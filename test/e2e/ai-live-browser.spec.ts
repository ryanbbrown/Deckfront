import { expect, test } from './fixture';

test('LIVE-AI-ALTERNATING: real cproxy completes several alternating action steps', async ({ page, openGame, repository }) => {
  test.skip(process.env.HEXDECK_E2E_LIVE !== '1', 'Run through playwright.live.config.ts.');
  const record = await openGame(page);
  for (let step = 0; step < 2; step += 1) {
    const actor = page.getByLabel(/Your piece [AB], legal actor/).first();
    await expect(actor).toBeVisible();
    await actor.click();
    await page.getByLabel(/Hex .* legal destination/).first().click();
    await page.getByRole('button', { name: 'Confirm action' }).click();
    await expect.poll(async () => (await repository.load(record.id)).aiActions.length, { timeout: 260_000 }).toBe(step + 1);
    await expect(page.getByText(/your action/)).toBeVisible({ timeout: 260_000 });
  }
  const saved = await repository.load(record.id);
  expect(saved.aiActions).toHaveLength(2);
  expect(saved.aiActions.every((action) => action.actionId.startsWith('v'))).toBe(true);
  expect(saved.committedCommands).toHaveLength(4);
});
