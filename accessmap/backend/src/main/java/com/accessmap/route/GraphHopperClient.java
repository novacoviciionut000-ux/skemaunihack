package com.accessmap.route;

import com.accessmap.common.Coordinate;
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
                .queryParam("points_encoded", "false")
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
                    List<Coordinate> path = Collections.emptyList();
                    Map<String, Object> points = (Map<String, Object>) bestPath.get("points");
                    if (points != null && points.get("coordinates") instanceof List<?> coords) {
                        // GeoJSON: [lon, lat]
                        path = coords.stream()
                                .map(c -> (List<Number>) c)
                                .map(c -> new Coordinate(c.get(1).doubleValue(), c.get(0).doubleValue()))
                                .collect(Collectors.toList());
                    }
                    return new RouteResponse(path, distance, time);
                }
            }
        } catch (Exception e) {
            System.err.println("GraphHopper local indisponibil (" + e.getMessage() + "), folosesc fallback OSRM foot routing...");
        }

        // Fallback: Ruterul de pietoni OpenStreetMap (OSRM Foot) care urmează trotuarele și străzile reale
        try {
            String osrmUrl = String.format(
                    "https://routing.openstreetmap.de/routed-foot/route/v1/foot/%s,%s;%s,%s?overview=full&geometries=geojson",
                    Double.toString(startLon), Double.toString(startLat),
                    Double.toString(endLon), Double.toString(endLat));

            Map<String, Object> osrmResponse = restTemplate.getForObject(osrmUrl, Map.class);
            if (osrmResponse != null && "Ok".equalsIgnoreCase((String) osrmResponse.get("code"))) {
                List<Map<String, Object>> routes = (List<Map<String, Object>>) osrmResponse.get("routes");
                if (routes != null && !routes.isEmpty()) {
                    Map<String, Object> route = routes.get(0);
                    double distance = ((Number) route.get("distance")).doubleValue();
                    double duration = ((Number) route.get("duration")).doubleValue();

                    Map<String, Object> geometry = (Map<String, Object>) route.get("geometry");
                    if (geometry != null && geometry.get("coordinates") instanceof List<?> coords) {
                        List<Coordinate> path = coords.stream()
                                .map(c -> (List<Number>) c)
                                .map(c -> new Coordinate(c.get(1).doubleValue(), c.get(0).doubleValue()))
                                .collect(Collectors.toList());
                        return new RouteResponse(path, distance, duration);
                    }
                }
            }
        } catch (Exception osrmEx) {
            System.err.println("Eroare la fallback-ul OSRM: " + osrmEx.getMessage());
        }

        // Fallback dacă au eșuat ambele
        return new RouteResponse(Collections.emptyList(), 0, 0);
    }
}