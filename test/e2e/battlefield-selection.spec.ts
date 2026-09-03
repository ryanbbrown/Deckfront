import type { Page } from '@playwright/test';
import type { SetupCatalog } from '../../src/shared/api';
import { test, expect } from './fixture';

async function setupCatalog(baseUrl: string): Promise<SetupCatalog> {
  const response = await fetch(new URL('/api/setup', baseUrl));
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<SetupCatalog>;
}

function playUrl(baseUrl: string, path: string): string { return new URL(path, baseUrl).href; }

async function expectSetupFits(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector<HTMLElement>('.table-shell')!.getBoundingClientRect();
    const rail = document.querySelector<HTMLElement>('.setup-rail')!;
    return {
      pageOverflow: { horizontal: root.scrollWidth - innerWidth, vertical: root.scrollHeight - innerHeight },
      shellInside: shell.left >= 0 && shell.top >= 0 && shell.right <= innerWidth + 1 && shell.bottom <= innerHeight + 1,
      railHorizontalOverflow: rail.scrollWidth - rail.clientWidth
    };
  });
  expect(layout).toEqual({ pageOverflow: { horizontal: 0, vertical: 0 }, shellInside: true, railHorizontalOverflow: 0 });
}

test('DD-E2E-076: bare play resumes numbered and unnumbered games without a temporary battlefield URL', async ({ page, baseUrl, openGame }) => {
  const catalog = await setupCatalog(baseUrl);
  const battlefield40 = catalog.battlefields.find((battlefield) => battlefield.number === 40)!;
  await page.addInitScript(() => {
    const original = history.replaceState.bind(history);
    const state = window as typeof window & { replacedPlayUrls?: string[] };
    state.replacedPlayUrls = [];
    history.replaceState = (data, unused, url) => {
      if (url !== undefined) state.replacedPlayUrls!.push(String(url));
      original(data, unused, url);
    };
  });

  await openGame(page, undefined, battlefield40.variableCardIds);
  await expect(page).toHaveURL(/\/play\/40$/u);
  await expect(page.getByRole('heading', { name: 'Battlefield 40' })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { replacedPlayUrls?: string[] }).replacedPlayUrls)).toEqual(['/play/40']);

  await page.goto(playUrl(baseUrl, '/play/'));
  await expect(page).toHaveURL(/\/play\/40$/u);
  await expect(page.getByRole('heading', { name: 'Battlefield 40' })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { replacedPlayUrls?: string[] }).replacedPlayUrls)).toEqual(['/play/40']);

  await openGame(page);
  await expect(page).toHaveURL(/\/play$/u);
  await expect(page.getByRole('heading', { name: 'Battlefield piles' })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { replacedPlayUrls?: string[] }).replacedPlayUrls)).toEqual([]);
});

test('DD-E2E-077: an explicit battlefield keeps a different saved game until successful replacement', async ({ page, baseUrl, openGame }) => {
  const catalog = await setupCatalog(baseUrl);
  const battlefield40 = catalog.battlefields.find((battlefield) => battlefield.number === 40)!;
  const active = await openGame(page, undefined, battlefield40.variableCardIds);

  await page.goto(playUrl(baseUrl, '/play/60'));
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Battlefield 60' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(active.id);

  await page.goto(baseUrl);
  await expect(page).toHaveURL(/\/play\/40$/u);
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();

  await page.goto(playUrl(baseUrl, '/play/60'));
  await page.route('**/api/games', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Creation failed.' }) }));
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('alert')).toHaveText('Creation failed.');
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(active.id);
  await page.unroute('**/api/games');

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();
  const replacementId = await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'));
  expect(replacementId).not.toBe(active.id);
  await expect(page).toHaveURL(/\/play\/60$/u);
  await page.goto(baseUrl);
  await expect(page).toHaveURL(/\/play\/60$/u);
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(replacementId);
});

test('DD-E2E-078: malformed and fallback routes recover with the required saved-game behavior', async ({ page, baseUrl, openGame }) => {
  const catalog = await setupCatalog(baseUrl);
  const battlefield40 = catalog.battlefields.find((battlefield) => battlefield.number === 40)!;
  const active = await openGame(page, undefined, battlefield40.variableCardIds);

  await page.goto(playUrl(baseUrl, '/play/not-a-number?source=shared#market'));
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Battlefield number must be from 1 to 160.');
  await expect(page).toHaveURL(/\/play\/\d+\?source=shared#market$/u);
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBe(active.id);

  const selector = page.getByLabel('Go to battlefield');
  await selector.fill('40');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(selector).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Battlefield 40' })).toBeVisible();
  await expect(page).toHaveURL(/\/play\/40\?source=shared#market$/u);

  await page.goto(playUrl(baseUrl, '/play/040/?source=shared#market'));
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();
  await expect(page).toHaveURL(/\/play\/40\?source=shared#market$/u);

  await page.goto(playUrl(baseUrl, '/unrelated/path?source=fallback#active'));
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/\/play\/40\?source=fallback#active$/u);

  await page.evaluate(() => localStorage.removeItem('hexdeck.activeGameId'));
  await page.goto(playUrl(baseUrl, '/unrelated/path?source=fallback#setup'));
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/\/play\/\d+\?source=fallback#setup$/u);
});

test('DD-E2E-079: the battlefield selector validates, refreshes, replaces history, and fits supported desktops', async ({ page, baseUrl }) => {
  await page.goto(playUrl(baseUrl, '/'));
  await page.goto(playUrl(baseUrl, '/play/1?source=selector#setup'));
  const selector = page.getByLabel('Go to battlefield');
  await expect(selector).toHaveValue('');
  await expect(page.getByText('Enter a number from 1 to 160.')).toBeVisible();
  const firstMarket = await page.locator('.pile-grid--kingdom [data-market-card]').allTextContents();
  const firstUrl = page.url();

  await selector.fill('0');
  await page.getByRole('button', { name: 'Load' }).click();
  await expect(selector).toHaveAttribute('aria-invalid', 'true');
  await expect(selector).toHaveAttribute('aria-describedby', 'battlefield-number-error');
  await expect(page.getByRole('alert')).toHaveText('Enter a battlefield number from 1 to 160.');
  expect(await page.locator('.pile-grid--kingdom [data-market-card]').allTextContents()).toEqual(firstMarket);
  expect(page.url()).toBe(firstUrl);

  await selector.fill('002');
  await selector.press('Enter');
  await expect(selector).toHaveValue('');
  await expect(selector).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('heading', { name: 'Battlefield 2' })).toBeVisible();
  await expect(page).toHaveURL(/\/play\/2\?source=selector#setup$/u);

  await selector.fill('9');
  await page.getByRole('button', { name: 'Refresh market' }).click();
  await expect(selector).toHaveValue('');
  const refreshedNumber = /\/play\/(\d+)/u.exec(new URL(page.url()).pathname)?.[1];
  expect(refreshedNumber).toBeTruthy();
  await expect(page.getByRole('heading', { name: `Battlefield ${refreshedNumber}` })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/play/${refreshedNumber}\\?source=selector#setup$`, 'u'));

  const refreshedUrl = page.url();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole('link', { name: 'Play Deckfront' })).toBeVisible();
  await page.goto(refreshedUrl);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport);
    await expectSetupFits(page);
  }

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Battlefield ${refreshedNumber}` })).toBeVisible();
});

test('DD-E2E-080: New game keeps its numbered battlefield and reload stays in setup', async ({ page, baseUrl, openGame }) => {
  const catalog = await setupCatalog(baseUrl);
  const battlefield40 = catalog.battlefields.find((battlefield) => battlefield.number === 40)!;
  await openGame(page, undefined, battlefield40.variableCardIds);
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Battlefield 40' })).toBeVisible();
  await expect(page).toHaveURL(/\/play\/40$/u);
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBeNull();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Battlefield 40' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hexdeck.activeGameId'))).toBeNull();
});
