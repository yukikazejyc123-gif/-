package com.koalaledger.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class LedgerValidatorTest {
    private JSONObject legacy() throws Exception {
        return new JSONObject("{\"version\":1,\"currency\":\"JPY\",\"transactions\":[{\"id\":1,\"type\":\"expense\",\"category\":\"餐饮\",\"amount\":980,\"note\":\"午饭\",\"date\":\"2025-02-28\"}],\"budgets\":{\"2025-02\":{\"餐饮\":1000}}}");
    }
    private JSONObject modern() throws Exception {
        JSONObject value = legacy(); value.put("version",2); value.put("nextId",2);
        JSONArray categories = new JSONArray();
        categories.put(new JSONObject().put("id","餐饮").put("type","expense").put("nameZh","吃饭").put("nameJa","ごはん").put("icon","utensils").put("archived",false));
        categories.put(new JSONObject().put("id","工资").put("type","income").put("nameZh","工资").put("nameJa","給与").put("icon","wallet").put("archived",false));
        value.put("categories",categories); return value;
    }
    private void rejected(JSONObject value) { assertThrows(Exception.class, () -> LedgerValidator.validate(value)); }
    private JSONObject multicurrency() throws Exception {
        JSONObject value = modern(); value.put("version",3);
        JSONObject record = value.getJSONArray("transactions").getJSONObject(0);
        record.put("currency","JPY").put("rate","1").put("convertedAmount",980);
        value.put("exchangeRates",new JSONObject());
        value.put("design",new JSONObject().put("lastCurrency","JPY").put("animations",true));
        return value;
    }
    private JSONObject foreign() throws Exception {
        JSONObject value = multicurrency();
        value.getJSONArray("transactions").getJSONObject(0).put("currency","USD").put("amount",1001).put("rate","149.12345678").put("convertedAmount",1493).put("rateDate","2025-02-27");
        return value;
    }
    @Test public void legacyAndRenamedCategoryRemainValid() throws Exception { LedgerValidator.validate(legacy()); LedgerValidator.validate(modern()); }
    @Test public void monthlyFutureRecordsRemainValid() throws Exception { JSONObject value=modern(); value.getJSONArray("transactions").getJSONObject(0).put("date","2030-03-01"); value.getJSONObject("budgets").put("2030-03",new JSONObject().put("餐饮",2000)); LedgerValidator.validate(value); }
    @Test public void badDatesRejected() throws Exception { for(String date:new String[]{"0000-01-01","2025-02-29","2026-04-31"}) { JSONObject value=modern(); value.getJSONArray("transactions").getJSONObject(0).put("date",date); rejected(value); } }
    @Test public void leapDateValid() throws Exception { JSONObject value=modern(); value.getJSONArray("transactions").getJSONObject(0).put("date","2024-02-29"); LedgerValidator.validate(value); }
    @Test public void decimalAndLargeAmountsRejected() throws Exception { for(Object amount:new Object[]{0,-1,1.5,10000000,"980"}) { JSONObject value=modern(); value.getJSONArray("transactions").getJSONObject(0).put("amount",amount); rejected(value); } }
    @Test public void duplicateIdsAndStaleNextIdRejected() throws Exception { JSONObject value=modern(); value.getJSONArray("transactions").put(value.getJSONArray("transactions").get(0)); rejected(value); value=modern(); value.put("nextId",1); rejected(value); }
    @Test public void budgetCategoryMustBeExpense() throws Exception { JSONObject value=modern(); value.getJSONObject("budgets").getJSONObject("2025-02").put("工资",1000); rejected(value); }
    @Test public void hidingLastCategoryRejected() throws Exception { JSONObject value=modern(); value.getJSONArray("categories").getJSONObject(0).put("archived",true); rejected(value); }
    @Test public void identifierAndUnknownCategoryRejected() throws Exception { JSONObject value=modern(); value.getJSONArray("categories").getJSONObject(0).put("id","__proto__"); rejected(value); value=modern(); value.getJSONArray("transactions").getJSONObject(0).put("category","不存在"); rejected(value); }
    @Test public void onlySupportedBackupEnvelopeAccepted() throws Exception { JSONObject envelope=new JSONObject().put("format","koala-ledger-backup").put("backupVersion",1).put("data",modern()); LedgerValidator.backup(envelope.toString()); envelope.put("backupVersion",2); assertThrows(Exception.class,()->LedgerValidator.backup(envelope.toString())); }
    @Test public void fractionalAndStringVersionsRejected() throws Exception { for(Object version:new Object[]{2.5,"2",4294967297L}) { JSONObject value=modern();value.put("version",version);rejected(value); } }
    @Test public void exactMulticurrencySnapshotAccepted() throws Exception { LedgerValidator.validate(multicurrency()); LedgerValidator.validate(foreign()); }
    @Test public void originalAmountAndConversionMismatchRejected() throws Exception {
        JSONObject value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("amount",1002);rejected(value);
        value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("convertedAmount",1492);rejected(value);
        value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("rate","150");rejected(value);
    }
    @Test public void halfUpRoundingAndZeroConvertedTinyAmountAccepted() throws Exception {
        JSONObject value=foreign();JSONObject record=value.getJSONArray("transactions").getJSONObject(0);
        record.put("amount",1).put("rate","50").put("convertedAmount",1);LedgerValidator.validate(value);
        record.put("rate","49.99999999").put("convertedAmount",0);LedgerValidator.validate(value);
        record.put("convertedAmount",-1);rejected(value);
    }
    @Test public void nonYenBaseUsesBaseMinorUnits() throws Exception {
        JSONObject value=multicurrency();value.put("currency","USD");
        value.getJSONArray("transactions").getJSONObject(0).put("amount",100).put("currency","JPY").put("rate","0.0067").put("convertedAmount",67);
        value.getJSONObject("design").put("lastCurrency","USD");LedgerValidator.validate(value);
    }
    @Test public void twoDecimalConversionDoesNotUseBinaryFloatingPoint() throws Exception {
        JSONObject value=foreign();value.put("currency","EUR");
        JSONObject record=value.getJSONArray("transactions").getJSONObject(0);
        record.put("amount",2675).put("rate","1").put("convertedAmount",2675);LedgerValidator.validate(value);
        record.put("amount",3).put("rate","0.5").put("convertedAmount",2);LedgerValidator.validate(value);
    }
    @Test public void allEightBaseCurrenciesAcceptedAndUnknownRejected() throws Exception {
        for(String currency:new String[]{"JPY","CNY","USD","EUR","GBP","HKD","TWD","KRW"}) {
            JSONObject value=multicurrency();value.put("currency",currency);
            value.getJSONArray("transactions").getJSONObject(0).put("currency",currency);LedgerValidator.validate(value);
        }
        JSONObject value=multicurrency();value.put("currency","XYZ");rejected(value);
        value=multicurrency();value.getJSONArray("transactions").getJSONObject(0).put("currency","XYZ");rejected(value);
        value=legacy();value.put("currency","USD");rejected(value);
    }
    @Test public void strictRateBoundsAndIdentityAccepted() throws Exception {
        JSONObject value=multicurrency();value.getJSONArray("transactions").getJSONObject(0).put("rate","1.00000000");LedgerValidator.validate(value);
        for(Object rate:new Object[]{"0","01","-1","1e2","1.123456789","100000000.00000001","100000001",149.12}) {
            value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("rate",rate);rejected(value);
        }
        value=multicurrency();value.getJSONArray("transactions").getJSONObject(0).put("rate","2").put("convertedAmount",1960);rejected(value);
    }
    @Test public void conversionAndInputBoundsRejectedWhileNewMaximumAccepted() throws Exception {
        JSONObject value=multicurrency();value.getJSONArray("transactions").getJSONObject(0).put("amount",999999999).put("convertedAmount",999999999);LedgerValidator.validate(value);
        value=multicurrency();value.getJSONArray("transactions").getJSONObject(0).put("amount",1000000000).put("convertedAmount",1000000000);rejected(value);
        value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("amount",999999999).put("rate","100000000").put("convertedAmount",1);rejected(value);
    }
    @Test public void missingOrMalformedSnapshotFieldsRejected() throws Exception {
        for(String field:new String[]{"currency","rate","convertedAmount"}) {JSONObject value=foreign();value.getJSONArray("transactions").getJSONObject(0).remove(field);rejected(value);}
        JSONObject value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("rateDate","2025-02-29");rejected(value);
        value=foreign();value.getJSONArray("transactions").getJSONObject(0).put("convertedAmount",1493.5);rejected(value);
    }
    @Test public void quoteUpdatesDoNotRequireHistoricalSnapshotsToChange() throws Exception {
        JSONObject value=foreign();
        value.getJSONObject("exchangeRates").put("USD",new JSONObject().put("rate","170").put("date","2025-03-01"));
        LedgerValidator.validate(value);
        value.getJSONArray("transactions").getJSONObject(0).put("date","2030-12-31");LedgerValidator.validate(value);
    }
    @Test public void malformedQuotesUnknownCodesAndNonidentityBaseRejected() throws Exception {
        JSONObject value=multicurrency();value.getJSONObject("exchangeRates").put("XYZ",new JSONObject().put("rate","1"));rejected(value);
        value=multicurrency();value.getJSONObject("exchangeRates").put("USD",new JSONObject().put("rate","0"));rejected(value);
        value=multicurrency();value.getJSONObject("exchangeRates").put("USD",new JSONObject().put("rate","149").put("date","2025-02-29"));rejected(value);
        value=multicurrency();value.getJSONObject("exchangeRates").put("JPY",new JSONObject().put("rate","2"));rejected(value);
    }
    @Test public void categoryColorsAndNewDesignFieldsValidated() throws Exception {
        for(String color:new String[]{"sage","peach","sand","lilac","sky"}) {JSONObject value=multicurrency();value.getJSONArray("categories").getJSONObject(0).put("color",color);LedgerValidator.validate(value);}
        JSONObject value=multicurrency();value.getJSONArray("categories").getJSONObject(0).put("color","#ff00ff");rejected(value);
        value=multicurrency();value.getJSONObject("design").put("animations","false");rejected(value);
        value=multicurrency();value.getJSONObject("design").put("lastCurrency","XYZ");rejected(value);
    }
    @Test public void schema3BackupPreservesForeignSnapshot() throws Exception {
        JSONObject envelope=new JSONObject().put("format","koala-ledger-backup").put("backupVersion",1).put("data",foreign());LedgerValidator.backup(envelope.toString());
    }
    @Test public void monthlyBaseBudgetAcceptsNewBoundsAndRejectsInvalidAmounts() throws Exception {
        JSONObject value=multicurrency();value.getJSONObject("budgets").getJSONObject("2025-02").put("餐饮",999999999);LedgerValidator.validate(value);
        for(Object limit:new Object[]{0,-1,1.5,1000000000,"1000"}) {value=multicurrency();value.getJSONObject("budgets").getJSONObject("2025-02").put("餐饮",limit);rejected(value);}
    }
    @Test public void quoteObservationTimestampIsSafeIntegerMetadata() throws Exception {
        JSONObject value=multicurrency();value.getJSONObject("exchangeRates").put("USD",new JSONObject().put("rate","150").put("updatedAt",1790812800000L));LedgerValidator.validate(value);
        for(Object timestamp:new Object[]{-1,1.5,"1790812800000",9007199254740992L}) {value=multicurrency();value.getJSONObject("exchangeRates").put("USD",new JSONObject().put("rate","150").put("updatedAt",timestamp));rejected(value);}
    }
}
