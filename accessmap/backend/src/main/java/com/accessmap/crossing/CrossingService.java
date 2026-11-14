package com.accessmap.crossing;

import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Looks up pedestrian crossings in OpenStreetMap through Overpass.
 *
 * Queried here rather than from the browser for two reasons: Overpass rate-limits per IP
 * and would cut off a group of phones testing on the same network, and the results can be
 * cached. Crossings change rarely, so a day-long cache costs nothing and removes Overpass
 * from the path of almost every request.
 */
@Service
public class CrossingService {

    // Public mirrors, tried in order: the main instance returns 502 or times out often
    private static final List<String> ENDPOINTS = List.of(
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.openstreetmap.ru/api/interpreter"
    );

    private static final long CACHE_TTL_MS = 24 * 60 * 60 * 1000L;
    private static final int MAX_CACHE_ENTRIES = 500;
    /** Bounding boxes bigger than this are refused: the query would be slow and huge. */
    private static final double MAX_BBOX_DEGREES = 0.5;
    // Without explicit timeouts a hanging mirror blocks the request thread indefinitely,
    // and with three mirrors to try the phone would wait minutes for an answer.
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(4);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(20);
    private static final long FAILURE_BACKOFF_MS = 2 * 60 * 1000L;

    private final RestTemplate restTemplate = new RestTemplateBuilder()
            .setConnectTimeout(CONNECT_TIMEOUT)
            .setReadTimeout(READ_TIMEOUT)
            .build();
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private final Map<String, Long> failedUntil = new ConcurrentHashMap<>();

    private record CacheEntry(List<Crossing> crossings, long fetchedAt) {
    }

    public List<Crossing> findInBoundingBox(double south, double west, double north, double east) {
        if (north <= south || east <= west) {
            return Collections.emptyList();
        }
        if (north - south > MAX_BBOX_DEGREES || east - west > MAX_BBOX_DEGREES) {
            return Collections.emptyList();
        }

        // Rounded to ~100 m so nearby routes share a cache entry instead of each fetching
        String key = String.format("%.3f,%.3f,%.3f,%.3f", south, west, north, east);
        CacheEntry cached = cache.get(key);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt() < CACHE_TTL_MS) {
            return cached.crossings();
        }

        Long backoff = failedUntil.get(key);
        if (backoff != null) {
            if (System.currentTimeMillis() < backoff) {
                return cached != null ? cached.crossings() : Collections.emptyList();
            }
            failedUntil.remove(key);
        }

        List<Crossing> crossings = fetchFromOverpass(south, west, north, east);
        if (crossings != null) {
            if (cache.size() >= MAX_CACHE_ENTRIES) {
                cache.clear();
            }
            cache.put(key, new CacheEntry(crossings, System.currentTimeMillis()));
            return crossings;
        }

        // Overpass unreachable: serve a stale entry if there is one, otherwise nothing.
        // An empty list makes the client fall back to camera detection.
        if (cached != null) {
            return cached.crossings();
        }
        // Remember the failure for a short while. Overpass drops connections when rate
        // limited, and trying three mirrors takes nearly half a minute; a phone asking
        // again right after should not wait through that a second time.
        failedUntil.put(key, System.currentTimeMillis() + FAILURE_BACKOFF_MS);
        return Collections.emptyList();
    }

    @SuppressWarnings("unchecked")
    private List<Crossing> fetchFromOverpass(double south, double west, double north, double east) {
        String bbox = String.format("%f,%f,%f,%f", south, west, north, east);
        String query = "[out:json][timeout:25];("
                + "node[\"highway\"=\"crossing\"](" + bbox + ");"
                + "way[\"footway\"=\"crossing\"](" + bbox + ");"
                + ");out center tags;";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.set(HttpHeaders.USER_AGENT, "AccessMap/1.0 (pedestrian accessibility app)");
        String body = "data=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
        HttpEntity<String> request = new HttpEntity<>(body, headers);

        for (String endpoint : ENDPOINTS) {
            try {
                Map<String, Object> response = restTemplate
                        .exchange(endpoint, HttpMethod.POST, request, Map.class)
                        .getBody();
                if (response == null || !(response.get("elements") instanceof List<?> elements)) {
                    continue;
                }
                List<Crossing> result = new ArrayList<>();
                for (Object raw : elements) {
                    if (raw instanceof Map<?, ?> element) {
                        Crossing crossing = toCrossing((Map<String, Object>) element);
                        if (crossing != null) {
                            result.add(crossing);
                        }
                    }
                }
                return result;
            } catch (Exception e) {
                System.err.println("Overpass " + endpoint + " a eșuat: " + e.getMessage());
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Crossing toCrossing(Map<String, Object> element) {
        Double lat = asDouble(element.get("lat"));
        Double lng = asDouble(element.get("lon"));
        if (lat == null && element.get("center") instanceof Map<?, ?> center) {
            // Ways report no coordinate of their own, only the center asked for by "out center"
            lat = asDouble(((Map<String, Object>) center).get("lat"));
            lng = asDouble(((Map<String, Object>) center).get("lon"));
        }
        if (lat == null || lng == null) {
            return null;
        }

        Map<String, Object> tags = element.get("tags") instanceof Map<?, ?> t
                ? (Map<String, Object>) t
                : Collections.emptyMap();
        String crossingTag = str(tags.get("crossing"));
        String signalsTag = str(tags.get("crossing:signals"));
        String markingsTag = str(tags.get("crossing:markings"));

        boolean hasSignals = "yes".equals(signalsTag)
                || "separate".equals(signalsTag)
                || "traffic_signals".equals(crossingTag);
        boolean noSignals = "no".equals(signalsTag)
                || "uncontrolled".equals(crossingTag)
                || "marked".equals(crossingTag)
                || "unmarked".equals(crossingTag);
        boolean hasMarkings = "yes".equals(markingsTag)
                || "marked".equals(crossingTag)
                || "zebra".equals(crossingTag)
                || "uncontrolled".equals(crossingTag);

        String kind = hasSignals ? "signals" : noSignals ? "none" : "unknown";

        return new Crossing(
                element.get("type") + "/" + element.get("id"),
                lat,
                lng,
                hasSignals,
                hasMarkings,
                "yes".equals(str(tags.get("tactile_paving"))),
                kind
        );
    }

    private static Double asDouble(Object value) {
        return value instanceof Number n ? n.doubleValue() : null;
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }
}
