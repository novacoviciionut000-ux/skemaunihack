package com.accessmap.route;

import com.accessmap.common.Coordinate;
import com.accessmap.geocode.GeocodingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*") // permite frontend-ului să apeleze API-ul fără erori CORS
public class RouteController {

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

    @GetMapping("/route-by-address")
    public ResponseEntity<?> getRouteByAddress(
            @RequestParam String startAddress,
            @RequestParam String endAddress,
            @RequestParam(defaultValue = "wheelchair") String profile) {

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
            return ResponseEntity.internalServerError()
                    .body("Eroare la calcularea rutei: " + e.getMessage());
        }
    }
}