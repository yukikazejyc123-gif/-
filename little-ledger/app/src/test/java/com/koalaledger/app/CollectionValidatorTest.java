package com.koalaledger.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class CollectionValidatorTest {
    private JSONObject ledger(String currency) throws Exception {
        JSONArray categories = new JSONArray()
            .put(new JSONObject().put("id", "food").put("type", "expense").put("nameZh", "餐饮").put("nameJa", "食費").put("nameKo", "식비").put("nameEn", "Food").put("icon", "utensils").put("archived", false))
            .put(new JSONObject().put("id", "salary").put("type", "income").put("nameZh", "工资").put("nameJa", "給与").put("nameKo", "급여").put("nameEn", "Salary").put("icon", "wallet").put("archived", false));
        JSONObject record = new JSONObject().put("id", 1).put("type", "expense").put("category", "food").put("amount", 1000).put("currency", currency).put("rate", "1").put("convertedAmount", 1000).put("date", "2026-10-01").put("note", "")
            .put("valuations", new JSONObject().put(currency, new JSONObject().put("rate", "1").put("convertedAmount", 1000)));
        return new JSONObject().put("version", 4).put("currency", currency).put("transactions", new JSONArray().put(record)).put("categories", categories).put("nextId", 2)
            .put("budgets", new JSONObject()).put("budgetValuations", new JSONObject()).put("exchangeRates", new JSONObject()).put("design", new JSONObject().put("language", "en"));
    }
    private JSONObject collection() throws Exception {
        return new JSONObject().put("version", 5).put("activeBookId", "default")
            .put("books", new JSONArray().put(new JSONObject().put("id", "default").put("name", "").put("data", ledger("JPY")))
                .put(new JSONObject().put("id", "book-1").put("name", "September trip").put("data", ledger("USD"))))
            .put("preferences", new JSONObject().put("language", "en").put("palette", "鼠尾草绿").put("radius", 26).put("mascot", true).put("animations", true));
    }
    private JSONObject book(JSONObject collection, int index) throws Exception {return collection.getJSONArray("books").getJSONObject(index);}
    private void rejected(JSONObject data) {assertThrows(Exception.class, () -> LedgerValidator.validate(data));}

    @Test public void independentBooksAcceptSameRecordIdsAndDifferentCurrencies() throws Exception {LedgerValidator.validate(collection());}
    @Test public void allFourGlobalLanguagesAccepted() throws Exception {
        for (String language : new String[]{"zh", "ja", "ko", "en"}) {JSONObject data = collection(); data.getJSONObject("preferences").put("language", language); LedgerValidator.validate(data);}
    }
    @Test public void duplicateUnsafeOrMissingActiveIdsRejected() throws Exception {
        JSONObject data = collection(); book(data, 1).put("id", "default"); rejected(data);
        for (String id : new String[]{"__proto__", "constructor", "prototype", "旅行", "x".repeat(81)}) {data = collection(); book(data, 1).put("id", id); rejected(data);}
        data = collection(); data.put("activeBookId", "missing"); rejected(data);
        data = collection(); data.put("activeBookId", 12); rejected(data);
    }
    @Test public void bookNamesMustBeStringsUniqueAndAtMost40Characters() throws Exception {
        for (Object name : new Object[]{"", "  ", 12, "x".repeat(41)}) {JSONObject data = collection(); book(data, 1).put("name", name); rejected(data);}
        JSONObject data = collection(); book(data, 0).put("name", "Daily"); book(data, 1).put("name", "\u00a0DAILY\uFEFF"); rejected(data);
        data = collection(); book(data, 1).put("name", "9月旅行 🐨"); LedgerValidator.validate(data);
    }
    @Test public void everyInactiveBookMustBeValidAndNestedCollectionsRejected() throws Exception {
        JSONObject data = collection(); book(data, 1).getJSONObject("data").getJSONArray("transactions").getJSONObject(0).put("convertedAmount", 999); rejected(data);
        data = collection(); book(data, 1).put("data", collection()); rejected(data);
    }
    @Test public void optionalEnglishCategoryNamesAreValidated() throws Exception {
        for (Object name : new Object[]{12, "x".repeat(41)}) {JSONObject data = collection(); book(data, 1).getJSONObject("data").getJSONArray("categories").getJSONObject(0).put("nameEn", name); rejected(data);}
        JSONObject data = collection(); book(data, 1).getJSONObject("data").getJSONArray("categories").getJSONObject(0).remove("nameEn"); LedgerValidator.validate(data);
    }
    @Test public void malformedGlobalPreferencesRejected() throws Exception {
        String[] keys = {"language", "language", "palette", "radius", "radius", "mascot", "animations"};
        Object[] values = {"fr", 12, "neon", "22", 31, 0, "false"};
        for (int index = 0; index < keys.length; index++) {JSONObject data = collection(); data.getJSONObject("preferences").put(keys[index], values[index]); rejected(data);}
        JSONObject data = collection(); data.put("preferences", new JSONArray()); rejected(data);
    }
    @Test public void collectionBookCountLimitedTo1Through50() throws Exception {
        JSONObject data = collection(); data.put("books", new JSONArray()); rejected(data);
        data = collection(); JSONArray books = data.getJSONArray("books");
        for (int index = 2; index < 50; index++) books.put(new JSONObject().put("id", "book-" + index).put("name", "Book " + index).put("data", ledger("JPY")));
        LedgerValidator.validate(data); books.put(new JSONObject().put("id", "overflow").put("name", "Overflow").put("data", ledger("JPY"))); rejected(data);
    }
    @Test public void totalRecordLimitCountsEveryBook() throws Exception {
        JSONObject data = collection();
        for (int index = 0; index < 2; index++) {
            JSONObject ledger = book(data, index).getJSONObject("data");
            JSONArray records = new JSONArray(); JSONObject record = ledger.getJSONArray("transactions").getJSONObject(0);
            int count = index == 0 ? 25_001 : 25_000;
            for (int recordIndex = 0; recordIndex < count; recordIndex++) records.put(new JSONObject(record.toString()).put("id", recordIndex + 1));
            ledger.put("transactions", records).put("nextId", count + 1);
        }
        rejected(data); book(data, 0).getJSONObject("data").getJSONArray("transactions").remove(25_000); LedgerValidator.validate(data);
    }
    @Test public void legacyBookDataAcceptedInsideCollectionForMigration() throws Exception {
        JSONObject data = collection(); JSONObject legacy = new JSONObject().put("version", 1).put("currency", "JPY").put("transactions", new JSONArray()).put("budgets", new JSONObject());
        book(data, 0).put("data", legacy); LedgerValidator.validate(data);
    }
    @Test public void backupsRequireMatchingVersionAndCollectionEnvelope() throws Exception {
        JSONObject envelope = new JSONObject().put("format", "koala-ledger-backup").put("backupVersion", 2).put("data", collection()); LedgerValidator.backup(envelope.toString());
        envelope.put("backupVersion", 1); assertThrows(Exception.class, () -> LedgerValidator.backup(envelope.toString()));
        envelope.put("backupVersion", 2).put("data", ledger("JPY")); assertThrows(Exception.class, () -> LedgerValidator.backup(envelope.toString()));
        envelope.put("backupVersion", 1); LedgerValidator.backup(envelope.toString());
    }
    @Test public void currencySnapshotOnlyTriggersForMatchingBookIdChangingBase() throws Exception {
        JSONObject before = collection(), next = new JSONObject(before.toString()); next.put("activeBookId", "book-1"); assertFalse(LedgerValidator.hasCurrencyChange(before, next));
        book(next, 1).getJSONObject("data").put("currency", "EUR"); assertTrue(LedgerValidator.hasCurrencyChange(before, next));
        next = new JSONObject(before.toString()); next.getJSONArray("books").put(new JSONObject().put("id", "book-2").put("name", "Gifts").put("data", ledger("KRW"))); assertFalse(LedgerValidator.hasCurrencyChange(before, next));
        assertFalse(LedgerValidator.hasCurrencyChange(ledger("JPY"), collection()));
        assertTrue(LedgerValidator.hasCurrencyChange(ledger("EUR"), collection()));
    }
}
