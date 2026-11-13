package com.accessmap.geocode;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/geocode")
public class GeocodeController {

    private final GeocodingService service;

    public GeocodeController(GeocodingService service) {
        this.service = service;
    }

    /** GET /api/geocode?q=Piata Unirii Timisoara */
    @GetMapping
    public GeocodeResult one(@RequestParam String q) {
        return service.geocode(q);
    }

    /** GET /api/geocode/suggest?q=Piata&limit=5 */
    @GetMapping("/suggest")
    public List<GeocodeResult> suggest(@RequestParam String q, @RequestParam(defaultValue = "5") int limit) {
        return service.suggest(q, limit);
    }

    /** POST /api/geocode/batch cu body: ["adresa 1", "adresa 2"] */
    @PostMapping("/batch")
    public List<GeocodeResult> many(@RequestBody List<String> addresses) {
        return service.geocodeAll(addresses);
    }
}