package com.accessmap.geocode;

import com.accessmap.common.Coordinate;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class GeocodingService {

    private final RestClient client;
    private static final int MAX_CACHE_SIZE = 2_000;

    // Bounded LRU so arbitrary unique queries can't grow memory forever
    private final Map<String, GeocodeResult> cache = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, GeocodeResult> eldest) {
                    return size() > MAX_CACHE_SIZE;
                }
            });

    @Value("${google.maps.api-key}")
    private String apiKey;

    public GeocodingService(RestClient.Builder builder) {
        this.client = builder
                .baseUrl("https://maps.googleapis.com/maps/api/geocode")
                .build();
    }

    /** O singură adresă -> coordonate. */
    public GeocodeResult geocode(String address) {
        if (address == null || address.isBlank()) {
            return new GeocodeResult(address, null, null);
        }

        String key = address.trim().toLowerCase();
        GeocodeResult cached = cache.get(key);
        if (cached != null) return cached;

        GoogleGeocodeResponse response = client.get()
                .uri(u -> u.path("/json")
                        .queryParam("address", "{address}")
                        .queryParam("components", "country:RO")
                        .queryParam("bounds", "45.70,21.15|45.82,21.32") // prioritizează Timișoara
                        .queryParam("language", "ro")
                        .queryParam("key", apiKey)
                        .build(address.trim()))
                .retrieve()
                .body(GoogleGeocodeResponse.class);

        GeocodeResult result;
        if (response == null || response.results() == null || response.results().isEmpty()) {
            result = new GeocodeResult(address, null, null);
        } else {
            GoogleResult top = response.results().get(0);
            Location loc = top.geometry().location();
            result = new GeocodeResult(
                    address,
                    top.formattedAddress(),
                    new Coordinate(loc.lat(), loc.lng())
            );
        }

        cache.put(key, result);
        return result;
    }

    /** Autocomplete / sugestii pentru o căutare (max limit rezultate) */
    public List<GeocodeResult> suggest(String query, int limit) {
        if (query == null || query.trim().length() < 2) return List.of();

        int safeLimit = Math.min(Math.max(limit, 1), 10);

        try {
            GoogleGeocodeResponse response = client.get()
                    .uri(u -> u.path("/json")
                            .queryParam("address", "{address}")
                            .queryParam("components", "country:RO")
                            .queryParam("bounds", "45.70,21.15|45.82,21.32")
                            .queryParam("language", "ro")
                            .queryParam("key", apiKey)
                            .build(query.trim()))
                    .retrieve()
                    .body(GoogleGeocodeResponse.class);

            List<GeocodeResult> results = new ArrayList<>();
            if (response != null && response.results() != null) {
                for (GoogleResult r : response.results()) {
                    if (results.size() >= safeLimit) break;
                    if (r.geometry() != null && r.geometry().location() != null) {
                        Location loc = r.geometry().location();
                        results.add(new GeocodeResult(
                                r.formattedAddress(),
                                r.formattedAddress(),
                                new Coordinate(loc.lat(), loc.lng())
                        ));
                    }
                }
            }
            return results;
        } catch (Exception e) {
            return List.of();
        }
    }

    /** Mai multe adrese. Google permite 50 req/sec, deci am scos pauza de 1.1s de la Nominatim. */
    public List<GeocodeResult> geocodeAll(List<String> addresses) {
        List<GeocodeResult> results = new ArrayList<>();
        for (String address : addresses) {
            results.add(geocode(address));
        }
        return results;
    }

    // Record-uri interne pentru maparea automată a răspunsului JSON de la Google
    private record GoogleGeocodeResponse(List<GoogleResult> results, String status) {}
    private record GoogleResult(@JsonProperty("formatted_address") String formattedAddress, Geometry geometry) {}
    private record Geometry(Location location) {}
    private record Location(double lat, double lng) {}
}