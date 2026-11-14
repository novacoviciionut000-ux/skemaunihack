package com.accessmap.help;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class DeedPointsTest {

    private final Instant t0 = Instant.parse("2026-01-01T10:00:00Z");

    @Test
    void fastNearbyFirstTryDeed() {
        var b = DeedPoints.compute(t0, t0.plusSeconds(40), 300, 0);
        assertEquals(50, b.base());
        assertEquals(25, b.speed());
        assertEquals(6, b.distance());
        assertEquals(10, b.firstTry());
        assertEquals(91, b.total());
    }

    @Test
    void slowFarDeedAfterARejection() {
        var b = DeedPoints.compute(t0, t0.plusSeconds(150), 10_000, 2);
        assertEquals(10, b.speed(), "accepted within 3 minutes");
        assertEquals(50, b.distance(), "distance bonus is capped");
        assertEquals(0, b.firstTry());
        assertEquals(DeedPoints.compute(t0, t0.plusSeconds(600), 0, 1).total(), 50, "just the base");
    }

    @Test
    void levels() {
        assertEquals("Începător", DeedPoints.level(0));
        assertEquals("Bronz", DeedPoints.level(50));
        assertEquals("Argint", DeedPoints.level(200));
        assertEquals("Înger păzitor", DeedPoints.level(9999));
        assertEquals(200, DeedPoints.nextLevelAt(120));
        assertEquals(0, DeedPoints.nextLevelAt(3000));
    }
}
