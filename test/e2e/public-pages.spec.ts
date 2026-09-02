import { test, expect } from './fixture';

test('public routes show the approved landing page, durable content, and working navigation', async ({ page, baseUrl }) => {
  const origin = new URL(baseUrl).origin;
  const apiRequests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: 'Build your battle plan. Fight.' })).toBeVisible();
    await expect(page.getByText('Deckfront combines Dominion-style static market deckbuilding with tactical combat. Build the right deck, play combos, and take the other fighter to 0 health.')).toBeVisible();
    await expect(page.locator('[data-landing-card]')).toHaveCount(4);
    expect(await page.locator('[data-landing-card]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-landing-card')))).toEqual(['Rally', 'Sharpen', 'Starfire', 'Longshot']);
    expect(await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth - innerWidth, vertical: document.documentElement.scrollHeight - innerHeight }))).toEqual({ horizontal: 0, vertical: 0 });
  }

  const learnNav = page.getByRole('navigation', { name: 'Learn about Deckfront' });
  const linksNav = page.getByRole('navigation', { name: 'Deckfront links' });
  await expect(learnNav.getByRole('link')).toHaveText(['Rules', 'About']);
  await expect(linksNav.getByRole('link')).toHaveText(['GitHub', 'Discord', 'Play game']);
  await expect(linksNav.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/ryanbbrown/Deckfront');
  await expect(linksNav.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', 'https://discord.gg/B4dYUH7vj');
  await expect(page.getByRole('link', { name: 'Play Deckfront' })).toHaveAttribute('href', '/play');
  await expect(page.getByRole('link', { name: 'Read the rules' })).toHaveAttribute('href', '/rules');
  expect(apiRequests).toEqual([]);

  await page.goto(`${origin}/rules`);
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your turn' })).toBeVisible();
  await expect(page.getByText('7 Copper and 3 Scrap')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional local starting draft' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shared market' })).toBeVisible();

  await page.goto(`${origin}/about`);
  await expect(page.getByRole('heading', { name: 'Deck-building meets tactical combat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Initial public playtest' })).toBeVisible();
  await expect(page.getByText('sitewide aggregate results for each difficulty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI and balance' })).toBeVisible();
  const coming = page.getByRole('heading', { name: 'What is coming' }).locator('..'); await expect(coming).toBeVisible();
  await expect(coming).toContainText('Player accounts and profiles.'); await expect(coming).not.toContainText('public statistics');
  await expect(page.getByRole('link', { name: 'Deckfront home' })).toHaveAttribute('href', '/');
  expect(apiRequests).toEqual([]);

  await page.goto(baseUrl);
  await expect(page.getByText('Set up a match')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deckfront home' })).toHaveAttribute('href', '/');
  expect(apiRequests.some((url) => new URL(url).pathname === '/api/setup')).toBe(true);
});
