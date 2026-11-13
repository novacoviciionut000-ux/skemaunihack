package com.accessmap.route;

import com.accessmap.common.Coordinate; // Asigurați-vă că aveți clasa Coordinate cu lat și lon
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class RouteResponse {
    private List<Coordinate> path;
    private double distanceMeters;
    private double timeSeconds;
}