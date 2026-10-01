package com.koalaledger.app;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Fetches only a currency pair. No ledger amounts, notes or dates leave the device. */
final class ExchangeRateClient {
    private static final Set<String> CURRENCIES = new HashSet<>(Arrays.asList("JPY", "CNY", "USD", "EUR", "GBP", "KRW", "HKD", "TWD"));
    static boolean supported(String code) { return CURRENCIES.contains(code); }

    static JSONObject parse(String payload, String source, String target) throws Exception {
        if (!supported(source) || !supported(target) || source.equals(target)) throw new IOException("Invalid currency pair");
        JSONObject data = new JSONObject(payload);
        if (!source.equals(data.getString("base")) || !target.equals(data.getString("quote"))) throw new IOException("Wrong currency pair");
        String date = data.getString("date");
        if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IOException("Invalid quote date");
        if (LocalDate.parse(date).getYear() < 1) throw new IOException("Invalid quote date");
        BigDecimal value = new BigDecimal(data.get("rate").toString());
        if (value.signum() <= 0 || value.compareTo(new BigDecimal("100000000")) > 0) throw new IOException("Invalid rate");
        String rate = value.setScale(8, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
        if (new BigDecimal(rate).signum() <= 0) throw new IOException("Rate too small");
        return new JSONObject().put("currency", source).put("base", target).put("rate", rate).put("date", date).put("status", "success");
    }

    static JSONObject fetch(String source, String target) throws Exception {
        if (!supported(source) || !supported(target) || source.equals(target)) throw new IOException("Invalid currency pair");
        URL url = new URL("https://api.frankfurter.dev/v2/rate/" + source.toLowerCase(Locale.ROOT) + "/" + target.toLowerCase(Locale.ROOT));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(6000);
        connection.setReadTimeout(8000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() != 200) throw new IOException("Quote unavailable");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int length;
                while ((length = stream.read(buffer)) != -1) {
                    if (bytes.size() + length > 65536) throw new IOException("Quote response too large");
                    bytes.write(buffer, 0, length);
                }
            }
            return parse(new String(bytes.toByteArray(), StandardCharsets.UTF_8), source, target);
        } finally { connection.disconnect(); }
    }
    static JSONObject fromCache(String payload, String source, String target) throws Exception {
        JSONObject cache = new JSONObject(payload);
        if (!source.equals(cache.getString("currency")) || !target.equals(cache.getString("base"))) throw new IOException("Wrong cached currency pair");
        JSONObject original = new JSONObject().put("base", source).put("quote", target).put("rate", cache.get("rate")).put("date", cache.get("date"));
        JSONObject quote = parse(original.toString(), source, target);
        Object timestamp = cache.opt("updatedAt");
        long updatedAt = 0;
        if (timestamp != null) {
            if (!(timestamp instanceof Number)) throw new IOException("Invalid quote timestamp");
            double value = ((Number) timestamp).doubleValue();
            if (!Double.isFinite(value) || value != Math.rint(value) || value < 0 || value > 9_007_199_254_740_991L) throw new IOException("Invalid quote timestamp");
            updatedAt = ((Number) timestamp).longValue();
        }
        return quote.put("status", "cached").put("updatedAt", updatedAt);
    }
}
