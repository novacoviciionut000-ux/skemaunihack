package com.accessmap.geocode;

import com.accessmap.common.Coordinate;

/** coordinate = null dacă adresa nu a fost găsită */
public record GeocodeResult(String query, String displayName, Coordinate coordinate) {}