package com.accessmap.crossing;

/**
 * A pedestrian crossing taken from OpenStreetMap.
 *
 * Whether the crossing has signals is the part that changes what a blind user must do:
 * at an unsignalled crossing there is no light to wait for and traffic has to be judged
 * by ear. When the OSM tags do not say, the flags stay false and the client says only
 * "trecere de pietoni" rather than claiming either way.
 */
public record Crossing(
        String id,
        double lat,
        double lng,
        boolean hasSignals,
        boolean hasMarkings,
        boolean hasTactilePaving,
        /** "signals", "none" or "unknown" */
        String kind
) {
}
