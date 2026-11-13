package com.accessmap.route;

import com.accessmap.common.Coordinate;
import java.util.List;

public interface BlockedAreaProvider {
    // Va returna o listă de zone (puncte/poligoane) pe care GraphHopper trebuie să le ocolească
    List<Coordinate> getActiveBlockedAreas();
}