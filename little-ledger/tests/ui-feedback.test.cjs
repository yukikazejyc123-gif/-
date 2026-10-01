const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {before, after, test} = require('node:test');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const C = require('../app/src/main/assets/ledger-core.js');

// Test fixtures are fictional. Nothing here reads device or personal ledger data.
const TODAY = '2026-10-01';
const ASSETS = path.resolve(__dirname, '../app/src/main/assets');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
const ALLOWED_ASSET = /^(?:index\.html|icons\.js|ledger-core\.js|ledger-ui\.js|ledger-en\.js|bootstrap\.js|ledger\.css|images\/[a-z-]+\.png|fonts\/[a-z-]+\.woff2)$/;
const LANGUAGE_CASES = [
  {language: 'zh', input: 'category-zh', custom: '测试分类', updated: '修改后分类', food: '餐饮', shopping: '购物', hidden: '已隐藏'},
  {language: 'ja', input: 'category-ja', custom: 'テスト分類', updated: '更新した分類', food: '食費', shopping: '買い物', hidden: '非表示'},
  {language: 'ko', input: 'category-ko', custom: '테스트 분류', updated: '수정한 분류', food: '식비', shopping: '쇼핑', hidden: '숨김'},
  {language: 'en', input: 'category-en', custom: 'Test category', updated: 'Updated category', food: 'Food', shopping: 'Shopping', hidden: 'Hidden'}
];
let browser, server, baseUrl;

function fixture(language = 'zh') {
  const data = C.empty('JPY');
  data.transactions = [
    C.withValuations({id: 1, type: 'expense', category: '餐饮', amount: 980, currency: 'JPY', rate: '1', convertedAmount: 980, date: TODAY, note: 'Fixture lunch'}, 'JPY'),
    C.withValuations({id: 2, type: 'income', category: '工资', amount: 1000, currency: 'USD', rate: '150', convertedAmount: 1500, rateDate: '2026-09-30', date: '2026-09-30', note: 'Fixture income'}, 'JPY')
  ];
  data.nextId = 3;
  C.setBudget(data, '2026-10', '餐饮', 30000);
  data.exchangeRates.USD = {rate: '150', date: '2026-09-30', updatedAt: 1790812800000};
  data.categories.find(category => category.id === '购物').archived = true;
  data.categories.push({id: 'custom-feedback', type: 'expense', nameZh: '测试分类', nameJa: 'テスト分類', nameKo: '테스트 분류', nameEn: 'Test category', icon: 'flower-2', color: 'peach', archived: false});
  const collection = C.normalizeCollection(C.normalize(data));
  collection.preferences.language = language;
  C.createBook(collection, 'Fixture trip');
  C.createBook(collection, 'Fixture gifts');
  collection.activeBookId = 'default';
  return C.normalizeCollection(collection);
}

function action(page, name) {
  return page.locator(`[data-action="${name}"]`).first();
}

function categoryRow(page, id) {
  return page.locator(`[data-edit-category="${id}"]`);
}

async function readSaved(page) {
  return page.evaluate(() => JSON.parse(LedgerNative.readData()));
}

async function savedWrites(page) {
  return page.evaluate(() => window.feedbackTest.writes);
}

async function open(language = 'zh', width = 412, height = 915, data = fixture(language)) {
  const context = await browser.newContext({viewport: {width, height}});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(({data, today}) => {
    let raw = JSON.stringify(data);
    let restoreSnapshot = null;
    window.feedbackTest = {writes: 0, rates: [], exports: [], imports: 0};
    window.LedgerNative = {
      readData: () => raw,
      today: () => today,
      writeData: value => {raw = value; window.feedbackTest.writes++; return true;},
      restoreData: value => {restoreSnapshot = raw; raw = value; window.feedbackTest.writes++; return true;},
      hasRestoreSnapshot: () => restoreSnapshot !== null,
      undoRestore: () => {
        if (restoreSnapshot === null) throw new Error('No restore snapshot');
        raw = restoreSnapshot;
        restoreSnapshot = null;
        return raw;
      },
      exportDocument: (kind, payload) => window.feedbackTest.exports.push({kind, payload}),
      requestImport: () => {window.feedbackTest.imports++;},
      requestExchangeRate: (currency, base, id) => window.feedbackTest.rates.push({currency, base, id})
    };
  }, {data, today: TODAY});
  await page.goto(baseUrl);
  await page.locator('[data-screen="home"]').waitFor();
  assert.equal(await page.evaluate(() => ledgerStorage.failedToLoad), false, 'fixture should load through the native adapter');
  await page.evaluate(() => document.fonts.ready);
  return {
    page,
    async close() {
      await context.close();
      assert.deepEqual(pageErrors, [], 'the exercised UI should not throw JavaScript errors');
    }
  };
}

async function categories(page) {
  await action(page, 'settings').click();
  await action(page, 'manage-categories').click();
  await page.locator('[data-screen="categories"]').waitFor();
}

async function settleAnimations(page) {
  // Wait for finite page/sheet transitions without hanging on a mascot loop.
  await page.locator('.ll-phone').evaluate(element => Promise.all(
    element.getAnimations({subtree: true})
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))
  ));
}

async function assertNoHorizontalOverflow(page, label) {
  await settleAnimations(page);
  const result = await page.evaluate(() => {
    const phone = document.querySelector('.ll-phone');
    const main = document.querySelector('main');
    const options = document.querySelector('.ll-picker-options');
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      phone: {client: phone.clientWidth, scroll: phone.scrollWidth},
      main: {client: main.clientWidth, scroll: main.scrollWidth},
      options: options && {client: options.clientWidth, scroll: options.scrollWidth}
    };
  });
  assert.ok(result.document <= result.viewport + 1, `${label}: document overflow ${JSON.stringify(result)}`);
  for (const target of ['phone', 'main', 'options']) {
    if (result[target]) assert.ok(result[target].scroll <= result[target].client + 1, `${label}: ${target} overflow ${JSON.stringify(result)}`);
  }
}

async function assertSheetContained(page, label) {
  const sheet = page.locator('.ll-picker');
  await sheet.waitFor();
  await assertNoHorizontalOverflow(page, label);
  const bounds = await sheet.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, `${label}: sheet must fit horizontally`);
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1, `${label}: sheet must fit vertically`);
  const scroll = await page.locator('.ll-picker-options').evaluate(element => ({
    overflowing: element.scrollHeight > element.clientHeight,
    overscroll: getComputedStyle(element).overscrollBehaviorY
  }));
  assert.equal(scroll.overflowing, true, `${label}: long option lists should scroll inside the sheet`);
  assert.ok(['contain', 'none'].includes(scroll.overscroll), `${label}: option scrolling should stay inside the sheet`);
  await page.locator('.ll-picker-option').last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.ll-picker-option').last().isVisible(), true, `${label}: final option should remain reachable`);
}

before(async () => {
  server = http.createServer((request, response) => {
    let name;
    try {name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';}
    catch {response.writeHead(400); response.end(); return;}
    if (!ALLOWED_ASSET.test(name)) {response.writeHead(404); response.end(); return;}
    const file = path.join(ASSETS, name);
    if (!fs.existsSync(file)) {response.writeHead(404); response.end(); return;}
    const contentType = name.endsWith('.js') ? 'application/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.png') ? 'image/png' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8';
    response.writeHead(200, {'Content-Type': contentType, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff'});
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const options = {headless: true};
  if (process.env.BROWSER_EXECUTABLE) options.executablePath = process.env.BROWSER_EXECUTABLE;
  browser = await chromium.launch(options);
});

after(async () => {
  if (browser) await browser.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

for (const languageCase of LANGUAGE_CASES) {
  test(`${languageCase.language}: category lists show only the selected name and localized hidden state`, async () => {
    const session = await open(languageCase.language);
    const {page} = session;
    try {
      const before = await readSaved(page);
      await categories(page);
      assert.equal(await categoryRow(page, '餐饮').locator('strong').innerText(), languageCase.food);
      assert.equal(await categoryRow(page, '购物').locator('strong').innerText(), languageCase.shopping);
      assert.equal(await categoryRow(page, 'custom-feedback').locator('strong').innerText(), languageCase.custom);
      assert.equal(await categoryRow(page, '餐饮').locator('small').count(), 0, 'normal categories should have no bilingual or empty subtitle');
      assert.equal(await categoryRow(page, 'custom-feedback').locator('small').count(), 0);
      assert.equal(await categoryRow(page, '购物').locator('small').innerText(), languageCase.hidden);
      if (languageCase.language === 'zh') {
        const list = await page.locator('.ll-category-list').innerText();
        for (const unwanted of ['食費', '買い物', '交通費', 'テスト分類']) assert.ok(!list.includes(unwanted), `Chinese category list should not expose ${unwanted}`);
      }
      assert.deepEqual(await readSaved(page), before, 'viewing categories must preserve all ledger data');
      assert.equal(await savedWrites(page), 0);
    } finally {await session.close();}
  });

  test(`${languageCase.language}: live category preview follows the chosen language without saving`, async () => {
    const session = await open(languageCase.language);
    const {page} = session;
    try {
      const before = await readSaved(page);
      await categories(page);
      await categoryRow(page, 'custom-feedback').click();
      const preview = page.locator('.ll-category-preview > span:last-child');
      assert.equal(await preview.innerText(), languageCase.custom);
      const input = page.locator(`[name="${languageCase.input}"]`);
      await input.fill(languageCase.updated);
      assert.equal(await preview.innerText(), languageCase.updated, 'typing should update the visible preview immediately');
      assert.equal(await input.evaluate(element => document.activeElement === element), true, 'live preview updates should keep the input focused');
      if (languageCase.language !== 'zh') {
        await input.fill('');
        assert.equal(await preview.innerText(), '测试分类', 'a blank translation should retain the established base-name fallback');
        await input.fill(languageCase.updated);
      }
      assert.deepEqual(await readSaved(page), before);
      assert.equal(await savedWrites(page), 0, 'draft edits must not save until the user taps Save');
      await action(page, 'back').click();
      assert.equal(await categoryRow(page, 'custom-feedback').locator('strong').innerText(), languageCase.custom, 'cancelled drafts must not change the category list');
      await categoryRow(page, 'custom-feedback').click();
      assert.equal(await input.inputValue(), languageCase.custom, 'reopening the editor should read the unchanged saved name');
      assert.deepEqual(await readSaved(page), before, 'custom names, original currency amounts and rate snapshots must remain unchanged');
      assert.equal(await savedWrites(page), 0);
    } finally {await session.close();}
  });
}

test('home koala reactions and date shortcuts preserve every entry and exchange-rate snapshot', async () => {
  const session = await open('zh');
  const {page} = session;
  try {
    const before = await readSaved(page);
    const totals = await page.locator('[data-expense-total], [data-income-total], [data-balance-total]').allTextContents();
    for (let tap = 0; tap < 3; tap++) {
      await page.locator('[data-action="koala"]').click();
      assert.equal(await page.locator('.ll-koala-reply').innerText(), '＋1元');
      assert.equal(await page.locator('[data-action="koala"]').getAttribute('data-eyes'), 'closed');
      assert.deepEqual(await readSaved(page), before, 'decorative +1 reactions must not change finance data');
      await page.waitForFunction(() => !document.querySelector('[data-action="koala"]').hasAttribute('data-reaction'));
      assert.equal(await page.locator('[data-action="koala"]').getAttribute('data-eyes'), null);
      assert.equal(await page.locator('.ll-koala-reply').innerText(), '');
    }
    assert.deepEqual(await page.locator('[data-expense-total], [data-income-total], [data-balance-total]').allTextContents(), totals);
    await page.locator('[data-select-day="2026-10-02"]').click();
    assert.equal(await page.locator('[data-select-day="2026-10-02"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.ll-day-filter').innerText(), /2026年10月2日/);
    await action(page, 'add').click();
    assert.equal(await page.locator('[name="entry-date"]').inputValue(), '2026-10-02', 'Add entry should use the date tapped on home');
    await action(page, 'back').click();
    await action(page, 'today').click();
    assert.match(await page.locator('.ll-day-filter').innerText(), /2026年10月1日/);
    assert.equal(await page.locator(`[data-select-day="${TODAY}"]`).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await readSaved(page), before);
    assert.equal(await savedWrites(page), 0, 'view navigation and animation should not write the ledger');
  } finally {await session.close();}
});

for (const languageCase of LANGUAGE_CASES) {
  for (const width of [320, 360, 412]) {
    test(`${languageCase.language} at ${width}px: ledger, category and currency screens fit; sheets scroll within their bounds`, async () => {
      const session = await open(languageCase.language, width, 600);
      const {page} = session;
      try {
        const before = await readSaved(page);
        await assertNoHorizontalOverflow(page, 'home');
        await action(page, 'books').click();
        await assertNoHorizontalOverflow(page, 'ledger list');
        assert.equal(await page.locator('[data-switch-book]').count(), 3);
        assert.equal(await page.locator('.ll-book-intro').count(), 0, 'ledger management should not add the removed description card');
        await action(page, 'back').click();
        await action(page, 'settings').click();
        assert.equal(await page.locator('.ll-profile').count(), 0, 'settings should not add the removed slogan card');
        await action(page, 'manage-categories').click();
        await assertNoHorizontalOverflow(page, 'category list');
        await categoryRow(page, 'custom-feedback').click();
        await assertNoHorizontalOverflow(page, 'category editor');
        await action(page, 'back').click();
        await action(page, 'back').click();
        await action(page, 'home').click();
        await action(page, 'add').click();
        assert.equal(await page.locator('select').count(), 0, 'entry currency choices should use the in-app picker');
        await action(page, 'pick-entry-currency').click();
        assert.equal(await page.locator('[data-pick-currency]').count(), C.CURRENCIES.length);
        await assertSheetContained(page, 'currency sheet');
        assert.equal(await page.locator('main').evaluate(element => element.inert), true, 'background content should be inert while a sheet is open');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.ll-picker').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'pick-entry-currency', 'dismissal should restore trigger focus');
        await action(page, 'back').click();
        await action(page, 'budgets').click();
        await action(page, 'budget-new').click();
        await action(page, 'pick-budget-category').click();
        await assertSheetContained(page, 'budget category sheet');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'pick-budget-category');
        assert.deepEqual(await readSaved(page), before, 'layout inspection must not modify names, entries, budgets or rates');
        assert.equal(await savedWrites(page), 0);
      } finally {await session.close();}
    });
  }
}

test('empty pages keep essential actions without the removed encouragement paragraph', async () => {
  const empty = C.emptyCollection();
  const session = await open('zh', 320, 600, empty);
  const {page} = session;
  try {
    assert.equal(await page.locator('.ll-empty').count(), 1);
    assert.equal(await page.locator('.ll-empty p').count(), 0);
    assert.equal(await page.locator('.ll-empty [data-action="add"]').count(), 1, 'the empty state should still offer its useful entry action');
    assert.equal(await savedWrites(page), 0);
  } finally {await session.close();}
});
