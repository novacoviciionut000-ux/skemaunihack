package com.accessmap.route;

import com.accessmap.common.Coordinate;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;

@Component
public class NoopBlockedAreaProvider implements BlockedAreaProvider {
    @Override
    public List<Coordinate> getActiveBlockedAreas() {
        // Returnăm o listă goală până când Persoana B face legătura cu baza de date
        return Collections.emptyList();
    }
}