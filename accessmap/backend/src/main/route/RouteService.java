package com.accessmap.route;

import org.springframework.stereotype.Service;

@Service
public class RouteService {

    private final BlockedAreaProvider blockedAreaProvider;

    // Spring injectează automat NoopBlockedAreaProvider-ul creat mai sus
    public RouteService(BlockedAreaProvider blockedAreaProvider) {
        this.blockedAreaProvider = blockedAreaProvider;
    }

    public RouteResponse calculateRoute(double startLat, double startLon, double endLat, double endLon, String profile) {
        // 1. Luăm obstacolele active de la Persoana B
        var blockedAreas = blockedAreaProvider.getActiveBlockedAreas();

        // TODO: Integrarea cu GraphHopperClient va veni aici
        // Vom trimite start, end și blockedAreas către GraphHopper

        System.out.println("Calculăm ruta pentru profilul: " + profile + ". Obstacole de evitat: " + blockedAreas.size());

        // Returnăm date mockuite (false) pentru ca Persoana D să poată construi UI-ul
        return new RouteResponse(null, 1500.5, 600.0);
    }
}