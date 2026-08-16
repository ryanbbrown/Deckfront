import { test, expect } from './fixture';

test('LIVE-BROWSER-001: real AI independently builds and completes a full first turn in the browser', async ({ page, baseUrl }) => {
  await page.goto(baseUrl); await page.getByLabel('AI strategy').selectOption('close-pressure');
  await page.getByLabel('Strategy instructions').fill('# Close pressure\nChoose Footwork, Feint, and Drive. Play useful Actions, then end both phases.');
  await page.getByText('AI', { exact: true }).click(); await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByLabel('Add Aim').click(); await page.getByLabel('Add Volley').click(); await page.getByRole('button', { name: 'Finish starting build' }).click();
  await expect(page.getByText(/Turn 2 · your action/)).toBeVisible(); await expect(page.getByText('Starting builds')).toBeVisible(); await expect(page.getByText('AI:', { exact: true })).toBeVisible();
});
