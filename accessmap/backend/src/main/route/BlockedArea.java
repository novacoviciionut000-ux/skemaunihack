package com.accessmap.route;

/** Zonă blocată circulară: centru (lat, lng) + rază în metri. */
public record BlockedArea(double lat, double lng, double radiusMeters) {

    public static final double DEFAULT_RADIUS_METERS = 10.0;

    public BlockedArea {
        if (radiusMeters <= 0) {
            radiusMeters = DEFAULT_RADIUS_METERS;
        }
    }

    /** Format GraphHopper pentru block_area: "lat,lon,raza". */
    public String toGraphHopperParam() {
        return lat + "," + lng + "," + radiusMeters;
    }
}