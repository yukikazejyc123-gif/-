const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {before, after, test} = require('node:test');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const C = require('../app/src/main/assets/ledger-core.js');

// Every amount, note and ledger here is fictional. Device data is never read.
const TODAY = '2026-10-01';
const ASSETS = path.resolve(__dirname, '../app/src/main/assets');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
const ALLOWED_ASSET = /^(?:index\.html|icons\.js|ledger-core\.js|ledger-ui\.js|ledger-en\.js|bootstrap\.js|ledger\.css|images\/[a-z-]+\.png|fonts\/[a-z-]+\.woff2)$/;
const LANGUAGES = ['zh', 'ja', 'ko', 'en'];
let browser, server, baseUrl;

function record(id, amount, date, category = '交通', type = 'expense', currency = 'JPY', rate = '1') {
  return C.withValuations({id, amount, date, category, type, currency, rate,
    convertedAmount: C.convertAmount(amount, currency, 'JPY', rate),
    note: `Fixture entry ${id}`}, 'JPY');
}

function fixture(language = 'zh', foreign = false) {
  const data = C.empty('JPY');
  data.transactions = [
    record(1, 1000, TODAY),
    foreign ? record(2, 1000, '2026-10-02', '交通', 'expense', 'USD', '130') : record(2, 1300, '2026-10-02'),
    record(3, 500, '2026-10-31', '餐饮'),
    record(4, 50000, '2026-10-02', '工资', 'income'),
    record(5, 9000, '2026-09-30'),
    record(6, 9100, '2026-11-01')
  ];
  if (foreign) data.transactions[1].valuations.CNY = {rate: '5', convertedAmount: 5000};
  data.nextId = 7;
  data.exchangeRates.USD = {rate: '150', date: '2026-09-30', updatedAt: 1790812800000};
  C.setBudget(data, '2026-10', '交通', 5000);
  C.setBudget(data, '2026-10', '餐饮', 1000);
  C.setBudget(data, '2026-10', '购物', 500);
  C.setBudget(data, '2026-09', '交通', 10000);
  C.setBudget(data, '2026-11', '交通', 15000);
  const collection = C.normalizeCollection(data);
  collection.preferences.language = language;
  const second = C.createBook(collection, 'Fixture second ledger');
  second.data.transactions = [record(1, 777, '2026-10-02')];
  second.data.nextId = 2;
  C.setBudget(second.data, '2026-10', '交通', 2000);
  collection.activeBookId = 'default';
  return C.normalizeCollection(collection);
}

function longFixture(language) {
  const collection = fixture(language, true);
  const data = C.activeBook(collection).data;
  for (let id = 7; id <= 18; id++) data.transactions.push(record(id, C.MAX_AMOUNT, '2026-10-02'));
  data.nextId = 19;
  C.setBudget(data, '2026-10', '交通', C.MAX_AMOUNT);
  Object.assign(data.categories.find(category => category.id === '交通'), {
    nameZh: '很长的交通分类名称'.repeat(4),
    nameJa: '長い交通カテゴリの名前'.repeat(3),
    nameKo: '아주 긴 교통 분류 이름 '.repeat(2),
    nameEn: 'A very long transport category name'
  });
  return C.normalizeCollection(collection);
}

function action(page, name) {return page.locator(`[data-action="${name}"]`).first();}
function day(page, date) {return page.locator(`.ll-calendar-grid [data-select-day="${date}"]`);}
async function saved(page) {return page.evaluate(() => JSON.parse(LedgerNative.readData()));}
async function writes(page) {return page.evaluate(() => window.featureTest.writes);}
function active(collection) {return collection.books.find(book => book.id === collection.activeBookId).data;}

async function open(data = fixture(), width = 412, height = 915) {
  const context = await browser.newContext({viewport: {width, height}});
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({data, today}) => {
    let raw = JSON.stringify(data);
    let restoreSnapshot = null;
    window.featureTest = {writes: 0, rates: [], failWrites: false};
    window.LedgerNative = {
      readData: () => raw,
      today: () => today,
      writeData: value => {
        if (window.featureTest.failWrites) return false;
        raw = value; window.featureTest.writes++; return true;
      },
      restoreData: value => {restoreSnapshot = raw; raw = value; return true;},
      hasRestoreSnapshot: () => restoreSnapshot !== null,
      undoRestore: () => {raw = restoreSnapshot; restoreSnapshot = null; return raw;},
      requestExchangeRate: (currency, base, id) => window.featureTest.rates.push({currency, base, id}),
      exportDocument: () => {},
      requestImport: () => {}
    };
  }, {data, today: TODAY});
  await page.goto(baseUrl);
  await page.locator('[data-screen="home"]').waitFor();
  assert.equal(await page.evaluate(() => ledgerStorage.failedToLoad), false, 'the fictional native fixture must load');
  await page.evaluate(() => document.fonts.ready);
  return {page, async close() {
    await context.close();
    assert.deepEqual(errors, [], 'the exercised feature should not throw JavaScript errors');
  }};
}

async function calendar(page) {
  await action(page, 'calendar').click();
  await page.locator('[data-screen="calendar"]').waitFor();
}

async function budget(page, category = '交通') {
  await action(page, 'budgets').click();
  await page.locator(`[data-budget-category="${category}"]`).click();
  await page.locator('[data-screen="budget-details"]').waitFor();
}

async function budgetValues(page, limit, spent, remaining, currency = 'JPY') {
  for (const [key, expected] of Object.entries({limit, spent, remaining})) {
    const element = page.locator(`[data-budget-value="${key}"]`);
    assert.equal(await element.count(), 1, `the budget detail must expose one ${key} amount`);
    assert.equal(await element.getAttribute('data-minor'), String(expected), `${key} should match exact base-currency minor units`);
    const text = (await element.innerText()).replace(/[,\s−-]/g, '');
    const formatted = C.formatAmount(Math.abs(expected), currency).replace(/[,\s]/g, '');
    assert.ok(text.includes(formatted), `${key} must also render the correct visible amount`);
  }
}

async function detailIds(page) {
  return page.locator('[data-detail]').evaluateAll(elements => elements.map(element => Number(element.dataset.detail)).sort((a, b) => a - b));
}

async function keys(page, values) {
  for (const value of values) await page.locator(`[data-key="${value}"]`).click();
}

async function assertAdjacentComposer(page) {
  assert.equal(await page.locator('.ll-entry-composer > .ll-amount-box + .ll-keypad').count(), 1,
    'the amount and calculator should form one adjacent composer');
  const bounds = await page.locator('.ll-entry-composer').evaluate(element => {
    const amount = element.querySelector('.ll-amount-box').getBoundingClientRect();
    const keypad = element.querySelector('.ll-keypad').getBoundingClientRect();
    const categories = document.querySelector('.ll-categories').getBoundingClientRect();
    return {gap: keypad.top - amount.bottom, keypadBottom: keypad.bottom, categoriesTop: categories.top};
  });
  assert.ok(bounds.gap >= -1 && bounds.gap <= 20, `amount/keypad separation should stay small: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.categoriesTop >= bounds.keypadBottom - 1, 'category/date fields must not split the amount from its keypad');
}

async function assertNoOverflow(page, label) {
  await page.locator('.ll-phone').evaluate(element => Promise.all(element.getAnimations({subtree: true})
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  const dimensions = await page.evaluate(() => {
    const targets = ['.ll-phone', 'main', '.ll-calendar', '.ll-calendar-grid', '.ll-entry-composer', '.ll-budget-summary'];
    return {
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      targets: targets.map(selector => {
        const element = document.querySelector(selector);
        return element && {selector, client: element.clientWidth, scroll: element.scrollWidth};
      }).filter(Boolean)
    };
  });
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label}: document must fit: ${JSON.stringify(dimensions)}`);
  for (const target of dimensions.targets) assert.ok(target.scroll <= target.client + 1,
    `${label}: ${target.selector} must not overflow: ${JSON.stringify(target)}`);
}

async function optionalScreenshot(page, name) {
  if (!process.env.FEATURE_TEST_SCREENSHOTS) return;
  fs.mkdirSync(process.env.FEATURE_TEST_SCREENSHOTS, {recursive: true});
  await page.screenshot({path: path.join(process.env.FEATURE_TEST_SCREENSHOTS, `${name}.png`), fullPage: true});
}

before(async () => {
  server = http.createServer((request, response) => {
    let name;
    try {name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';}
    catch {response.writeHead(400); response.end(); return;}
    if (!ALLOWED_ASSET.test(name)) {response.writeHead(404); response.end(); return;}
    const file = path.join(ASSETS, name);
    if (!fs.existsSync(file)) {response.writeHead(404); response.end(); return;}
    const type = name.endsWith('.js') ? 'application/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.png') ? 'image/png' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8';
    response.writeHead(200, {'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff'});
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const options = {headless: true};
  if (process.env.BROWSER_EXECUTABLE) options.executablePath = process.env.BROWSER_EXECUTABLE;
  browser = await chromium.launch(options);
});

after(async () => {
  if (browser) await browser.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('home starts with today\'s entries while the overview and compact budget cards still include the full month', async () => {
  const session = await open(fixture('zh', true));
  const {page} = session;
  try {
    const before = await saved(page);
    assert.equal(await page.locator(`[data-select-day="${TODAY}"]`).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await detailIds(page), [1], 'the initial list should focus on today rather than mixing future entries');
    assert.match(await page.locator('.ll-day-filter').innerText(), /2026年10月1日/);
    const totals = async () => Promise.all(['expense', 'income', 'balance'].map(async type =>
      Number(await page.locator(`[data-${type}-total]`).getAttribute(`data-${type}-total`))));
    assert.deepEqual(await totals(), [2800, 50000, 47200], 'monthly totals must include future entries, fixed conversions and income');
    assert.equal(await page.locator('.ll-week-strip [data-select-day="2026-10-02"]').getAttribute('data-day-expense'), '1300',
      'the weekly date strip should also show fixed-rate expense totals, excluding income');
    assert.equal(await page.locator('.ll-week-strip [data-select-day="2026-09-30"]').getAttribute('data-day-expense'), '9000',
      'a visible neighboring-month date may show its own spending without adding it to this month\'s overview');
    assert.deepEqual(await page.locator('[data-budget-category="交通"] .ll-home-budget-values strong').allTextContents(),
      ['5,000', '2,300', '2,700'], 'the compact budget must expose the limit, whole-month spending and remaining amount');
    await action(page, 'all-month').click();
    assert.deepEqual(await detailIds(page), [1, 2, 3, 4], 'the explicit whole-month action should still reveal every record in this month');
    assert.deepEqual(await totals(), [2800, 50000, 47200]);
    await action(page, 'today').click();
    assert.deepEqual(await detailIds(page), [1]);
    assert.deepEqual(await saved(page), before);
    assert.equal(await writes(page), 0, 'home filtering must never write or recalculate saved transactions');
  } finally {await session.close();}
});

test('prominent home calendar opens the full month; future-day selection, Today and all twelve annual months remain reachable without writing data', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    const calendarEntry = page.locator('.ll-calendar-open[data-action="calendar"]');
    assert.equal(await calendarEntry.count(), 1, 'home should provide a direct month-calendar action');
    await calendarEntry.click();
    await page.locator('[data-screen="calendar"]').waitFor();
    assert.equal(await page.locator('.ll-calendar-grid [data-select-day]').count(), 31);
    await day(page, '2026-10-31').click();
    await page.locator('[data-screen="home"]').waitFor();
    assert.deepEqual(await detailIds(page), [3]);
    assert.equal(await page.locator('[data-select-day="2026-10-31"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-expense-total]').getAttribute('data-expense-total'), '2800',
      'the calendar filters daily entries without turning the monthly overview into a daily total');
    await action(page, 'today').click();
    assert.deepEqual(await detailIds(page), [1]);
    await page.locator('.ll-year-open[data-action="year"]').click();
    await page.locator('[data-screen="year"]').waitFor();
    assert.deepEqual(await page.locator('.ll-year-list [data-view-month]').evaluateAll(elements => elements.map(element => element.dataset.viewMonth)),
      Array.from({length: 12}, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`));
    assert.equal(await page.locator('[data-expense-total]').getAttribute('data-expense-total'), '20900');
    assert.equal(await page.locator('[data-income-total]').getAttribute('data-income-total'), '50000');
    const october = page.locator('.ll-year-list [data-view-month="2026-10"]');
    assert.match(await october.locator('.ll-month-totals').innerText(), /2,800/);
    assert.match(await october.locator('.ll-month-totals').innerText(), /50,000/);
    await page.locator('.ll-year-list [data-view-month="2026-09"]').click();
    await page.locator('[data-screen="home"]').waitFor();
    assert.deepEqual(await detailIds(page), [5], 'an annual month must open that month\'s entries');
    await action(page, 'today').click();
    assert.deepEqual(await detailIds(page), [1]);
    assert.deepEqual(await saved(page), before);
    assert.equal(await writes(page), 0, 'calendar and annual navigation must preserve every ledger and valuation');
  } finally {await session.close();}
});

test('entry composer keeps amount beside its calculator; arithmetic, delete and continuous saves retain the selected date', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await page.locator('[data-select-day="2026-10-02"]').click();
    await action(page, 'add').click();
    await assertAdjacentComposer(page);
    await keys(page, ['1', '0', '0', '0', '+', '3', '0', '0', '-', '1', '0', '0', '=']);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '1200');
    await keys(page, ['backspace', '5']);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '1205');
    await page.locator('[data-category="交通"]').click();
    await page.locator('[name="note"]').fill('Fixture first save');
    await action(page, 'save-next').click();
    await page.locator('[data-screen="add"]').waitFor();
    assert.equal(await page.locator('[name="amount"]').inputValue(), '');
    assert.equal(await page.locator('[name="note"]').inputValue(), '');
    assert.equal(await page.locator('[name="entry-date"]').inputValue(), '2026-10-02');
    await keys(page, ['4', '8', '0']);
    await page.locator('[name="note"]').fill('Fixture second save');
    await action(page, 'save-record').click();
    await page.locator('[data-screen="home"]').waitFor();
    const after = await saved(page);
    assert.deepEqual(active(after).transactions.slice(0, 6), active(before).transactions, 'existing entries and valuations must remain unchanged');
    const created = active(after).transactions.slice(6);
    assert.deepEqual(created.map(item => [item.amount, item.convertedAmount, item.date, item.category]),
      [[1205, 1205, '2026-10-02', '交通'], [480, 480, '2026-10-02', '交通']]);
    assert.deepEqual(after.books[1], before.books[1], 'continuous saves must not write another ledger');
    assert.equal(await writes(page), 2);
  } finally {await session.close();}
});

test('foreign-currency composer saves the original decimal amount and manual rate; save-next keeps both currency and date', async () => {
  const session = await open();
  const {page} = session;
  try {
    await action(page, 'add').click();
    await action(page, 'pick-entry-currency').click();
    await page.locator('[data-pick-currency="USD"]').click();
    await assertAdjacentComposer(page);
    await page.locator('[name="exchange-rate"]').fill('150');
    await keys(page, ['1', '2', '.', '3', '4', '+', '1', '.', '6', '6', '=']);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '14.00');
    await action(page, 'save-next').click();
    assert.match(await action(page, 'pick-entry-currency').innerText(), /USD/);
    assert.equal(await page.locator('[name="entry-date"]').inputValue(), TODAY);
    await keys(page, ['1', '.', '2', '5']);
    await action(page, 'save-record').click();
    const created = active(await saved(page)).transactions.slice(6);
    assert.deepEqual(created.map(item => [item.amount, item.currency, item.rate, item.convertedAmount]),
      [[1400, 'USD', '150', 2100], [125, 'USD', '150', 188]], 'conversion must use decimal minor units and established rounding');
    assert.deepEqual(created[0].valuations.JPY, {rate: '150', convertedAmount: 2100});
    assert.equal(await writes(page), 2);
  } finally {await session.close();}
});

test('entry composer clear and failed saving do not create or lose existing transactions', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await action(page, 'add').click();
    await keys(page, ['5', '0', '0', 'clear']);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '');
    await action(page, 'save-record').click();
    assert.equal(await page.locator('[data-screen="add"]').count(), 1);
    assert.equal(await writes(page), 0, 'an empty amount must not save');
    await keys(page, ['9', '9']);
    await page.evaluate(() => {window.featureTest.failWrites = true;});
    await action(page, 'save-record').click();
    assert.equal(await page.locator('[data-screen="add"]').count(), 1);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '99', 'a failed save must retain the entered amount for retry');
    assert.deepEqual(await saved(page), before, 'failed storage writes must leave the entire collection untouched');
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('month calendar shows every day, exact fixed-rate expense totals, future spending and empty days without income or other ledgers', async () => {
  const session = await open(fixture('zh', true));
  const {page} = session;
  try {
    const before = await saved(page);
    await calendar(page);
    assert.equal(await page.locator('.ll-calendar-grid [data-select-day]').count(), 31);
    for (const [date, expected] of [['2026-10-01', 1000], ['2026-10-02', 1300], ['2026-10-03', 0], ['2026-10-31', 500]]) {
      assert.equal(await day(page, date).getAttribute('data-day-expense'), String(expected));
      assert.equal(await day(page, date).locator('.ll-day-number').innerText(), String(Number(date.slice(-2))));
      const visible = await day(page, date).locator('.ll-day-expense').innerText();
      assert.ok(visible.length > 0, 'each real day must show an amount or a clear empty-day mark');
      const label = await day(page, date).getAttribute('aria-label');
      assert.ok(label.includes(C.formatAmount(expected, 'JPY')), 'the accessible label must include the full amount');
      assert.match(label, /JPY/, 'the calendar amount must identify the current base currency');
    }
    assert.equal(await page.locator('.ll-calendar-grid [data-select-day="2026-09-30"]').count(), 0);
    await day(page, '2026-10-31').click();
    await page.locator('[data-screen="home"]').waitFor();
    assert.deepEqual(await detailIds(page), [3], 'tapping a future calendar day must filter home to that exact day');
    await action(page, 'add').click();
    assert.equal(await page.locator('[name="entry-date"]').inputValue(), '2026-10-31');
    await action(page, 'back').click();
    await action(page, 'today').click();
    assert.deepEqual(await detailIds(page), [1], 'Today must return to the controlled Tokyo date');
    assert.deepEqual(await saved(page), before);
    assert.equal(await writes(page), 0, 'calendar viewing and date navigation must not write ledger data');
  } finally {await session.close();}
});

test('calendar month arrows and month picker keep day totals scoped to the displayed month', async () => {
  const session = await open();
  const {page} = session;
  try {
    await calendar(page);
    await page.locator('[data-move-month="-1"]').click();
    assert.equal(await page.locator('[data-screen="calendar"]').count(), 1);
    assert.equal(await page.locator('.ll-calendar-grid [data-select-day]').count(), 30);
    assert.equal(await day(page, '2026-09-30').getAttribute('data-day-expense'), '9000');
    await action(page, 'months').click();
    await page.locator('[data-view-month="2026-11"]').click();
    assert.equal(await page.locator('[data-screen="calendar"]').count(), 1, 'choosing a month should return to the calendar');
    assert.equal(await day(page, '2026-11-01').getAttribute('data-day-expense'), '9100');
    assert.equal(await day(page, '2026-11-02').getAttribute('data-day-expense'), '0');
    await action(page, 'today').click();
    await page.locator('[data-screen="home"]').waitFor();
    assert.deepEqual(await detailIds(page), [1]);
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('calendar follows leap-year length and makes a day with only income visibly zero expense', async () => {
  const data = fixture();
  active(data).transactions.push(record(7, 99, '2024-02-29', '工资', 'income'));
  active(data).nextId = 8;
  const session = await open(C.normalizeCollection(data));
  const {page} = session;
  try {
    await calendar(page);
    await action(page, 'months').click();
    await page.locator('[name="view-year"]').fill('2024');
    await page.locator('[name="view-year"]').dispatchEvent('change');
    await page.locator('[data-view-month="2024-02"]').click();
    assert.equal(await page.locator('.ll-calendar-grid [data-select-day]').count(), 29);
    assert.equal(await day(page, '2024-02-29').getAttribute('data-day-expense'), '0');
    await day(page, '2024-02-29').click();
    assert.deepEqual(await detailIds(page), [7], 'zero expense must not hide that day\'s income entry');
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('transport budget opens spent-entry details with the user example: 5000 limit, 2300 spent and 2700 remaining', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await budget(page);
    await budgetValues(page, 5000, 2300, 2700);
    assert.deepEqual(await detailIds(page), [1, 2], 'only this month\'s transport expenses should appear');
    assert.equal(await page.locator('[data-detail="2"] .ll-item-value').innerText(), '−1,300');
    assert.equal(await writes(page), 0, 'opening a budget must not alter it');
    assert.deepEqual(await saved(page), before);
    await page.locator('[data-detail="1"]').click();
    await page.locator('[data-screen="detail"]').waitFor();
    assert.match(await page.locator('.ll-detail-money').innerText(), /1,000/);
    await action(page, 'back').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 5000, 2300, 2700);
  } finally {await session.close();}
});

test('budget details use saved converted amounts, while entry editing retains original currency and valuation history', async () => {
  const session = await open(fixture('zh', true));
  const {page} = session;
  try {
    const before = await saved(page);
    const original = active(before).transactions.find(item => item.id === 2);
    await budget(page);
    await budgetValues(page, 5000, 2300, 2700);
    const row = page.locator('[data-detail="2"]');
    assert.match(await row.locator('small').innerText(), /USD.*JPY.*1,300/, 'the detail row should disclose original and base currencies');
    await row.click();
    await action(page, 'edit').click();
    await assertAdjacentComposer(page);
    assert.equal(await page.locator('[name="amount"]').inputValue(), '10.00');
    assert.equal(await page.locator('[name="exchange-rate"]').inputValue(), '130', 'latest cached rate must not replace the recorded rate');
    await page.locator('[name="note"]').fill('Fixture edited note');
    await action(page, 'save-record').click();
    const updated = active(await saved(page)).transactions.find(item => item.id === 2);
    assert.deepEqual(updated, {...original, note: 'Fixture edited note'}, 'editing a note must retain every original amount and historical valuation');
    if (await page.locator('[data-screen="detail"]').count()) await action(page, 'back').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 5000, 2300, 2700);
    assert.equal(await page.locator('[data-detail="2"] .ll-item-text strong').innerText(), 'Fixture edited note');
    assert.deepEqual((await saved(page)).books[1], before.books[1]);
    assert.equal(await writes(page), 1);
  } finally {await session.close();}
});

test('deleting a transaction from budget details returns there and recalculates only the affected ledger', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await budget(page);
    await page.locator('[data-detail="2"]').click();
    await action(page, 'delete').click();
    await page.locator('.ll-modal').waitFor();
    await action(page, 'close-modal').click();
    assert.deepEqual(await saved(page), before, 'cancelled deletion must preserve all data');
    await action(page, 'delete').click();
    await action(page, 'confirm-delete').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 5000, 1000, 4000);
    assert.deepEqual(await detailIds(page), [1]);
    const after = await saved(page);
    assert.deepEqual(active(after).transactions, active(before).transactions.filter(item => item.id !== 2));
    assert.deepEqual(active(after).budgets, active(before).budgets, 'deleting an entry must not change budget limits');
    assert.deepEqual(after.books[1], before.books[1]);
    assert.equal(await writes(page), 1);
  } finally {await session.close();}
});

test('adjusting a budget from its details preserves entries and returns to the same category and month', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await budget(page);
    await action(page, 'edit-budget').click();
    await page.locator('[data-screen="budget-edit"]').waitFor();
    assert.equal(await page.locator('[name="budget"]').inputValue(), '5000');
    await page.locator('[name="budget"]').fill('6000');
    await action(page, 'back').click();
    await budgetValues(page, 5000, 2300, 2700);
    assert.deepEqual(await saved(page), before, 'cancelled budget adjustment must not save');
    await action(page, 'edit-budget').click();
    await page.locator('[name="budget"]').fill('6000');
    await action(page, 'save-budget').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 6000, 2300, 3700);
    const after = await saved(page);
    assert.deepEqual(active(after).transactions, active(before).transactions);
    assert.deepEqual(active(after).budgets['2026-09'], active(before).budgets['2026-09']);
    assert.deepEqual(active(after).budgets['2026-11'], active(before).budgets['2026-11']);
    assert.deepEqual(after.books[1], before.books[1]);
    assert.equal(await writes(page), 1);
  } finally {await session.close();}
});

test('budget detail month navigation preserves the category and never mixes neighboring months', async () => {
  const session = await open();
  const {page} = session;
  try {
    await budget(page);
    await page.locator('[data-move-month="-1"]').click();
    await budgetValues(page, 10000, 9000, 1000);
    assert.deepEqual(await detailIds(page), [5]);
    await action(page, 'months').click();
    await page.locator('[data-view-month="2026-11"]').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 15000, 9100, 5900);
    assert.deepEqual(await detailIds(page), [6]);
    await action(page, 'back').click();
    await page.locator('[data-screen="budgets"]').waitFor();
    assert.match(await page.locator('.ll-month-picker').innerText(), /11/);
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('hidden categories, empty expense lists and overspent budgets retain accurate existing budget details', async () => {
  const data = fixture();
  active(data).categories.find(category => category.id === '交通').archived = true;
  C.setBudget(active(data), '2026-10', '交通', 2000);
  const session = await open(C.normalizeCollection(data));
  const {page} = session;
  try {
    const before = await saved(page);
    await budget(page);
    await budgetValues(page, 2000, 2300, -300);
    assert.deepEqual(await detailIds(page), [1, 2], 'archiving a category must not erase its existing spending');
    await action(page, 'edit-budget').click();
    await action(page, 'pick-budget-category').click();
    assert.equal(await page.locator('[data-pick-budget-category="交通"]').count(), 1,
      'a hidden category must remain available when adjusting its existing budget');
    await page.keyboard.press('Escape');
    await action(page, 'back').click();
    await action(page, 'back').click();
    await page.locator('[data-budget-category="购物"]').click();
    await budgetValues(page, 500, 0, 500);
    assert.deepEqual(await detailIds(page), []);
    assert.equal(await page.locator('.ll-empty').count(), 1);
    assert.equal(await action(page, 'edit-budget').count(), 1, 'an empty budget should still be adjustable');
    assert.deepEqual(await saved(page), before);
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('switching ledgers isolates both calendar daily totals and budget expense details', async () => {
  const session = await open();
  const {page} = session;
  try {
    const before = await saved(page);
    await action(page, 'books').click();
    await page.locator('[data-switch-book="book-1"]').click();
    await calendar(page);
    assert.equal(await day(page, '2026-10-01').getAttribute('data-day-expense'), '0');
    assert.equal(await day(page, '2026-10-02').getAttribute('data-day-expense'), '777');
    await action(page, 'back').click();
    await budget(page);
    await budgetValues(page, 2000, 777, 1223);
    assert.deepEqual(await detailIds(page), [1]);
    assert.equal(await page.locator('[data-detail="1"] .ll-item-value').innerText(), '−777');
    const after = await saved(page);
    assert.equal(after.activeBookId, 'book-1');
    assert.deepEqual(after.books, before.books, 'viewing another ledger must not merge or modify either ledger');
    assert.equal(await writes(page), 1, 'only the active-ledger preference should be saved');
  } finally {await session.close();}
});

test('calendar and budget details reflect a different main currency without discarding original amounts or retained valuations', async () => {
  const collection = fixture('en', true);
  collection.books[0].data = C.rebaseCurrency(collection.books[0].data, 'CNY', {JPY: {rate: '0.05'}});
  const session = await open(C.normalizeCollection(collection));
  const {page} = session;
  try {
    const before = await saved(page);
    await calendar(page);
    for (const date of ['2026-10-01', '2026-10-02']) {
      assert.equal(await day(page, date).getAttribute('data-day-expense'), '5000');
      assert.match(await day(page, date).getAttribute('aria-label'), /CNY 50\.00/);
    }
    await action(page, 'back').click();
    await budget(page);
    await budgetValues(page, 25000, 10000, 15000, 'CNY');
    const row = page.locator('[data-detail="2"]');
    assert.match(await row.locator('.ll-item-value').innerText(), /10\.00/);
    assert.match(await row.locator('small').innerText(), /USD.*CNY.*50\.00/);
    assert.deepEqual(await saved(page), before, 'viewing rebased data must preserve both historical base-currency snapshots');
    assert.equal(await writes(page), 0);
  } finally {await session.close();}
});

test('a category month without a budget still shows existing expenses and allows setting its own limit', async () => {
  const data = fixture();
  active(data).transactions.push(record(7, 600, '2026-12-10'));
  active(data).nextId = 8;
  const session = await open(C.normalizeCollection(data));
  const {page} = session;
  try {
    const before = await saved(page);
    await budget(page);
    await action(page, 'months').click();
    await page.locator('[data-view-month="2026-12"]').click();
    assert.equal(await page.locator('[data-budget-value="limit"]').getAttribute('data-minor'), '');
    assert.equal(await page.locator('[data-budget-value="spent"]').getAttribute('data-minor'), '600');
    assert.equal(await page.locator('[data-budget-value="remaining"]').getAttribute('data-minor'), '');
    assert.deepEqual(await detailIds(page), [7]);
    await action(page, 'edit-budget').click();
    assert.equal(await page.locator('[name="budget"]').inputValue(), '');
    await page.locator('[name="budget"]').fill('2000');
    await action(page, 'save-budget').click();
    await page.locator('[data-screen="budget-details"]').waitFor();
    await budgetValues(page, 2000, 600, 1400);
    const after = await saved(page);
    assert.deepEqual(active(after).transactions, active(before).transactions);
    assert.deepEqual(active(after).budgets['2026-10'], active(before).budgets['2026-10']);
    assert.deepEqual(after.books[1], before.books[1]);
    assert.equal(await writes(page), 1);
  } finally {await session.close();}
});

for (const language of LANGUAGES) {
  for (const width of [320, 360, 412]) {
    test(`${language} at ${width}px: composer, daily calendar and budget details fit long base amounts and category names`, async () => {
      const session = await open(longFixture(language), width, 740);
      const {page} = session;
      try {
        const before = await saved(page);
        await assertNoOverflow(page, 'home');
        await calendar(page);
        await assertNoOverflow(page, 'month calendar');
        const expected = 1300 + 12 * C.MAX_AMOUNT;
        assert.equal(await day(page, '2026-10-02').getAttribute('data-day-expense'), String(expected));
        assert.ok((await day(page, '2026-10-02').getAttribute('aria-label')).includes(C.formatAmount(expected, 'JPY')),
          'compact visible totals must retain the full amount in the accessible label');
        const overflow = await page.locator('.ll-calendar-grid [data-select-day]').evaluateAll(elements => elements.filter(element => {
          const amount = element.querySelector('.ll-day-expense');
          const parentBounds = element.getBoundingClientRect(), bounds = amount.getBoundingClientRect();
          return bounds.left < parentBounds.left - 1 || bounds.right > parentBounds.right + 1 || amount.scrollWidth > amount.clientWidth + 1;
        }).map(element => element.dataset.selectDay));
        assert.deepEqual(overflow, [], 'daily labels must remain contained in their seven-column cells');
        if (language === 'zh' && width === 412) await optionalScreenshot(page, 'month-calendar');
        await action(page, 'back').click();
        await action(page, 'add').click();
        await keys(page, String(C.MAX_AMOUNT).split(''));
        await assertAdjacentComposer(page);
        await assertNoOverflow(page, 'amount composer');
        if (language === 'zh' && width === 412) await optionalScreenshot(page, 'entry-composer');
        await action(page, 'back').click();
        await budget(page);
        await assertNoOverflow(page, 'budget details');
        assert.deepEqual(await detailIds(page), [1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
        if (language === 'zh' && width === 412) await optionalScreenshot(page, 'budget-details');
        assert.deepEqual(await saved(page), before, 'layout inspection must not change ledger data');
        assert.equal(await writes(page), 0);
      } finally {await session.close();}
    });
  }
}
