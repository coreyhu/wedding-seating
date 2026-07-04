// E2E regression suite (23 checks): guest search/highlight/toast-retry/eggs/layout, host login/assign/swap/unseat/table-rename/matrix-import, pinyin-bridge.
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
check('guest: banner shows bilingual table', /Table 1|1号桌/.test(bannerText), bannerText.trim().slice(0, 60));
const highlighted = await page.locator('svg .highlight').count();
check('guest: exactly one chair highlighted', highlighted === 1, `got ${highlighted}`);

await page.fill('#q', '刘');
await page.waitForFunction(() => !document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('刘艾瑞'), null, { timeout: 5000 });
check('guest: single CJK char auto-selects 刘艾瑞', true);
await page.fill('#q', 'zzzz');
await page.waitForSelector('.empty', { timeout: 5000 });
const empty = await page.textContent('.empty');
check('guest: no-match shows bilingual help', /welcome table|迎宾台/.test(empty));

// network failure -> toast -> retry
await ctx.route('**/rest/v1/rpc/search_guests**', r => r.abort());
await page.fill('#q', 'carol');
await page.waitForSelector('.toast', { timeout: 5000 });
check('guest: network failure shows toast', /Connection trouble|网络异常/.test(await page.textContent('.toast')));
await ctx.unroute('**/rest/v1/rpc/search_guests**');
await page.click('.toast button');
await page.waitForFunction(() => !document.querySelector('#banner').hidden && document.querySelector('#banner').textContent.includes('Carol'), null, { timeout: 5000 });
check('guest: toast retry recovers results', true);
const staleToast = await page.locator('.toast').count();
check('guest: stale toast dismissed after success', staleToast === 0, `got ${staleToast}`);

await page.fill('#q', 'eric');
await page.waitForSelector('.card');
await page.locator('.card').first().click();
await page.waitForSelector('.petal', { timeout: 3000 });
check('eggs: petals fall when a seat is found', true);

await page.fill('#q', 'Corey Hu');
await page.waitForSelector('.sweetheart-card:not([hidden])', { timeout: 4000 });
check('eggs: sweetheart celebration on exact couple name',
  /found us|找到/.test(await page.textContent('.sweetheart-card')));

// ---------- LOCALIZATION ----------
const zhCtx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
const zhPage = await zhCtx.newPage();
await zhPage.goto(BASE + '/');
check('i18n: zh-CN browser lands on Chinese', (await zhPage.getAttribute('#q', 'placeholder')).includes('姓名'));
await zhPage.click('#lang-toggle');
check('i18n: toggle switches to English live', (await zhPage.getAttribute('#q', 'placeholder')).includes('Your name'));
await zhCtx.close();

const mapBox = await page.locator('#map').boundingBox();
const vp = page.viewportSize();
check('layout: map fills the viewport', mapBox.width >= vp.width - 2 && mapBox.height >= vp.height - 2);

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

// rename table 1 (it has seeded guests, so the guest banner can be checked)
await page.locator('svg [id="table-1-shape"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.locator('#panel input').first().fill('Fern');
await page.locator('#panel input').nth(1).fill('蕨');
await page.locator('#panel button', { hasText: 'Save' }).click();
await page.waitForFunction(() =>
  [...document.querySelectorAll('.table-label')].some(t => t.textContent === 'Fern'), null, { timeout: 5000 });
check('tables: rename renders on host map', true);

// guest banner shows the custom name only (name-only display rule)
const guestPage2 = await ctx.newPage();
await guestPage2.goto(BASE + '/');
await guestPage2.fill('#q', 'carol zhao');
await guestPage2.waitForSelector('#banner:not([hidden])', { timeout: 5000 });
const bannerTxt = await guestPage2.textContent('#banner');
check('tables: guest banner shows custom name, no number', /Fern/.test(bannerTxt) && !/Table 1/.test(bannerTxt));
await guestPage2.close();

// restore defaults (also exercises empty-restores-default)
await page.locator('svg [id="table-1-shape"]').click({ force: true });
await page.waitForSelector('#panel:not([hidden])');
await page.locator('#panel input').first().fill('');
await page.locator('#panel input').nth(1).fill('');
await page.locator('#panel button', { hasText: 'Save' }).click();
await page.waitForFunction(() =>
  ![...document.querySelectorAll('.table-label')].some(t => t.textContent === 'Fern'), null, { timeout: 5000 });

// ---------- MATRIX IMPORT + PINYIN BRIDGE (last: mutates seating to a seed superset) ----------
const MATRIX = ['Table 1 / 1号桌,Table 2 / 2号桌,Table 3 / 3号桌,Table 4 / 4号桌,Table 5 / 5号桌,Table 6 / 6号桌,Table 7 / 7号桌,Table 8 / 8号桌,Table 9 / 9号桌,Table 10 / 10号桌,Table 11 / 11号桌,Table 12 / 12号桌',
  'Carol Zhao / 赵卡罗,Victoria Li / 李维多,/ 王奶奶,Xiang Ping Hu,,,,,,,,',
  'Kevin Hu / 胡凯文,Eric Liu / 刘艾瑞,,,,,,,,,,',
  'Eric Dang / 邓艾瑞,,,,,,,,,,,',
  'James Dang / 邓杰姆斯,,,,,,,,,,,'].join('\n');
await page.click('#import-box summary');
await page.fill('#csv', MATRIX);
await page.waitForSelector('#csv-go:not([disabled])');
await page.click('#csv-go');
await page.waitForSelector('.toast', { timeout: 8000 });
check('import: matrix toast reports 8 seats imported', /Imported 8 seats/.test(await page.textContent('.toast')));

const bridgePage = await ctx.newPage();
await bridgePage.goto(BASE + '/');
await bridgePage.fill('#q', '胡向平');
await bridgePage.waitForSelector('#banner:not([hidden])', { timeout: 8000 });
check('bridge: 汉字 search finds pinyin-only guest', /Xiang Ping Hu/.test(await bridgePage.textContent('#banner')));
await bridgePage.close();

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
process.exit(failed.length ? 1 : 0);
