package com.accessmap.route;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/route")
@CrossOrigin(origins = "*") // Crucial pentru Persoana D, altfel primește erori de CORS din browser
public class RouteController {

    private final RouteService routeService;

    public RouteController(RouteService routeService) {
        this.routeService = routeService;
    }

    @GetMapping
    public RouteResponse getRoute(
            @RequestParam double startLat,
            @RequestParam double startLon,
            @RequestParam double endLat,
            @RequestParam double endLon,
            @RequestParam(defaultValue = "wheelchair") String profile) {

        return routeService.calculateRoute(startLat, startLon, endLat, endLon, profile);
    }
}