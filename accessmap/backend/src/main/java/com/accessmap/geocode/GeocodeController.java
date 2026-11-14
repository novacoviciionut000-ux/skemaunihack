package com.accessmap.geocode;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/geocode")
public class GeocodeController {

    private static final int MAX_BATCH = 10;
    private static final int MAX_QUERY_LENGTH = 200;

    private final GeocodingService service;

    public GeocodeController(GeocodingService service) {
        this.service = service;
    }

    /** GET /api/geocode?q=Piata Unirii Timisoara */
    @GetMapping
    public GeocodeResult one(@RequestParam String q) {
        return service.geocode(clip(q));
    }

    /** GET /api/geocode/suggest?q=Piata&limit=5 */
    @GetMapping("/suggest")
    public List<GeocodeResult> suggest(@RequestParam String q, @RequestParam(defaultValue = "5") int limit) {
        return service.suggest(clip(q), limit);
    }

    /** POST /api/geocode/batch cu body: ["adresa 1", "adresa 2"] */
    @PostMapping("/batch")
    public List<GeocodeResult> many(@RequestBody List<String> addresses) {
        // Every address is a paid Google Maps API call; cap the batch so one request can't burn the quota
        if (addresses == null || addresses.size() > MAX_BATCH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Maxim " + MAX_BATCH + " adrese per cerere.");
        }
        return service.geocodeAll(addresses.stream().map(GeocodeController::clip).toList());
    }

    private static String clip(String q) {
        if (q == null) return null;
        String t = q.trim();
        return t.length() > MAX_QUERY_LENGTH ? t.substring(0, MAX_QUERY_LENGTH) : t;
    }
}