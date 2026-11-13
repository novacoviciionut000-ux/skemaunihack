package com.accessmap.route;

// Presupunem că acesta este serviciul făcut de colegul dumneavoastră
import com.accessmap.geocode.GeocodingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.accessmap.common.Coordinate;
import java.util.List;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*") // Crucial pentru a permite frontend-ului (ex: React/Vue) să apeleze API-ul fără erori CORS
public class RouteController {

    private final GraphHopperClient graphHopperClient;
    private final GeocodingService geocodingService;

    @Autowired
    public RouteController(GraphHopperClient graphHopperClient, GeocodingService geocodingService) {
        this.graphHopperClient = graphHopperClient;
        this.geocodingService = geocodingService;
    }

    @GetMapping("/route-by-address")
    public ResponseEntity<?> getRouteByAddress(
            @RequestParam String startAddress,
            @RequestParam String endAddress,
            @RequestParam(defaultValue = "wheelchair") String profile) {

        try {
            // 1. Apelăm munca colegului: transformăm textul în Lat/Lon
            Coordinate startCoord = geocodingService.geocode(startAddress).coordinate();
            Coordinate endCoord = geocodingService.geocode(endAddress).coordinate();

            if (startCoord == null || endCoord == null) {
                return ResponseEntity.badRequest().body("Nu am putut găsi coordonatele pentru adresele specificate.");
            }

            // 2. Aici putem extrage "blockedAreas" din baza de date PostGIS în viitor.
            // Momentan lăsăm null sau o listă goală pentru MVP.
            List<Coordinate> blockedAreas = null;

            // 3. Apelăm munca dumneavoastră: calculăm ruta
            RouteResponse route = graphHopperClient.fetchRoute(
                    startCoord.lat(), startCoord.lng(),
                    endCoord.lat(), endCoord.lng(),
                    profile,
                    blockedAreas
            );

            return ResponseEntity.ok(route);

        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Eroare la calcularea rutei: " + e.getMessage());
        }
    }
}