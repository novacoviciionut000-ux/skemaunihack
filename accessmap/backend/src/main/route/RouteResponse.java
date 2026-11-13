package com.accessmap.route;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.accessmap.common.Coordinate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class RouteResponse {
    private List<Coordinate> path;
    private double distanceMeters;
    private double timeSeconds;
}