package com.accessmap.route;

import com.accessmap.common.Coordinate;
import java.util.List;

public record RouteResponse(List<Coordinate> path, double distanceMeters, double timeSeconds) {}