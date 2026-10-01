package com.koalaledger.app;

import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class ExchangeRateClientTest {
    private String quote(String source, String target, String date, String rate) {
        return "{\"base\":\"" + source + "\",\"quote\":\"" + target + "\",\"date\":\"" + date + "\",\"rate\":" + rate + "}";
    }
    private void rejected(String value, String source, String target) {
        try { ExchangeRateClient.parse(value, source, target); fail("Expected quote rejection"); }
        catch (Exception expected) { }
    }
    @Test public void successfulQuotePreservesPairAndDate() throws Exception {
        JSONObject result = ExchangeRateClient.parse(quote("CNY", "JPY", "2026-10-01", "23.473"), "CNY", "JPY");
        assertEquals("23.473", result.getString("rate"));
        assertEquals("2026-10-01", result.getString("date"));
        assertEquals("CNY", result.getString("currency"));
        assertEquals("JPY", result.getString("base"));
        assertEquals("success", result.getString("status"));
    }
    @Test public void quotePrecisionMatchesLedger() throws Exception {
        assertEquals("0.00123457", ExchangeRateClient.parse(quote("KRW", "JPY", "2026-10-01", "0.0012345678"), "KRW", "JPY").getString("rate"));
    }
    @Test public void rejectsWrongPairAndUnsupportedCodes() {
        rejected(quote("JPY", "CNY", "2026-10-01", "0.04"), "CNY", "JPY");
        rejected(quote("ZZZ", "JPY", "2026-10-01", "1"), "ZZZ", "JPY");
        rejected(quote("JPY", "JPY", "2026-10-01", "1"), "JPY", "JPY");
    }
    @Test public void rejectsInvalidDatesAndYearZero() {
        rejected(quote("CNY", "JPY", "2026-02-30", "23"), "CNY", "JPY");
        rejected(quote("CNY", "JPY", "0000-01-01", "23"), "CNY", "JPY");
    }
    @Test public void rejectsMissingZeroNegativeAndUnboundedRates() {
        for (String rate : new String[]{"0", "-1", "100000001", "0.000000000001", "null"}) rejected(quote("CNY", "JPY", "2026-10-01", rate), "CNY", "JPY");
        rejected("{}", "CNY", "JPY");
    }
    @Test public void cachedQuoteRetainsPairDateAndObservationTime() throws Exception {
        JSONObject cached=ExchangeRateClient.parse(quote("CNY","JPY","2026-10-01","23.473"),"CNY","JPY").put("updatedAt",1790812800000L);
        JSONObject result=ExchangeRateClient.fromCache(cached.toString(),"CNY","JPY");
        assertEquals("cached",result.getString("status"));assertEquals("23.473",result.getString("rate"));assertEquals(1790812800000L,result.getLong("updatedAt"));
        try {ExchangeRateClient.fromCache(cached.toString(),"USD","JPY");fail("Wrong cached pair accepted");} catch (Exception expected) {}
    }
    @Test public void malformedCacheTimestampRejected() throws Exception {
        JSONObject cached=ExchangeRateClient.parse(quote("CNY","JPY","2026-10-01","23.473"),"CNY","JPY");
        for(Object value:new Object[]{-1,1.5,"1790812800000",9007199254740992L}) {
            cached.put("updatedAt",value);
            try {ExchangeRateClient.fromCache(cached.toString(),"CNY","JPY");fail("Invalid cached timestamp accepted");} catch (Exception expected) {}
        }
    }
}
