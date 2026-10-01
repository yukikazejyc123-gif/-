package com.koalaledger.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Validates legacy ledgers and exact, per-record multicurrency snapshots before any file write. */
final class LedgerValidator {
    static final int MAX_BYTES = 20_000_000;
    private static final long MAX_SAFE_ID = 9_007_199_254_740_991L;
    private static final long MAX_AMOUNT = 999_999_999L;
    private static final long MAX_TOTAL = 50_000_000_000_000L;
    private static final Set<String> CURRENCIES = new HashSet<>(Arrays.asList("JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW"));
    private static final Set<String> COLORS = new HashSet<>(Arrays.asList("sage", "peach", "sand", "lilac", "sky"));
    private static final Set<String> EXPENSE = new HashSet<>(Arrays.asList("餐饮", "购物", "交通", "居住", "娱乐", "健康", "学习", "其他"));
    private static final Set<String> INCOME = new HashSet<>(Arrays.asList("工资", "其他收入"));
    private static final Set<String> ICONS = new HashSet<>(Arrays.asList("utensils", "shopping-bag", "train-front", "house", "headphones", "heart", "book-open", "ellipsis", "wallet", "gift", "coffee", "shopping-cart", "paw-print", "plane", "smartphone", "shirt", "leaf", "briefcase-business", "bike", "music", "cake", "umbrella", "coins", "ticket", "flower-2"));

    static void validate(JSONObject data) throws Exception {
        Object versionValue = data.get("version");
        if (!(versionValue instanceof Number) || (((Number) versionValue).doubleValue() != 1 && ((Number) versionValue).doubleValue() != 2 && ((Number) versionValue).doubleValue() != 3 && ((Number) versionValue).doubleValue() != 4 && ((Number) versionValue).doubleValue() != 5)) fail();
        int version = ((Number) versionValue).intValue();
        if (version == 5) { validateCollection(data); return; }
        String base = string(data, "currency");
        if (!CURRENCIES.contains(base) || (version < 3 && !"JPY".equals(base))) fail();
        Map<String, String> types = new HashMap<>();
        if (version == 1) {
            for (String id : EXPENSE) types.put(id, "expense");
            for (String id : INCOME) types.put(id, "income");
        } else {
            JSONArray categories = data.getJSONArray("categories");
            if (categories.length() < 2 || categories.length() > 200) fail();
            boolean hasExpense = false, hasIncome = false;
            for (int index = 0; index < categories.length(); index++) {
                JSONObject category = categories.getJSONObject(index);
                String id = string(category, "id"), type = string(category, "type");
                if (!id.matches("[A-Za-z0-9_\\-\\u4e00-\\u9fff]{1,80}") || Arrays.asList("__proto__", "constructor", "prototype").contains(id) || types.containsKey(id)) fail();
                if (!"expense".equals(type) && !"income".equals(type)) fail();
                String zh = string(category, "nameZh"), ja = string(category, "nameJa");
                if (zh.trim().isEmpty() || zh.length() > 40 || ja.length() > 40 || !ICONS.contains(string(category, "icon")) || !(category.get("archived") instanceof Boolean)) fail();
                if (category.has("nameKo") && string(category, "nameKo").length() > 40) fail();
                if (category.has("nameEn") && string(category, "nameEn").length() > 40) fail();
                if (category.has("color") && !COLORS.contains(string(category, "color"))) fail();
                boolean active = !category.getBoolean("archived");
                hasExpense |= active && "expense".equals(type); hasIncome |= active && "income".equals(type);
                types.put(id, type);
            }
            if (!hasExpense || !hasIncome) fail();
        }
        JSONArray records = data.getJSONArray("transactions");
        if (records.length() > 50_000) fail();
        Set<Long> ids = new HashSet<>(); long highestId = 0, incomeTotal = 0, expenseTotal = 0;
        for (int index = 0; index < records.length(); index++) {
            JSONObject record = records.getJSONObject(index);
            long id = integer(record.get("id"), MAX_SAFE_ID - 1);
            if (!ids.add(id)) fail(); highestId = Math.max(id, highestId);
            String type = string(record, "type"), category = string(record, "category");
            if (!type.equals(types.get(category))) fail();
            long amount = integer(record.get("amount"), version >= 3 ? MAX_AMOUNT : 9_999_999);
            long converted = amount;
            if (version >= 3) {
                String currency = string(record, "currency");
                if (!CURRENCIES.contains(currency)) fail();
                BigDecimal rate = rate(string(record, "rate"));
                if (currency.equals(base) && rate.compareTo(BigDecimal.ONE) != 0) fail();
                converted = integer(record.get("convertedAmount"), MAX_AMOUNT, true);
                long expected = BigDecimal.valueOf(amount).movePointLeft(digits(currency)).multiply(rate).movePointRight(digits(base)).setScale(0, RoundingMode.HALF_UP).longValueExact();
                if (expected > MAX_AMOUNT || expected != converted) fail();
                if (record.has("rateDate")) date(string(record, "rateDate"));
                if (version == 4) {
                    JSONObject valuations = record.getJSONObject("valuations");
                    if (!valuations.has(base)) fail();
                    Iterator<String> bases = valuations.keys();
                    while (bases.hasNext()) {
                        String valuedBase = bases.next();
                        validateRecordSnapshot(amount, currency, valuedBase, valuations.getJSONObject(valuedBase));
                    }
                    JSONObject active = valuations.getJSONObject(base);
                    if (integer(active.get("convertedAmount"), MAX_AMOUNT, true) != converted || (!currency.equals(base) && !string(active, "rate").equals(string(record, "rate"))) || !sameOptionalDate(active, record, "rateDate")) fail();
                }
            }
            if ("income".equals(type)) incomeTotal = Math.addExact(incomeTotal, converted);
            else expenseTotal = Math.addExact(expenseTotal, converted);
            if (incomeTotal > MAX_TOTAL || expenseTotal > MAX_TOTAL) fail();
            date(string(record, "date"));
            if (string(record, "note").length() > 200) fail();
        }
        if (version >= 2 && integer(data.get("nextId"), MAX_SAFE_ID - 1) <= highestId) fail();
        JSONObject budgets = data.getJSONObject("budgets");
        JSONObject budgetValuations = version == 4 ? data.getJSONObject("budgetValuations") : null;
        Iterator<String> months = budgets.keys();
        while (months.hasNext()) {
            String month = months.next();
            if (!month.matches("[0-9]{4}-[0-9]{2}")) fail(); date(month + "-01");
            JSONObject limits = budgets.getJSONObject(month);
            Iterator<String> categories = limits.keys();
            while (categories.hasNext()) {
                String id = categories.next();
                if (!"expense".equals(types.get(id))) fail();
                long limit = integer(limits.get(id), version >= 3 ? MAX_AMOUNT : 9_999_999);
                if (version == 4) {
                    JSONObject valuations = budgetValuations.getJSONObject(month).getJSONObject(id);
                    if (!valuations.has(base)) fail();
                    Iterator<String> bases = valuations.keys();
                    while (bases.hasNext()) {
                        String valuedBase = bases.next();
                        validateBudgetSnapshot(valuedBase, valuations.getJSONObject(valuedBase));
                    }
                    if (integer(valuations.getJSONObject(base).get("amount"), MAX_AMOUNT) != limit) fail();
                }
            }
        }
        if (version == 4) {
            Iterator<String> valuationMonths = budgetValuations.keys();
            while (valuationMonths.hasNext()) {
                String month = valuationMonths.next();
                if (!budgets.has(month)) fail();
                JSONObject entries = budgetValuations.getJSONObject(month), limits = budgets.getJSONObject(month);
                Iterator<String> valuationCategories = entries.keys();
                while (valuationCategories.hasNext()) if (!limits.has(valuationCategories.next())) fail();
            }
        }
        if (version >= 3 && data.has("exchangeRates")) {
            JSONObject quotes = data.getJSONObject("exchangeRates");
            Iterator<String> currencies = quotes.keys();
            while (currencies.hasNext()) {
                String currency = currencies.next();
                if (!CURRENCIES.contains(currency)) fail();
                JSONObject quote = quotes.getJSONObject(currency);
                BigDecimal value = rate(string(quote, "rate"));
                if (currency.equals(base) && value.compareTo(BigDecimal.ONE) != 0) fail();
                if (quote.has("date")) date(string(quote, "date"));
                if (quote.has("updatedAt")) integer(quote.get("updatedAt"), 9_007_199_254_740_991L, true);
            }
        }
        if (version >= 3 && data.opt("design") instanceof JSONObject) {
            JSONObject design = data.getJSONObject("design");
            if (design.has("lastCurrency") && !CURRENCIES.contains(string(design, "lastCurrency"))) fail();
            if (design.has("animations") && !(design.get("animations") instanceof Boolean)) fail();
        }
    }

    private static void validateCollection(JSONObject collection) throws Exception {
        JSONArray books = collection.getJSONArray("books");
        if (books.length() < 1 || books.length() > 50) fail();
        String activeId = string(collection, "activeBookId");
        Set<String> ids = new HashSet<>(), names = new HashSet<>(); int recordCount = 0;
        for (int index = 0; index < books.length(); index++) {
            JSONObject book = books.getJSONObject(index);
            String id = string(book, "id"), rawName = string(book, "name"), name = trimBookName(rawName);
            if (!id.matches("[A-Za-z0-9_-]{1,80}") || Arrays.asList("__proto__", "constructor", "prototype").contains(id) || !ids.add(id)) fail();
            if (rawName.length() > 40 || (name.isEmpty() && !"default".equals(id)) || !names.add(name.toLowerCase(Locale.ROOT))) fail();
            JSONObject data = book.getJSONObject("data");
            if (!(data.get("version") instanceof Number) || ((Number) data.get("version")).doubleValue() >= 5) fail();
            validate(data);
            recordCount += data.getJSONArray("transactions").length();
            if (recordCount > 50_000) fail();
        }
        if (!ids.contains(activeId)) fail();
        JSONObject preferences = collection.getJSONObject("preferences");
        if (preferences.has("language") && !Arrays.asList("zh", "ja", "ko", "en").contains(string(preferences, "language"))) fail();
        if (preferences.has("palette") && !Arrays.asList("鼠尾草绿", "桃粉", "淡紫").contains(string(preferences, "palette"))) fail();
        if (preferences.has("radius")) {
            Object rawRadius = preferences.get("radius");
            if (!(rawRadius instanceof Number)) fail();
            double radius = ((Number) rawRadius).doubleValue();
            if (!Double.isFinite(radius) || radius < 12 || radius > 30) fail();
        }
        for (String field : new String[]{"mascot", "animations"}) if (preferences.has(field) && !(preferences.get(field) instanceof Boolean)) fail();
    }
    private static String trimBookName(String name) {
        // Match JavaScript String.trim so imported names use the same duplicate check.
        return name.replaceAll("^[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+|[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+$", "");
    }
    static boolean hasCurrencyChange(JSONObject previous, JSONObject next) throws Exception {
        Map<String, String> before = currenciesByBook(previous), after = currenciesByBook(next);
        for (Map.Entry<String, String> entry : before.entrySet()) if (after.containsKey(entry.getKey()) && !entry.getValue().equals(after.get(entry.getKey()))) return true;
        return false;
    }
    private static Map<String, String> currenciesByBook(JSONObject collection) throws Exception {
        Map<String, String> result = new HashMap<>();
        if (collection.getInt("version") == 5) {
            JSONArray books = collection.getJSONArray("books");
            for (int index = 0; index < books.length(); index++) {
                JSONObject book = books.getJSONObject(index);
                result.put(string(book, "id"), string(book.getJSONObject("data"), "currency"));
            }
        } else result.put("default", string(collection, "currency"));
        return result;
    }

    private static void validateRecordSnapshot(long amount, String currency, String base, JSONObject snapshot) throws Exception {
        if (!CURRENCIES.contains(base)) fail();
        BigDecimal value = rate(string(snapshot, "rate"));
        if (currency.equals(base) && value.compareTo(BigDecimal.ONE) != 0) fail();
        long converted = integer(snapshot.get("convertedAmount"), MAX_AMOUNT, true);
        long expected = BigDecimal.valueOf(amount).movePointLeft(digits(currency)).multiply(value).movePointRight(digits(base)).setScale(0, RoundingMode.HALF_UP).longValueExact();
        if (expected > MAX_AMOUNT || converted != expected) fail();
        if (snapshot.has("rateDate")) date(string(snapshot, "rateDate"));
    }
    private static void validateBudgetSnapshot(String base, JSONObject snapshot) throws Exception {
        if (!CURRENCIES.contains(base)) fail();
        String source = string(snapshot, "sourceCurrency");
        if (!CURRENCIES.contains(source)) fail();
        long amount = integer(snapshot.get("amount"), MAX_AMOUNT), sourceAmount = integer(snapshot.get("sourceAmount"), MAX_AMOUNT);
        BigDecimal value = rate(string(snapshot, "rate"));
        if (source.equals(base) && value.compareTo(BigDecimal.ONE) != 0) fail();
        long expected = BigDecimal.valueOf(sourceAmount).movePointLeft(digits(source)).multiply(value).movePointRight(digits(base)).setScale(0, RoundingMode.HALF_UP).longValueExact();
        if (expected > MAX_AMOUNT || amount != expected) fail();
        if (snapshot.has("rateDate")) date(string(snapshot, "rateDate"));
    }
    private static boolean sameOptionalDate(JSONObject left, JSONObject right, String field) throws Exception {
        if (left.has(field) != right.has(field)) return false;
        return !left.has(field) || string(left, field).equals(string(right, field));
    }

    static void backup(String text) throws Exception {
        JSONObject envelope = new JSONObject(text);
        if (!"koala-ledger-backup".equals(envelope.get("format")) || !(envelope.get("backupVersion") instanceof Number)) fail();
        double version = ((Number) envelope.get("backupVersion")).doubleValue();
        JSONObject data = envelope.getJSONObject("data");
        if (version == 1 ? !(data.get("version") instanceof Number) || ((Number) data.get("version")).doubleValue() >= 5 : version != 2 || !(data.get("version") instanceof Number) || ((Number) data.get("version")).doubleValue() != 5) fail();
        validate(data);
    }
    private static String string(JSONObject data, String field) throws Exception {
        Object value = data.get(field); if (!(value instanceof String)) fail(); return (String) value;
    }
    private static long integer(Object value, long maximum) throws Exception {
        return integer(value, maximum, false);
    }
    private static long integer(Object value, long maximum, boolean zeroAllowed) throws Exception {
        if (!(value instanceof Number)) fail();
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number != Math.rint(number) || number < 0 || (!zeroAllowed && number == 0) || number > maximum) fail();
        return ((Number) value).longValue();
    }
    private static int digits(String currency) { return "JPY".equals(currency) || "KRW".equals(currency) ? 0 : 2; }
    private static BigDecimal rate(String value) throws Exception {
        if (!value.matches("(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,8})?")) fail();
        BigDecimal rate = new BigDecimal(value);
        if (rate.signum() <= 0 || rate.compareTo(new BigDecimal("100000000")) > 0) fail();
        return rate;
    }
    private static void date(String value) throws Exception {
        if (!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || LocalDate.parse(value).getYear() < 1) fail();
    }
    private static void fail() throws Exception { throw new Exception("Invalid ledger data"); }
}
