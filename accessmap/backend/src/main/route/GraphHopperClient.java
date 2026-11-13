package com.accessmap.route;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class GraphHopperClient {

    // Adresa unde rulează GraphHopper în Docker-ul local
    private final String graphHopperUrl = "http://localhost:8989/route";
    private final RestTemplate restTemplate = new RestTemplate();

    @SuppressWarnings("unchecked")
    public RouteResponse fetchRoute(double startLat, double startLon,
                                    double endLat, double endLon,
                                    String profile,
                                    List<BlockedArea> blockedAreas) {

        UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(graphHopperUrl)
                .queryParam("point", startLat + "," + startLon)
                .queryParam("point", endLat + "," + endLon)
                .queryParam("profile", profile)
                // necesar pentru block_area (modul flexibil, fără CH)
                .queryParam("ch.disable", "true");

        // Zonele blocate: "lat,lon,raza;lat,lon,raza;..."
        if (blockedAreas != null && !blockedAreas.isEmpty()) {
            String blockAreaParam = blockedAreas.stream()
                    .map(BlockedArea::toGraphHopperParam)
                    .collect(Collectors.joining(";"));
            builder.queryParam("block_area", blockAreaParam);
        }

        try {
            Map<String, Object> response =
                    restTemplate.getForObject(builder.build().toUri(), Map.class);

            if (response != null) {
                List<Map<String, Object>> paths = (List<Map<String, Object>>) response.get("paths");
                if (paths != null && !paths.isEmpty()) {
                    Map<String, Object> bestPath = paths.get(0);
                    double distance = ((Number) bestPath.get("distance")).doubleValue();
                    double time = ((Number) bestPath.get("time")).doubleValue() / 1000.0; // ms -> s

                    // Pentru MVP lăsăm punctele goale până adăugăm decodarea poliliniei
                    return new RouteResponse(Collections.emptyList(), distance, time);
                }
            }
        } catch (Exception e) {
            System.err.println("Eroare la comunicarea cu GraphHopper: " + e.getMessage());
        }

        // Fallback dacă a picat ceva
        return new RouteResponse(Collections.emptyList(), 0, 0);
    }
}