package com.accessmap.route;

import org.springframework.stereotype.Service;

@Service
public class RouteService {

    private final BlockedAreaProvider blockedAreaProvider;
    private final GraphHopperClient graphHopperClient; // Am adăugat clientul

    public RouteService(BlockedAreaProvider blockedAreaProvider, GraphHopperClient graphHopperClient) {
        this.blockedAreaProvider = blockedAreaProvider;
        this.graphHopperClient = graphHopperClient;
    }

    public RouteResponse calculateRoute(double startLat, double startLon, double endLat, double endLon, String profile) {
        // 1. Luăm obstacolele
        var blockedAreas = blockedAreaProvider.getActiveBlockedAreas();

        System.out.println("Cerem rută de la GraphHopper pt profil: " + profile);

        // 2. Apelăm GraphHopper-ul cu obstacolele incluse
        return graphHopperClient.fetchRoute(startLat, startLon, endLat, endLon, profile, blockedAreas);
    }
}