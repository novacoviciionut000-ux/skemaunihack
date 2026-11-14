package com.accessmap.crossing;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/crossings")
public class CrossingController {

    private final CrossingService service;

    public CrossingController(CrossingService service) {
        this.service = service;
    }

    /** GET /api/crossings?south=45.75&west=21.22&north=45.76&east=21.23 */
    @GetMapping
    public List<Crossing> inBoundingBox(
            @RequestParam double south,
            @RequestParam double west,
            @RequestParam double north,
            @RequestParam double east) {
        return service.findInBoundingBox(south, west, north, east);
    }
}
