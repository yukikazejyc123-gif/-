(function (scope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  scope.LedgerCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_AMOUNT = 999999999, LEGACY_MAX_AMOUNT = 9999999, MAX_TOTAL = 50000000000000;
  const CURRENCIES = ['JPY', 'CNY', 'USD', 'EUR', 'GBP', 'HKD', 'TWD', 'KRW'];
  const CURRENCY_INFO = {
    JPY: {code: 'JPY', digits: 0, symbol: '¥', nameZh: '日元', nameJa: '日本円', nameKo: '일본 엔', nameEn: 'Japanese yen'},
    CNY: {code: 'CNY', digits: 2, symbol: '¥', nameZh: '人民币', nameJa: '人民元', nameKo: '중국 위안', nameEn: 'Chinese yuan'},
    USD: {code: 'USD', digits: 2, symbol: '$', nameZh: '美元', nameJa: '米ドル', nameKo: '미국 달러', nameEn: 'US dollar'},
    EUR: {code: 'EUR', digits: 2, symbol: '€', nameZh: '欧元', nameJa: 'ユーロ', nameKo: '유로', nameEn: 'Euro'},
    GBP: {code: 'GBP', digits: 2, symbol: '£', nameZh: '英镑', nameJa: '英ポンド', nameKo: '영국 파운드', nameEn: 'British pound'},
    HKD: {code: 'HKD', digits: 2, symbol: 'HK$', nameZh: '港币', nameJa: '香港ドル', nameKo: '홍콩 달러', nameEn: 'Hong Kong dollar'},
    TWD: {code: 'TWD', digits: 2, symbol: 'NT$', nameZh: '新台币', nameJa: '台湾ドル', nameKo: '대만 달러', nameEn: 'Taiwan dollar'},
    KRW: {code: 'KRW', digits: 0, symbol: '₩', nameZh: '韩元', nameJa: '韓国ウォン', nameKo: '대한민국 원', nameEn: 'Korean won'}
  };
  const COLORS = ['sage', 'peach', 'sand', 'lilac', 'sky'];
  const ICONS = ['utensils', 'shopping-bag', 'train-front', 'house', 'headphones', 'heart', 'book-open', 'ellipsis', 'wallet', 'gift', 'coffee', 'shopping-cart', 'paw-print', 'plane', 'smartphone', 'shirt', 'leaf', 'briefcase-business', 'bike', 'music', 'cake', 'umbrella', 'coins', 'ticket', 'flower-2'];
  const DEFAULT_CATEGORIES = [
    ['餐饮', 'expense', '餐饮', '食費', 'utensils'], ['购物', 'expense', '购物', '買い物', 'shopping-bag'],
    ['交通', 'expense', '交通', '交通費', 'train-front'], ['居住', 'expense', '居住', '住居費', 'house'],
    ['娱乐', 'expense', '娱乐', '娯楽', 'headphones'], ['健康', 'expense', '健康', '医療・健康', 'heart'],
    ['学习', 'expense', '学习', '学び', 'book-open'], ['其他', 'expense', '其他', 'その他', 'ellipsis'],
    ['工资', 'income', '工资', '給与', 'wallet'], ['其他收入', 'income', '其他收入', 'その他収入', 'gift']
  ].map(([id, type, nameZh, nameJa, icon], index) => ({id, type, nameZh, nameJa, nameKo: ['식비', '쇼핑', '교통', '주거', '여가', '건강', '학습', '기타', '급여', '기타 수입'][index], nameEn: ['Food', 'Shopping', 'Transport', 'Housing', 'Entertainment', 'Health', 'Learning', 'Other', 'Salary', 'Other income'][index], icon, color: 'sage', archived: false}));
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const amountOK = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;
  const convertedOK = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT;
  function currencyInfo(code) {return CURRENCIES.includes(code) ? {...CURRENCY_INFO[code]} : null;}
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }
  function monthLength(month) {
    if (!validDate(month + '-01')) throw new Error('invalid_date');
    const [y, m] = month.split('-').map(Number);
    return [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function moveMonth(month, delta) {
    if (!validDate(month + '-01') || !Number.isInteger(delta)) return month;
    const [year, number] = month.split('-').map(Number);
    const index = (year - 1) * 12 + number - 1 + delta;
    if (index < 0 || index >= 9999 * 12) return month;
    return String(Math.floor(index / 12) + 1).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
  }
  function rateParts(rate) {
    if (typeof rate !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(rate)) return null;
    const [whole, decimals = ''] = rate.split('.');
    const numerator = BigInt(whole + decimals), denominator = 10n ** BigInt(decimals.length);
    return numerator > 0n && numerator <= 100000000n * denominator ? {numerator, denominator} : null;
  }
  const validRate = rate => rateParts(rate) !== null;
  function parseMinor(text, currency, zero) {
    const info = currencyInfo(currency);
    if (!info || typeof text !== 'string') return null;
    const input = text.trim();
    const pattern = info.digits ? new RegExp('^\\d{1,12}(?:\\.\\d{1,' + info.digits + '})?$') : /^\d{1,12}$/;
    if (!pattern.test(input)) return null;
    const [whole, fraction = ''] = input.split('.');
    const value = BigInt(whole) * 10n ** BigInt(info.digits) + BigInt(fraction.padEnd(info.digits, '0') || '0');
    return value <= BigInt(MAX_AMOUNT) && (zero || value > 0n) ? Number(value) : null;
  }
  function parseAmount(text, currency = 'JPY') {return parseMinor(text, currency, false);}
  function decimalAmount(minor, currency = 'JPY') {
    const info = currencyInfo(currency);
    if (!info || !Number.isSafeInteger(minor) || Math.abs(minor) > MAX_TOTAL) return '—';
    const negative = minor < 0 ? '-' : '', raw = String(Math.abs(minor));
    if (!info.digits) return negative + raw;
    const padded = raw.padStart(info.digits + 1, '0');
    return negative + padded.slice(0, -info.digits) + '.' + padded.slice(-info.digits);
  }
  function formatAmount(minor, currency = 'JPY') {
    const decimal = decimalAmount(minor, currency);
    if (decimal === '—') return decimal;
    const [whole, fraction] = decimal.split('.');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
  }
  function formatMoney(minor, currency = 'JPY') {return currencyInfo(currency) ? currency + ' ' + formatAmount(minor, currency) : '—';}
  function convertAmount(minor, source, base, rate) {
    const from = currencyInfo(source), to = currencyInfo(base), parts = rateParts(rate);
    if (!amountOK(minor) || !from || !to || !parts || (source === base && parts.numerator !== parts.denominator)) return null;
    const numerator = BigInt(minor) * parts.numerator * 10n ** BigInt(to.digits);
    const denominator = parts.denominator * 10n ** BigInt(from.digits);
    const rounded = (numerator * 2n + denominator) / (denominator * 2n);
    return rounded <= BigInt(MAX_AMOUNT) ? Number(rounded) : null;
  }
  function recordSnapshot(record, base, snapshot) {
    if (!CURRENCIES.includes(base) || !object(snapshot) || !validRate(snapshot.rate) || !convertedOK(snapshot.convertedAmount) || convertAmount(record.amount, record.currency, base, snapshot.rate) !== snapshot.convertedAmount || (snapshot.rateDate !== undefined && !validDate(snapshot.rateDate))) throw new Error('invalid_record');
    const result = {rate: record.currency === base ? '1' : snapshot.rate, convertedAmount: snapshot.convertedAmount};
    if (snapshot.rateDate !== undefined) result.rateDate = snapshot.rateDate;
    return result;
  }
  function budgetSnapshot(base, snapshot) {
    if (!CURRENCIES.includes(base) || !object(snapshot) || !amountOK(snapshot.amount) || !CURRENCIES.includes(snapshot.sourceCurrency) || !amountOK(snapshot.sourceAmount) || !validRate(snapshot.rate) || convertAmount(snapshot.sourceAmount, snapshot.sourceCurrency, base, snapshot.rate) !== snapshot.amount || (snapshot.rateDate !== undefined && !validDate(snapshot.rateDate))) throw new Error('invalid_budget');
    const result = {amount: snapshot.amount, sourceCurrency: snapshot.sourceCurrency, sourceAmount: snapshot.sourceAmount, rate: snapshot.sourceCurrency === base ? '1' : snapshot.rate};
    if (snapshot.rateDate !== undefined) result.rateDate = snapshot.rateDate;
    return result;
  }
  function withValuations(record, base, prior) {
    if (!object(record) || !CURRENCIES.includes(record.currency) || !amountOK(record.amount)) throw new Error('invalid_record');
    const result = clone(record), current = recordSnapshot(result, base, result);
    const unchanged = object(prior) && prior.currency === result.currency && prior.amount === result.amount && prior.rate === current.rate && prior.convertedAmount === current.convertedAmount && prior.rateDate === current.rateDate;
    const valuations = unchanged && object(prior.valuations) ? clone(prior.valuations) : {};
    valuations[base] = current;
    Object.assign(result, current); result.valuations = valuations;
    if (current.rateDate === undefined) delete result.rateDate;
    return result;
  }
  function normalize(raw) {
    if (!object(raw) || ![1, 2, 3, 4].includes(raw.version) || !CURRENCIES.includes(raw.currency) || (raw.version < 3 && raw.currency !== 'JPY')) throw new Error('unsupported_format');
    if (!Array.isArray(raw.transactions) || raw.transactions.length > 50000 || !object(raw.budgets)) throw new Error('invalid_data');
    if (raw.version >= 2 && !Array.isArray(raw.categories)) throw new Error('invalid_categories');
    const categories = raw.version === 1 ? clone(DEFAULT_CATEGORIES) : clone(raw.categories);
    if (!Array.isArray(categories) || categories.length < 2 || categories.length > 200) throw new Error('invalid_categories');
    const categoryIds = new Set();
    categories.forEach(category => {
      if (!object(category) || typeof category.id !== 'string' || !/^[A-Za-z0-9_\-\u4e00-\u9fff]{1,80}$/.test(category.id) || ['__proto__', 'constructor', 'prototype'].includes(category.id) || categoryIds.has(category.id)) throw new Error('invalid_categories');
      if (!['expense', 'income'].includes(category.type) || typeof category.nameZh !== 'string' || !category.nameZh.trim() || category.nameZh.length > 40 || typeof category.nameJa !== 'string' || category.nameJa.length > 40 || (category.nameKo !== undefined && (typeof category.nameKo !== 'string' || category.nameKo.length > 40)) || (category.nameEn !== undefined && (typeof category.nameEn !== 'string' || category.nameEn.length > 40)) || !ICONS.includes(category.icon) || typeof category.archived !== 'boolean' || (category.color !== undefined && !COLORS.includes(category.color))) throw new Error('invalid_categories');
      category.nameZh = category.nameZh.trim(); category.nameJa = category.nameJa.trim(); category.nameKo = category.nameKo === undefined ? DEFAULT_CATEGORIES.find(item => item.id === category.id)?.nameKo || '' : category.nameKo.trim(); category.nameEn = category.nameEn === undefined ? DEFAULT_CATEGORIES.find(item => item.id === category.id)?.nameEn || '' : category.nameEn.trim(); category.color = category.color || 'sage'; categoryIds.add(category.id);
    });
    for (const type of ['expense', 'income']) if (!categories.some(category => category.type === type && !category.archived)) throw new Error('last_category');
    const map = new Map(categories.map(category => [category.id, category]));
    const ids = new Set();
    const transactions = raw.transactions.map(record => {
      if (!object(record) || !Number.isSafeInteger(record.id) || record.id <= 0 || record.id >= Number.MAX_SAFE_INTEGER || ids.has(record.id) || !amountOK(record.amount) || (raw.version < 3 && record.amount > LEGACY_MAX_AMOUNT) || !validDate(record.date)) throw new Error('invalid_record');
      if (!['expense', 'income'].includes(record.type) || map.get(record.category)?.type !== record.type || typeof record.note !== 'string' || record.note.length > 200) throw new Error('invalid_record');
      let currency = 'JPY', rate = '1', convertedAmount = record.amount;
      if (raw.version >= 3) {
        currency = record.currency; rate = record.rate; convertedAmount = record.convertedAmount;
        if (!CURRENCIES.includes(currency) || !validRate(rate) || !convertedOK(convertedAmount) || convertAmount(record.amount, currency, raw.currency, rate) !== convertedAmount || (record.rateDate !== undefined && !validDate(record.rateDate))) throw new Error('invalid_record');
        if (currency === raw.currency) rate = '1';
      }
      ids.add(record.id);
      const result = {id: record.id, type: record.type, category: record.category, amount: record.amount, currency, rate, convertedAmount, note: record.note, date: record.date};
      if (raw.version >= 3 && record.rateDate !== undefined) result.rateDate = record.rateDate;
      const active = recordSnapshot(result, raw.currency, result);
      result.valuations = {};
      if (raw.version === 4) {
        if (!object(record.valuations) || !Object.prototype.hasOwnProperty.call(record.valuations, raw.currency)) throw new Error('invalid_record');
        for (const [base, snapshot] of Object.entries(record.valuations)) result.valuations[base] = recordSnapshot(result, base, snapshot);
        const snapshot = result.valuations[raw.currency];
        if (snapshot.rate !== active.rate || snapshot.convertedAmount !== active.convertedAmount || snapshot.rateDate !== active.rateDate) throw new Error('invalid_record');
      } else result.valuations[raw.currency] = active;
      return result;
    });
    totals(transactions);
    const budgets = {}, budgetValuations = {};
    if (raw.version === 4 && !object(raw.budgetValuations)) throw new Error('invalid_budget');
    for (const [month, limits] of Object.entries(raw.budgets)) {
      if (!validDate(month + '-01') || !object(limits)) throw new Error('invalid_budget');
      budgets[month] = {}; budgetValuations[month] = {};
      for (const [id, limit] of Object.entries(limits)) {
        if (map.get(id)?.type !== 'expense' || !amountOK(limit) || (raw.version < 3 && limit > LEGACY_MAX_AMOUNT)) throw new Error('invalid_budget');
        budgets[month][id] = limit;
        const valuations = {};
        if (raw.version === 4) {
          const snapshots = raw.budgetValuations[month]?.[id];
          if (!object(snapshots) || !Object.prototype.hasOwnProperty.call(snapshots, raw.currency)) throw new Error('invalid_budget');
          for (const [base, snapshot] of Object.entries(snapshots)) valuations[base] = budgetSnapshot(base, snapshot);
          if (valuations[raw.currency].amount !== limit) throw new Error('invalid_budget');
        } else valuations[raw.currency] = {amount: limit, sourceCurrency: raw.currency, sourceAmount: limit, rate: '1'};
        budgetValuations[month][id] = valuations;
      }
    }
    if (raw.version === 4) for (const [month, entries] of Object.entries(raw.budgetValuations)) {
      if (!Object.prototype.hasOwnProperty.call(budgets, month) || !object(entries) || Object.keys(entries).some(id => !Object.prototype.hasOwnProperty.call(budgets[month], id))) throw new Error('invalid_budget');
    }
    const highestId = transactions.reduce((max, record) => Math.max(max, record.id), 0);
    if (highestId >= Number.MAX_SAFE_INTEGER) throw new Error('invalid_record');
    if (raw.version >= 2 && (!Number.isSafeInteger(raw.nextId) || raw.nextId <= highestId || raw.nextId >= Number.MAX_SAFE_INTEGER)) throw new Error('invalid_record');
    const exchangeRates = {};
    if (raw.version >= 3 && raw.exchangeRates !== undefined) {
      if (!object(raw.exchangeRates)) throw new Error('invalid_rates');
      for (const [currency, quote] of Object.entries(raw.exchangeRates)) {
        if (!CURRENCIES.includes(currency) || !object(quote) || !validRate(quote.rate) || (quote.date !== undefined && !validDate(quote.date)) || (quote.updatedAt !== undefined && (!Number.isSafeInteger(quote.updatedAt) || quote.updatedAt < 0))) throw new Error('invalid_rates');
        const parts = rateParts(quote.rate);
        if (currency === raw.currency && parts.numerator !== parts.denominator) throw new Error('invalid_rates');
        exchangeRates[currency] = {rate: currency === raw.currency ? '1' : quote.rate};
        if (quote.date !== undefined) exchangeRates[currency].date = quote.date;
        if (quote.updatedAt !== undefined) exchangeRates[currency].updatedAt = quote.updatedAt;
      }
    }
    const inputDesign = object(raw.design) ? raw.design : {};
    if (raw.version >= 3 && ((inputDesign.lastCurrency !== undefined && !CURRENCIES.includes(inputDesign.lastCurrency)) || (inputDesign.animations !== undefined && typeof inputDesign.animations !== 'boolean'))) throw new Error('invalid_data');
    const design = {
      palette: ['鼠尾草绿', '桃粉', '淡紫'].includes(inputDesign.palette) ? inputDesign.palette : '鼠尾草绿',
      radius: Number.isFinite(inputDesign.radius) ? Math.min(30, Math.max(12, inputDesign.radius)) : 26,
      mascot: inputDesign.mascot !== false, language: ['zh', 'ja', 'ko', 'en'].includes(inputDesign.language) ? inputDesign.language : 'zh',
      lastExpenseCategory: categories.some(c => c.id === inputDesign.lastExpenseCategory && c.type === 'expense' && !c.archived) ? inputDesign.lastExpenseCategory : categories.find(c => c.type === 'expense' && !c.archived).id,
      lastIncomeCategory: categories.some(c => c.id === inputDesign.lastIncomeCategory && c.type === 'income' && !c.archived) ? inputDesign.lastIncomeCategory : categories.find(c => c.type === 'income' && !c.archived).id,
      lastCurrency: CURRENCIES.includes(inputDesign.lastCurrency) ? inputDesign.lastCurrency : raw.currency,
      animations: inputDesign.animations !== false
    };
    return {version: 4, currency: raw.currency, transactions, categories, budgets, budgetValuations, exchangeRates, design, nextId: raw.version >= 2 ? raw.nextId : highestId + 1};
  }
  function empty(currency = 'JPY') {return normalize({version: 3, currency, transactions: [], categories: clone(DEFAULT_CATEGORIES), budgets: {}, exchangeRates: {}, nextId: 1});}
  function collectionPreferences(design, strict = false) {
    if (!object(design)) throw new Error('invalid_data');
    const languages = ['zh', 'ja', 'ko', 'en'], palettes = ['鼠尾草绿', '桃粉', '淡紫'];
    if (strict && ((design.language !== undefined && !languages.includes(design.language)) || (design.palette !== undefined && !palettes.includes(design.palette)) || (design.radius !== undefined && (!Number.isFinite(design.radius) || design.radius < 12 || design.radius > 30)) || (design.mascot !== undefined && typeof design.mascot !== 'boolean') || (design.animations !== undefined && typeof design.animations !== 'boolean'))) throw new Error('invalid_data');
    return {language: languages.includes(design.language) ? design.language : 'zh', palette: palettes.includes(design.palette) ? design.palette : '鼠尾草绿', radius: Number.isFinite(design.radius) ? Math.min(30, Math.max(12, design.radius)) : 26, mascot: design.mascot !== false, animations: design.animations !== false};
  }
  function bookName(name, id) {
    if (typeof name !== 'string' || name.length > 40 || (!name.trim() && id !== 'default')) throw new Error('invalid_book_name');
    return name.trim();
  }
  function normalizeCollection(raw) {
    if (!object(raw)) throw new Error('unsupported_format');
    if (raw.version !== 5) {
      const data = normalize(raw);
      return {version: 5, activeBookId: 'default', books: [{id: 'default', name: '', data}], preferences: collectionPreferences(data.design)};
    }
    if (!Array.isArray(raw.books) || raw.books.length < 1 || raw.books.length > 50 || !object(raw.preferences) || typeof raw.activeBookId !== 'string') throw new Error('invalid_books');
    const ids = new Set(), names = new Set(); let recordCount = 0;
    const books = raw.books.map(book => {
      if (!object(book) || typeof book.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(book.id) || ['__proto__', 'constructor', 'prototype'].includes(book.id) || ids.has(book.id)) throw new Error('invalid_books');
      const name = bookName(book.name, book.id), nameKey = name.toLowerCase();
      if (names.has(nameKey)) throw new Error('duplicate_book_name');
      const data = normalize(book.data); recordCount += data.transactions.length;
      if (recordCount > 50000) throw new Error('too_many_records');
      ids.add(book.id); names.add(nameKey);
      return {id: book.id, name, data};
    });
    if (!ids.has(raw.activeBookId)) throw new Error('invalid_books');
    return {version: 5, activeBookId: raw.activeBookId, books, preferences: collectionPreferences(raw.preferences, true)};
  }
  function emptyCollection(currency = 'JPY') {return normalizeCollection(empty(currency));}
  function activeBook(collection) {
    if (!object(collection) || collection.version !== 5 || !Array.isArray(collection.books)) throw new Error('invalid_books');
    const book = collection.books.find(item => item.id === collection.activeBookId);
    if (!book) throw new Error('invalid_books');
    return book;
  }
  function checkedNewBookName(collection, name, exceptId) {
    const value = bookName(name, 'new');
    if (collection.books.some(book => book.id !== exceptId && book.name.trim().toLowerCase() === value.toLowerCase())) throw new Error('duplicate_book_name');
    return value;
  }
  function createBook(collection, name) {
    const normalized = normalizeCollection(collection), value = checkedNewBookName(normalized, name);
    if (normalized.books.length >= 50) throw new Error('too_many_books');
    const current = activeBook(normalized).data;
    let index = 1; while (normalized.books.some(book => book.id === 'book-' + index)) index++;
    const data = empty(current.currency);
    data.categories = clone(current.categories);
    data.design = {...data.design, ...normalized.preferences};
    const book = {id: 'book-' + index, name: value, data: normalize(data)};
    collection.books.push(book); collection.activeBookId = book.id;
    return book;
  }
  function renameBook(collection, id, name) {
    const normalized = normalizeCollection(collection), value = checkedNewBookName(normalized, name, id);
    if (!normalized.books.some(book => book.id === id)) throw new Error('invalid_books');
    const book = collection.books.find(book => book.id === id); book.name = value;
    return book;
  }
  function rebasePlan(model, target) {
    if (!CURRENCIES.includes(target)) throw new Error('invalid_currency');
    const data = normalize(model), currencies = new Set();
    let budgetCount = 0;
    if (target !== data.currency) {
      for (const record of data.transactions) if (!record.valuations[target] && record.currency !== target) currencies.add(record.currency);
      for (const [month, limits] of Object.entries(data.budgets)) for (const id of Object.keys(limits)) {
        budgetCount++;
        if (!data.budgetValuations[month][id][target]) currencies.add(data.currency);
      }
    } else budgetCount = Object.values(data.budgets).reduce((count, limits) => count + Object.keys(limits).length, 0);
    return {currencies: [...currencies], transactionCount: data.transactions.length, budgetCount};
  }
  function rebaseCurrency(model, target, quotes) {
    if (!CURRENCIES.includes(target)) throw new Error('invalid_currency');
    const data = normalize(model), previous = data.currency;
    if (previous === target) return data;
    if (!object(quotes)) throw new Error('invalid_rates');
    const rates = {};
    for (const [currency, quote] of Object.entries(quotes)) {
      if (!CURRENCIES.includes(currency) || !object(quote) || !validRate(quote.rate) || (currency === target && rateParts(quote.rate).numerator !== rateParts(quote.rate).denominator) || (quote.date !== undefined && !validDate(quote.date)) || (quote.updatedAt !== undefined && (!Number.isSafeInteger(quote.updatedAt) || quote.updatedAt < 0))) throw new Error('invalid_rates');
      rates[currency] = {rate: currency === target ? '1' : quote.rate};
      if (quote.date !== undefined) rates[currency].date = quote.date;
      if (quote.updatedAt !== undefined) rates[currency].updatedAt = quote.updatedAt;
    }
    rates[target] = rates[target] || {rate: '1'};
    const quoteFor = currency => {
      if (rates[currency]) return rates[currency];
      const error = new Error('missing_rebase_rate'); error.currency = currency; throw error;
    };
    for (const record of data.transactions) {
      if (!record.valuations[target]) {
        const quote = quoteFor(record.currency);
        const snapshot = {rate: quote.rate, convertedAmount: convertAmount(record.amount, record.currency, target, quote.rate)};
        if (quote.date !== undefined) snapshot.rateDate = quote.date;
        record.valuations[target] = recordSnapshot(record, target, snapshot);
      }
      const snapshot = record.valuations[target];
      record.rate = snapshot.rate; record.convertedAmount = snapshot.convertedAmount;
      if (snapshot.rateDate === undefined) delete record.rateDate; else record.rateDate = snapshot.rateDate;
    }
    for (const [month, limits] of Object.entries(data.budgets)) for (const [id, limit] of Object.entries(limits)) {
      const snapshots = data.budgetValuations[month][id];
      if (!snapshots[target]) {
        const quote = quoteFor(previous), amount = convertAmount(limit, previous, target, quote.rate);
        if (amount === 0) {const error = new Error('budget_too_small'); error.month = month; error.category = id; throw error;}
        const snapshot = {amount, sourceCurrency: previous, sourceAmount: limit, rate: quote.rate};
        if (quote.date !== undefined) snapshot.rateDate = quote.date;
        snapshots[target] = budgetSnapshot(target, snapshot);
      }
      limits[id] = snapshots[target].amount;
    }
    data.currency = target; data.exchangeRates = rates;
    return normalize(data);
  }
  function setBudget(model, month, id, amount) {
    if (!object(model) || !CURRENCIES.includes(model.currency) || !validDate(month + '-01') || !model.categories.some(category => category.id === id && category.type === 'expense') || !amountOK(amount) || !object(model.budgets) || !object(model.budgetValuations)) throw new Error('invalid_budget');
    if (model.budgets[month]?.[id] === amount && model.budgetValuations[month]?.[id]?.[model.currency]?.amount === amount) return model;
    model.budgets[month] = model.budgets[month] || {}; model.budgetValuations[month] = model.budgetValuations[month] || {};
    model.budgets[month][id] = amount;
    model.budgetValuations[month][id] = {[model.currency]: {amount, sourceCurrency: model.currency, sourceAmount: amount, rate: '1'}};
    return model;
  }
  function deleteBudget(model, month, id) {
    if (!object(model) || !validDate(month + '-01') || !object(model.budgets) || !object(model.budgetValuations)) throw new Error('invalid_budget');
    if (model.budgets[month]) delete model.budgets[month][id];
    if (model.budgetValuations[month]) delete model.budgetValuations[month][id];
    return model;
  }
  function copyBudgets(model, sourceMonth, targetMonth) {
    if (!object(model) || !validDate(sourceMonth + '-01') || !validDate(targetMonth + '-01') || !object(model.budgets) || !object(model.budgetValuations)) throw new Error('invalid_budget');
    if (sourceMonth === targetMonth) return model;
    const limits = clone(model.budgets[sourceMonth] || {});
    for (const [id, amount] of Object.entries(limits)) if (!model.categories.some(category => category.id === id && category.type === 'expense') || !amountOK(amount)) throw new Error('invalid_budget');
    model.budgets[targetMonth] = {}; model.budgetValuations[targetMonth] = {};
    for (const [id, amount] of Object.entries(limits)) setBudget(model, targetMonth, id, amount);
    return model;
  }
  function converted(record) {return record.convertedAmount === undefined ? record.amount : record.convertedAmount;}
  function totals(records) {
    return records.reduce((result, item) => {
      const value = converted(item);
      if (!convertedOK(value) || !['income', 'expense'].includes(item.type)) throw new Error('invalid_record');
      result[item.type] += value;
      if (!Number.isSafeInteger(result[item.type]) || result[item.type] > MAX_TOTAL) throw new Error('invalid_total');
      return result;
    }, {income: 0, expense: 0});
  }
  function monthRecords(model, month) { return model.transactions.filter(record => record.date.slice(0, 7) === month); }
  function categoryName(model, id, language = model.design.language) {
    const category = model.categories.find(item => item.id === id);
    return category ? (language === 'ja' ? category.nameJa || category.nameZh : language === 'ko' ? category.nameKo || category.nameZh : language === 'en' ? category.nameEn || category.nameZh : category.nameZh) : id;
  }
  function categoryTotals(model, month, type) {
    const groups = new Map();
    monthRecords(model, month).filter(record => record.type === type).forEach(record => {
      const value = (groups.get(record.category) || 0) + converted(record);
      if (!Number.isSafeInteger(value) || value > MAX_TOTAL) throw new Error('invalid_total');
      groups.set(record.category, value);
    });
    return Array.from(groups, ([id, amount]) => ({id, amount})).sort((a, b) => b.amount - a.amount);
  }
  function budgetItems(model, month) {
    const spent = new Map(categoryTotals(model, month, 'expense').map(item => [item.id, item.amount]));
    return Object.entries(model.budgets[month] || {}).map(([id, limit]) => {
      const used = spent.get(id) || 0;
      return {id, limit, spent: used, remaining: limit - used, percent: Math.round(used / limit * 100), state: used > limit ? 'over' : used * 100 >= limit * 80 ? 'near' : 'normal'};
    });
  }
  function yearMonths(model, year) {
    return Array.from({length: 12}, (_, index) => {
      const month = String(year).padStart(4, '0') + '-' + String(index + 1).padStart(2, '0');
      return {month, ...totals(monthRecords(model, month))};
    });
  }
  function calculate(expression, currency = 'JPY') {
    if (!currencyInfo(currency)) return null;
    const value = String(expression).trim();
    if (!value || value.length > 64 || !/^\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/.test(value)) return null;
    const tokens = value.match(/[+-]?\d+(?:\.\d+)?/g);
    let result = 0n;
    for (const token of tokens) {
      const sign = token.startsWith('-') ? -1n : 1n;
      const minor = parseMinor(token.replace(/^[+-]/, ''), currency, true);
      if (minor === null) return null;
      result += sign * BigInt(minor);
    }
    return result >= 0n && result <= BigInt(MAX_AMOUNT) ? Number(result) : null;
  }
  function backup(model, exportedAt = new Date().toISOString()) {
    return JSON.stringify({format: 'koala-ledger-backup', backupVersion: 1, exportedAt, data: normalize(model)}, null, 2);
  }
  function readBackup(content) {
    if (typeof content !== 'string' || content.length > 20000000) throw new Error('invalid_backup');
    let parsed; try { parsed = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('invalid_backup'); }
    if (!object(parsed) || parsed.format !== 'koala-ledger-backup' || parsed.backupVersion !== 1) throw new Error('unsupported_backup');
    return {data: normalize(parsed.data), exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : ''};
  }
  function collectionBackup(collection, exportedAt = new Date().toISOString()) {
    return JSON.stringify({format: 'koala-ledger-backup', backupVersion: 2, exportedAt, data: normalizeCollection(collection)}, null, 2);
  }
  function readCollectionBackup(content) {
    if (typeof content !== 'string' || content.length > 20000000) throw new Error('invalid_backup');
    let parsed; try { parsed = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('invalid_backup'); }
    if (!object(parsed) || parsed.format !== 'koala-ledger-backup' || ![1, 2].includes(parsed.backupVersion) || !object(parsed.data) || (parsed.backupVersion === 2 ? parsed.data.version !== 5 : ![1, 2, 3, 4].includes(parsed.data.version))) throw new Error('unsupported_backup');
    return {data: normalizeCollection(parsed.data), exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : ''};
  }
  function csv(model) {
    const ja = model.design.language === 'ja', ko = model.design.language === 'ko', en = model.design.language === 'en';
    const fields = ja ? ['日付', '種類', 'カテゴリ', '金額', '通貨', '支払方法', 'メモ', '為替レート', '換算金額', '基準通貨', 'レート日付'] : ko ? ['날짜', '유형', '카테고리', '금액', '통화', '결제 수단', '메모', '환율', '환산 금액', '기준 통화', '환율 날짜'] : en ? ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Payment method', 'Note', 'Exchange rate', 'Converted amount', 'Main currency', 'Rate date'] : ['日期', '类型', '分类', '金额', '货币', '支付方式', '备注', '汇率', '换算金额', '主货币', '汇率日期'];
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const rows = model.transactions.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(record => [record.date, record.type === 'expense' ? en ? 'Expense' : ko ? '지출' : '支出' : en ? 'Income' : ja ? '収入' : ko ? '수입' : '收入', categoryName(model, record.category), decimalAmount(record.amount, record.currency || 'JPY'), record.currency || 'JPY', en ? 'Cash' : ja ? '現金' : ko ? '현금' : '现金', record.note, record.rate || '1', decimalAmount(converted(record), model.currency), model.currency, record.rateDate || '']);
    return '\uFEFF' + [fields, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
  }
  return {MAX_AMOUNT, MAX_TOTAL, CURRENCIES, COLORS, ICONS, DEFAULT_CATEGORIES, clone, normalize, empty, normalizeCollection, emptyCollection, activeBook, createBook, renameBook, collectionBackup, readCollectionBackup, validDate, monthLength, moveMonth, totals, monthRecords, categoryName, categoryTotals, budgetItems, yearMonths, calculate, backup, readBackup, csv, amountOK, currencyInfo, parseAmount, formatAmount, formatMoney, convertAmount, validRate, withValuations, rebasePlan, rebaseCurrency, setBudget, deleteBudget, copyBudgets};
});
