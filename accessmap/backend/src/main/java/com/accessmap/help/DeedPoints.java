package com.accessmap.help;

import java.time.Duration;
import java.time.Instant;

/**
 * Points for a confirmed good deed, and the volunteer level they add up to.
 *
 *   base                          50
 *   fast answer   (<= 1 min)     +25   (<= 3 min: +10)
 *   distance      1 per 50 m     +50 max, from where the volunteer accepted
 *   first try     (client said yes the first time)  +10
 */
public final class DeedPoints {

    public static final int BASE = 50;
    public static final int FAST_BONUS = 25;
    public static final int QUICK_BONUS = 10;
    public static final int MAX_DISTANCE_BONUS = 50;
    public static final int FIRST_TRY_BONUS = 10;

    private DeedPoints() {}

    public record Breakdown(int base, int speed, int distance, int firstTry) {
        public int total() { return base + speed + distance + firstTry; }
    }

    public static Breakdown compute(Instant createdAt, Instant acceptedAt, double travelMeters, int rejectedCount) {
        int speed = 0;
        if (createdAt != null && acceptedAt != null) {
            long seconds = Duration.between(createdAt, acceptedAt).getSeconds();
            if (seconds <= 60) speed = FAST_BONUS;
            else if (seconds <= 180) speed = QUICK_BONUS;
        }
        int distance = (int) Math.min(MAX_DISTANCE_BONUS, Math.max(0, Math.floor(travelMeters / 50.0)));
        int firstTry = rejectedCount == 0 ? FIRST_TRY_BONUS : 0;
        return new Breakdown(BASE, speed, distance, firstTry);
    }

    /** Level names in Romanian, shown in the app. */
    public static String level(int points) {
        if (points >= 2500) return "Înger păzitor";
        if (points >= 1000) return "Platină";
        if (points >= 500) return "Aur";
        if (points >= 200) return "Argint";
        if (points >= 50) return "Bronz";
        return "Începător";
    }

    /** Points needed for the next level, or 0 at the top. */
    public static int nextLevelAt(int points) {
        int[] steps = {50, 200, 500, 1000, 2500};
        for (int s : steps) if (points < s) return s;
        return 0;
    }

    /** Great-circle distance in meters. */
    public static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double r = 6_371_000;
        double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2);
        double dp = Math.toRadians(lat2 - lat1), dl = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
