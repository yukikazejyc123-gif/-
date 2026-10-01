package com.koalaledger.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class RebaseValidatorTest {
    private JSONObject ledger() throws Exception {
        JSONArray list = new JSONArray()
            .put(new JSONObject().put("id", "餐饮").put("type", "expense").put("nameZh", "餐饮").put("nameJa", "食費").put("nameKo", "식비").put("icon", "utensils").put("color", "sage").put("archived", false))
            .put(new JSONObject().put("id", "工资").put("type", "income").put("nameZh", "工资").put("nameJa", "給与").put("nameKo", "급여").put("icon", "wallet").put("color", "sand").put("archived", false));
        JSONObject valuations = new JSONObject()
            .put("JPY", new JSONObject().put("rate", "1").put("convertedAmount", 1000))
            .put("USD", new JSONObject().put("rate", "0.0067").put("convertedAmount", 670).put("rateDate", "2026-10-01"));
        JSONObject record = new JSONObject().put("id", 1).put("type", "expense").put("category", "餐饮").put("amount", 1000).put("currency", "JPY").put("rate", "0.0067").put("convertedAmount", 670).put("rateDate", "2026-10-01").put("valuations", valuations).put("date", "2026-10-01").put("note", "");
        JSONObject budgets = new JSONObject().put("2026-10", new JSONObject().put("餐饮", 20100));
        JSONObject budgetSnapshots = new JSONObject()
            .put("JPY", new JSONObject().put("amount", 30000).put("sourceCurrency", "JPY").put("sourceAmount", 30000).put("rate", "1"))
            .put("USD", new JSONObject().put("amount", 20100).put("sourceCurrency", "JPY").put("sourceAmount", 30000).put("rate", "0.0067").put("rateDate", "2026-10-01"));
        return new JSONObject().put("version", 4).put("currency", "USD").put("nextId", 2).put("categories", list).put("transactions", new JSONArray().put(record)).put("budgets", budgets)
            .put("budgetValuations", new JSONObject().put("2026-10", new JSONObject().put("餐饮", budgetSnapshots)))
            .put("exchangeRates", new JSONObject().put("JPY", new JSONObject().put("rate", "0.007")))
            .put("design", new JSONObject().put("language", "ko").put("lastCurrency", "USD").put("animations", true));
    }
    private JSONObject record(JSONObject data) throws Exception {return data.getJSONArray("transactions").getJSONObject(0);}
    private JSONObject budgetSnapshots(JSONObject data) throws Exception {return data.getJSONObject("budgetValuations").getJSONObject("2026-10").getJSONObject("餐饮");}
    private void rejected(JSONObject data) {assertThrows(Exception.class, () -> LedgerValidator.validate(data));}
    @Test public void rebasedModelWithHistoricalSnapshotsAndNewQuoteAccepted() throws Exception {LedgerValidator.validate(ledger());}
    @Test public void switchingBackUsesOldSnapshotsWithNoQuoteRequired() throws Exception {
        JSONObject data = ledger(); data.put("currency", "JPY").put("exchangeRates", new JSONObject());
        record(data).put("rate", "1").put("convertedAmount", 1000).remove("rateDate");
        data.getJSONObject("budgets").getJSONObject("2026-10").put("餐饮", 30000); LedgerValidator.validate(data);
    }
    @Test public void missingRecordValuationsRejected() throws Exception {JSONObject data = ledger(); record(data).remove("valuations"); rejected(data);}
    @Test public void missingActiveRecordSnapshotRejected() throws Exception {JSONObject data = ledger(); record(data).getJSONObject("valuations").remove("USD"); rejected(data);}
    @Test public void activeAndInactiveRecordSnapshotAmountsValidated() throws Exception {
        for (String code : new String[]{"JPY", "USD"}) {JSONObject data = ledger(); record(data).getJSONObject("valuations").getJSONObject(code).put("convertedAmount", 999); rejected(data);}
    }
    @Test public void activeSnapshotRateAndDateMustMatchRecord() throws Exception {
        JSONObject data = ledger(); record(data).getJSONObject("valuations").getJSONObject("USD").put("rate", "0.00670000"); rejected(data);
        data = ledger(); record(data).getJSONObject("valuations").getJSONObject("USD").put("rateDate", "2026-10-02"); rejected(data);
        data = ledger(); record(data).remove("rateDate"); rejected(data);
    }
    @Test public void unknownRecordSnapshotCurrencyAndBadDateRejected() throws Exception {
        JSONObject data = ledger(); record(data).getJSONObject("valuations").put("BAD", new JSONObject().put("rate", "1").put("convertedAmount", 1000)); rejected(data);
        data = ledger(); record(data).getJSONObject("valuations").getJSONObject("JPY").put("rateDate", "2026-02-30"); rejected(data);
    }
    @Test public void missingBudgetValuationsAndActiveSnapshotRejected() throws Exception {
        JSONObject data = ledger(); data.remove("budgetValuations"); rejected(data);
        data = ledger(); budgetSnapshots(data).remove("USD"); rejected(data);
    }
    @Test public void budgetSnapshotsMustExactlyReproduceOriginalUnitsAndRate() throws Exception {
        for (String field : new String[]{"amount", "sourceAmount"}) {JSONObject data = ledger(); budgetSnapshots(data).getJSONObject("USD").put(field, 10); rejected(data);}
        JSONObject data = ledger(); budgetSnapshots(data).getJSONObject("USD").put("rate", "0.007"); rejected(data);
        data = ledger(); budgetSnapshots(data).getJSONObject("JPY").put("rate", "2"); rejected(data);
    }
    @Test public void orphanBudgetMonthsAndCategoriesRejected() throws Exception {
        JSONObject data = ledger(); data.getJSONObject("budgetValuations").put("2026-11", new JSONObject()); rejected(data);
        data = ledger(); data.getJSONObject("budgetValuations").getJSONObject("2026-10").put("other", new JSONObject()); rejected(data);
    }
    @Test public void budgetSnapshotZeroFractionAndUnknownCurrencyRejected() throws Exception {
        for (Object amount : new Object[]{0, 1.5, 1000000000L, "20100"}) {JSONObject data = ledger(); budgetSnapshots(data).getJSONObject("USD").put("amount", amount); rejected(data);}
        JSONObject data = ledger(); budgetSnapshots(data).getJSONObject("USD").put("sourceCurrency", "BAD"); rejected(data);
    }
    @Test public void optionalKoreanCategoryTextValidatedAndSchema4BackupsAccepted() throws Exception {
        JSONObject data = ledger(); data.getJSONArray("categories").getJSONObject(0).remove("nameKo"); LedgerValidator.validate(data);
        data = ledger(); data.getJSONArray("categories").getJSONObject(0).put("nameKo", 12); rejected(data);
        data = ledger(); data.getJSONArray("categories").getJSONObject(0).put("nameKo", "가".repeat(41)); rejected(data);
        LedgerValidator.backup(new JSONObject().put("format", "koala-ledger-backup").put("backupVersion", 1).put("data", ledger()).toString());
    }
}
