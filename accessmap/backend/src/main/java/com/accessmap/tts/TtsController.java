package com.accessmap.tts;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/tts")
public class TtsController {

    private static final int MAX_CACHE_SIZE = 200;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final Map<String, byte[]> audioCache = Collections.synchronizedMap(
            new LinkedHashMap<>(MAX_CACHE_SIZE, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > MAX_CACHE_SIZE;
                }
            }
    );

    @GetMapping
    public ResponseEntity<byte[]> synthesize(
            @RequestParam("text") String text,
            @RequestParam(value = "lang", defaultValue = "ro") String lang
    ) {
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        // Cap length for translate_tts (200 chars max)
        if (trimmed.length() > 200) {
            trimmed = trimmed.substring(0, 200);
        }

        String shortLang = (lang != null && lang.toLowerCase().startsWith("en")) ? "en" : "ro";
        String cacheKey = shortLang + ":" + trimmed;

        byte[] cached = audioCache.get(cacheKey);
        if (cached != null && cached.length > 0) {
            return buildAudioResponse(cached);
        }

        try {
            String encoded = URLEncoder.encode(trimmed, StandardCharsets.UTF_8);
            String url = "https://translate.google.com/translate_tts?ie=UTF-8&tl="
                    + shortLang + "&client=tw-ob&q=" + encoded;

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                    .header("Referer", "https://translate.google.com/")
                    .GET()
                    .build();

            HttpResponse<byte[]> res = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() == 200 && res.body() != null && res.body().length > 0) {
                audioCache.put(cacheKey, res.body());
                return buildAudioResponse(res.body());
            }
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
    }

    private ResponseEntity<byte[]> buildAudioResponse(byte[] bytes) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.valueOf("audio/mpeg"));
        headers.setCacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic());
        return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
    }
}
