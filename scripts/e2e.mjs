// E2E regression suite (14 checks): guest search/highlight/toast-retry, host login/assign/swap/unseat.
// Prereqs: local Supabase running + seeded (supabase db reset), host@test.dev in admins,
// dev server on 5199: `npx vite --port 5199 --strictPort` — then `npm run e2e`.
// Host-page mutations are reverted at the end; safe against the seed data.
// End-to-end verification against the live dev server + local Supabase.
// Read-only where possible; host-page mutations are reverted at the end.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone-ish
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

// ---------- GUEST PAGE ----------
await page.goto(BASE + '/');
await page.fill('#q', 'eric');
await page.waitForSelector('.card', { timeout: 5000 });
const cards = await page.locator('.card').count();
check('guest: "eric" shows 2 cards', cards === 2, `got ${cards}`);

await page.locator('.card').first().click();
await page.waitForSelector('#banner:not([hidden])', { timeout: 3000 });
const bannerText = await page.textContent('#banner');
check('guest: banner shows bilingual table', /号桌/.test(bannerText), bannerText.trim().slice(0, 60));
const highlighted = await page.locator('svg .highlight').count();
check('guest: exactly one chair highlighted', highlighted === 1, `got ${highlighted}`);

await page.fill('#q', '刘');
await page.waitForFunction(() => !document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('刘艾瑞'), null, { timeout: 5000 });
check('guest: single CJK char auto-selects 刘艾瑞', true);
await page.fill('#q', 'zzzz');
await page.waitForSelector('.empty', { timeout: 5000 });
const empty = await page.textContent('.empty');
check('guest: no-match shows bilingual help', /迎宾台/.test(empty));

// network failure -> toast -> retry
await ctx.route('**/rest/v1/rpc/search_guests**', r => r.abort());
await page.fill('#q', 'carol');
await page.waitForSelector('.toast', { timeout: 5000 });
check('guest: network failure shows toast', /网络异常/.test(await page.textContent('.toast')));
await ctx.unroute('**/rest/v1/rpc/search_guests**');
await page.click('.toast button');
await page.waitForFunction(() => !document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('Carol'), null, { timeout: 5000 });
check('guest: toast retry recovers results', true);
const staleToast = await page.locator('.toast').count();
check('guest: stale toast dismissed after success', staleToast === 0, `got ${staleToast}`);

// ---------- HOST PAGE ----------
await page.goto(BASE + '/host.html');
await page.fill('input[name=email]', 'host@test.dev');
await page.fill('input[name=password]', 'password123');
await Promise.all([page.waitForNavigation(), page.click('.login button')]);
await page.waitForSelector('#map svg', { timeout: 8000 });
check('host: login lands on map', true);

const occupiedBefore = await page.locator('svg .seat.occupied').count();
const labels = await page.locator('svg .seat-label').count();
check('host: occupied chairs color-coded with labels', occupiedBefore >= 6 && labels === occupiedBefore, `occupied=${occupiedBefore} labels=${labels}`);
const unseatedBefore = Number(await page.textContent('#unseated-count'));

// assign: click empty seat 5-1 -> pick first unseated guest
await page.locator('svg [id="seat-5-1"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.waitForSelector('#pick-list .card');
const pickName = (await page.textContent('#pick-list .card')).trim();
await page.locator('#pick-list .card').first().click();
await page.waitForFunction(sel => document.querySelector(sel)?.classList.contains('occupied'), 'svg [id="seat-5-1"]', { timeout: 5000 });
const unseatedAfterAssign = Number(await page.textContent('#unseated-count'));
check('host: assign to empty seat works', unseatedAfterAssign === unseatedBefore - 1, `${pickName} → 5-1; unseated ${unseatedBefore}→${unseatedAfterAssign}`);

// swap: move occupant of 1-1 onto occupied 1-2
const label11 = await page.evaluate(() => {
  const map = {}; document.querySelectorAll('.seat-label').forEach(t => { map[t.getAttribute('x') + ',' + t.getAttribute('y')] = t.textContent; });
  return JSON.stringify(map);
});
await page.locator('svg [id="seat-1-1"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.click('#move');
await page.waitForSelector('body.picking');
check('host: move enters picking mode', true);
await page.locator('svg [id="seat-1-2"]').click({ force: true });
await page.waitForFunction(() => !document.body.classList.contains('picking'), null, { timeout: 5000 });
await page.waitForTimeout(600); // refresh round-trip
const label11After = await page.evaluate(() => {
  const map = {}; document.querySelectorAll('.seat-label').forEach(t => { map[t.getAttribute('x') + ',' + t.getAttribute('y')] = t.textContent; });
  return JSON.stringify(map);
});
check('host: swap re-rendered labels', label11 !== label11After, 'label positions changed');

// revert: swap back, then unseat the assigned guest
await page.locator('svg [id="seat-1-1"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])'); await page.click('#move');
await page.locator('svg [id="seat-1-2"]').click({ force: true });
await page.waitForFunction(() => !document.body.classList.contains('picking'));
await page.waitForTimeout(600);
await page.locator('svg [id="seat-5-1"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.click('#unseat');
await page.waitForFunction(sel => !document.querySelector(sel)?.classList.contains('occupied'), 'svg [id="seat-5-1"]', { timeout: 5000 });
const unseatedFinal = Number(await page.textContent('#unseated-count'));
check('host: unseat restores state', unseatedFinal === unseatedBefore, `unseated back to ${unseatedFinal}`);

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
process.exit(failed.length ? 1 : 0);
