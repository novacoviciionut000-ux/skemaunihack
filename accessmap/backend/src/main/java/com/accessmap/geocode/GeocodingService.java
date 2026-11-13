package com.accessmap.geocode;

import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import com.accessmap.common.Coordinate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class GeocodingService {

    private final RestClient client;
    private final Map<String, GeocodeResult> cache = new ConcurrentHashMap<>();

    public GeocodingService(RestClient.Builder builder) {
        this.client = builder
                .baseUrl("https://nominatim.openstreetmap.org")
                // OBLIGATORIU: fără User-Agent propriu, Nominatim te poate bloca
                .defaultHeader(HttpHeaders.USER_AGENT, "accessmap-hackathon/1.0 (emailul-tau@example.com)")
                .build();
    }

    /** O singură adresă -> coordonate. */
    public GeocodeResult geocode(String address) {
        String key = address.trim().toLowerCase();
        GeocodeResult cached = cache.get(key);
        if (cached != null) return cached;

        List<NominatimPlace> places = client.get()
                .uri(u -> u.path("/search")
                        .queryParam("q", "{q}")
                        .queryParam("format", "jsonv2")
                        .queryParam("limit", 1)
                        .queryParam("countrycodes", "ro")
                        .build(address))
                .retrieve()
                .body(new ParameterizedTypeReference<List<NominatimPlace>>() {});

        GeocodeResult result;
        if (places == null || places.isEmpty()) {
            result = new GeocodeResult(address, null, null);
        } else {
            NominatimPlace p = places.get(0);
            result = new GeocodeResult(
                    address,
                    p.displayName(),
                    new Coordinate(Double.parseDouble(p.lat()), Double.parseDouble(p.lon())));
        }
        cache.put(key, result);
        return result;
    }

    /** Autocomplete / sugestii pentru o căutare (max limit rezultate) */
    public List<GeocodeResult> suggest(String query, int limit) {
        if (query == null || query.trim().length() < 2) return List.of();

        try {
            List<NominatimPlace> places = client.get()
                    .uri(u -> u.path("/search")
                            .queryParam("q", "{q}")
                            .queryParam("format", "jsonv2")
                            .queryParam("limit", Math.min(Math.max(limit, 1), 10))
                            .queryParam("countrycodes", "ro")
                            .build(query.trim()))
                    .retrieve()
                    .body(new ParameterizedTypeReference<List<NominatimPlace>>() {});

            List<GeocodeResult> results = new ArrayList<>();
            if (places != null) {
                for (NominatimPlace p : places) {
                    if (p.lat() != null && p.lon() != null) {
                        results.add(new GeocodeResult(
                                p.displayName(),
                                p.displayName(),
                                new Coordinate(Double.parseDouble(p.lat()), Double.parseDouble(p.lon()))));
                    }
                }
            }
            return results;
        } catch (Exception e) {
            return List.of();
        }
    }

    /** Mai multe adrese. Nominatim public permite ~1 cerere/secundă, deci așteptăm între ele. */
    public List<GeocodeResult> geocodeAll(List<String> addresses) {
        List<GeocodeResult> results = new ArrayList<>();
        for (String address : addresses) {
            boolean wasCached = cache.containsKey(address.trim().toLowerCase());
            results.add(geocode(address));
            if (!wasCached) sleep(1100);
        }
        return results;
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}