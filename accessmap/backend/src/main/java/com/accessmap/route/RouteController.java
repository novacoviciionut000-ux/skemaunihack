package com.accessmap.route;

import com.accessmap.common.Coordinate;
import com.accessmap.geocode.GeocodingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/v1")
public class RouteController {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(RouteController.class);

    private static final Set<String> ALLOWED_PROFILES =
            Set.of("wheelchair", "low_vision", "limited_mobility", "foot", "pedestrian");

    private final GraphHopperClient graphHopperClient;
    private final GeocodingService geocodingService;
    private final BlockedAreaProvider blockedAreaProvider;

    @Autowired
    public RouteController(GraphHopperClient graphHopperClient,
                           GeocodingService geocodingService,
                           BlockedAreaProvider blockedAreaProvider) {
        this.graphHopperClient = graphHopperClient;
        this.geocodingService = geocodingService;
        this.blockedAreaProvider = blockedAreaProvider;
    }

    /** GET /api/v1/route?startLat=..&startLng=..&endLat=..&endLng=..&profile=wheelchair */
    @GetMapping("/route")
    public ResponseEntity<?> getRoute(
            @RequestParam double startLat,
            @RequestParam double startLng,
            @RequestParam double endLat,
            @RequestParam double endLng,
            @RequestParam(defaultValue = "wheelchair") String profile) {
        if (!isValidCoordinate(startLat, startLng) || !isValidCoordinate(endLat, endLng)) {
            return ResponseEntity.badRequest().body("Coordonate invalide.");
        }
        if (!ALLOWED_PROFILES.contains(profile)) {
            return ResponseEntity.badRequest().body("Profil de deplasare necunoscut.");
        }
        try {
            RouteResponse route = graphHopperClient.fetchRoute(
                    startLat, startLng, endLat, endLng, profile,
                    blockedAreaProvider.getBlockedAreas());
            return ResponseEntity.ok(route);
        } catch (Exception e) {
            log.warn("Route calculation failed", e);
            return ResponseEntity.internalServerError().body("Eroare la calcularea rutei.");
        }
    }

    @GetMapping("/route-by-address")
    public ResponseEntity<?> getRouteByAddress(
            @RequestParam String startAddress,
            @RequestParam String endAddress,
            @RequestParam(defaultValue = "wheelchair") String profile) {
        if (!ALLOWED_PROFILES.contains(profile) || startAddress.length() > 200 || endAddress.length() > 200) {
            return ResponseEntity.badRequest().body("Parametri invalizi.");
        }
        try {
            // 1. Transformăm adresele în coordonate
            Coordinate startCoord = geocodingService.geocode(startAddress).coordinate();
            Coordinate endCoord = geocodingService.geocode(endAddress).coordinate();

            if (startCoord == null || endCoord == null) {
                return ResponseEntity.badRequest()
                        .body("Nu am putut găsi coordonatele pentru adresele specificate.");
            }

            // 2. Zonele blocate (din rapoartele active)
            List<BlockedArea> blockedAreas = blockedAreaProvider.getBlockedAreas();

            // 3. Calculăm ruta
            RouteResponse route = graphHopperClient.fetchRoute(
                    startCoord.lat(), startCoord.lng(),
                    endCoord.lat(), endCoord.lng(),
                    profile,
                    blockedAreas
            );

            return ResponseEntity.ok(route);

        } catch (Exception e) {
            log.warn("Route calculation failed", e);
            return ResponseEntity.internalServerError().body("Eroare la calcularea rutei.");
        }
    }

    private static boolean isValidCoordinate(double lat, double lng) {
        return Double.isFinite(lat) && Double.isFinite(lng)
                && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
}
