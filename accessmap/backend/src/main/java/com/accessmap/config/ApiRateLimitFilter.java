package com.accessmap.config;

import com.accessmap.common.ClientIp;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Per-IP request limits for public endpoints that cost money (Google Maps geocoding),
 * proxy third parties (TTS, routing) or create data (reports, accounts).
 * Fixed one-minute windows, in memory; enough for a single-instance deployment.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private record Rule(String name, String method, String prefix, int perMinute) {
        boolean matches(HttpServletRequest req) {
            return (method == null || method.equalsIgnoreCase(req.getMethod()))
                    && req.getRequestURI().startsWith(prefix);
        }
    }

    private static final List<Rule> RULES = List.of(
            new Rule("tts", "GET", "/api/v1/tts", 60),
            new Rule("route", "GET", "/api/v1/route", 30),
            new Rule("geocode", null, "/api/geocode", 60),
            // Crossings are cached server-side and fetched once per route, so a device
            // needs very few: a high count here only exists to stop a loop hammering it
            new Rule("crossings", "GET", "/api/crossings", 30),
            new Rule("report", "POST", "/api/reports", 20),
            new Rule("register", "POST", "/api/auth/register", 5)
    );

    private static final int MAX_TRACKED_KEYS = 50_000;

    private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
    private volatile long windowStart = System.currentTimeMillis();

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Rule rule = null;
        for (Rule r : RULES) {
            if (r.matches(request)) {
                rule = r;
                break;
            }
        }
        if (rule == null) {
            chain.doFilter(request, response);
            return;
        }

        long now = System.currentTimeMillis();
        if (now - windowStart >= 60_000 || counts.size() > MAX_TRACKED_KEYS) {
            synchronized (this) {
                if (now - windowStart >= 60_000 || counts.size() > MAX_TRACKED_KEYS) {
                    counts.clear();
                    windowStart = now;
                }
            }
        }

        String key = rule.name() + ":" + ClientIp.resolve(request);
        int used = counts.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet();
        if (used > rule.perMinute()) {
            long retryAfter = Math.max(1, (60_000 - (now - windowStart)) / 1000);
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(retryAfter));
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"error\":\"Prea multe cereri. Încearcă din nou în câteva secunde.\",\"status\":429}");
            return;
        }
        chain.doFilter(request, response);
    }
}
