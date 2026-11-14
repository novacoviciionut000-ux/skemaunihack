package com.accessmap.auth.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RateLimitingService {

    private final int maxAttempts;
    private final long lockoutDurationSeconds;

    // Cheie: IP sau username -> Număr de încercări eșuate + timestamp expirare
    private final Map<String, AttemptInfo> attemptsCache = new ConcurrentHashMap<>();

    public RateLimitingService(
            @Value("${auth.rate-limit.max-attempts:5}") int maxAttempts,
            @Value("${auth.rate-limit.lockout-duration-minutes:15}") int lockoutMinutes) {
        this.maxAttempts = maxAttempts;
        this.lockoutDurationSeconds = (long) lockoutMinutes * 60;
    }

    public boolean isBlocked(String key) {
        cleanUp();
        AttemptInfo info = attemptsCache.get(key);
        if (info == null) {
            return false;
        }
        if (info.isLocked()) {
            if (Instant.now().isBefore(info.lockedUntil)) {
                return true;
            } else {
                // A expirat blocarea
                attemptsCache.remove(key);
                return false;
            }
        }
        return false;
    }

    public void recordFailedAttempt(String key) {
        recordFailedAttempt(key, maxAttempts);
    }

    /** Same as {@link #recordFailedAttempt(String)} but with a custom lock threshold for this key. */
    public void recordFailedAttempt(String key, int threshold) {
        cleanUp();
        attemptsCache.compute(key, (k, current) -> {
            Instant now = Instant.now();
            if (current == null || current.isWindowExpired(now)) {
                return new AttemptInfo(1, now.plusSeconds(300), null); // fereastră de 5 minute
            }

            int count = current.count + 1;
            Instant lockedUntil = current.lockedUntil;
            if (count >= threshold) {
                lockedUntil = now.plusSeconds(lockoutDurationSeconds);
            }
            return new AttemptInfo(count, current.windowExpiry, lockedUntil);
        });
    }

    public void resetAttempts(String key) {
        attemptsCache.remove(key);
    }

    public long getRemainingLockoutSeconds(String key) {
        AttemptInfo info = attemptsCache.get(key);
        if (info != null && info.lockedUntil != null) {
            long remaining = info.lockedUntil.getEpochSecond() - Instant.now().getEpochSecond();
            return Math.max(0, remaining);
        }
        return 0;
    }

    private void cleanUp() {
        if (attemptsCache.size() > 500) {
            Instant now = Instant.now();
            attemptsCache.entrySet().removeIf(entry -> {
                AttemptInfo info = entry.getValue();
                boolean lockExpired = info.lockedUntil == null || now.isAfter(info.lockedUntil);
                boolean windowExpired = now.isAfter(info.windowExpiry);
                return lockExpired && windowExpired;
            });
        }
    }

    private static class AttemptInfo {
        final int count;
        final Instant windowExpiry;
        final Instant lockedUntil;

        AttemptInfo(int count, Instant windowExpiry, Instant lockedUntil) {
            this.count = count;
            this.windowExpiry = windowExpiry;
            this.lockedUntil = lockedUntil;
        }

        boolean isLocked() {
            return lockedUntil != null;
        }

        boolean isWindowExpired(Instant now) {
            return now.isAfter(windowExpiry);
        }
    }
}
