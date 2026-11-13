package com.accessmap.route;

import com.accessmap.common.Coordinate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@Component
public class GraphHopperClient {

    // Adresa unde va rula GraphHopper în Docker-ul local
    private final String graphHopperUrl = "http://localhost:8989/route";
    private final RestTemplate restTemplate = new RestTemplate();

    public RouteResponse fetchRoute(double startLat, double startLon, double endLat, double endLon, String profile, List<Coordinate> blockedAreas) {

        // Construim URL-ul cererii către GraphHopper
        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(graphHopperUrl)
                .queryParam("point", startLat + "," + startLon)
                .queryParam("point", endLat + "," + endLon)
                .queryParam("profile", profile)
                // ch.disable=true este vital pentru a putea aplica obstacole dinamice mai târziu
                .queryParam("ch.disable", "true");

        // Tot pentru mai târziu: dacă avem obstacole, le adăugăm ca puncte de evitat în URL (ex: block_area=lat,lon)
        if (blockedAreas != null && !blockedAreas.isEmpty()) {
            StringBuilder blockAreaParam = new StringBuilder();
            for (int i = 0; i < blockedAreas.size(); i++) {
                blockAreaParam.append(blockedAreas.get(i).getLat()).append(",").append(blockedAreas.get(i).getLon());
                if (i < blockedAreas.size() - 1) blockAreaParam.append(";"); // GraphHopper desparte punctele prin punct și virgulă
            }
            // Adăugăm o rază standard de evitare în jurul punctului (ex: 10 metri)
            builder.queryParam("block_area", blockAreaParam.toString() + "10");
        }

        try {
            // Trimitem cererea către GraphHopper
            Map<String, Object> response = restTemplate.getForObject(builder.toUriString(), Map.class);

            // Extragem datele utile din JSON-ul imens pe care îl dă GraphHopper
            List> paths = (List>) response.get("paths");
            if (paths != null && !paths.isEmpty()) {
                Map<String, Object> bestPath = paths.get(0);
                double distance = (Double) bestPath.get("distance");
                double time = (Double) bestPath.get("time") / 1000.0; // din milisecunde în secunde

                // Pentru MVP, lăsăm punctele goale până adăugăm decodarea poliliniei (vom face asta la pasul următor)
                return new RouteResponse(Collections.emptyList(), distance, time);
            }
        } catch (Exception e) {
            System.err.println("Eroare la comunicarea cu GraphHopper: " + e.getMessage());
        }

        // Returnăm un răspuns gol (fallback) dacă a picat ceva
        return new RouteResponse(Collections.emptyList(), 0, 0);
    }
}