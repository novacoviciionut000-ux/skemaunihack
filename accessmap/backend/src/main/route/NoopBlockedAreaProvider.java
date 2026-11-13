package com.accessmap.route;

import java.util.List;

public class NoopBlockedAreaProvider implements BlockedAreaProvider {
    @Override
    public List<BlockedArea> getBlockedAreas() {
        return List.of();
    }
}