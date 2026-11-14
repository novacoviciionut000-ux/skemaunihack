package com.accessmap.auth.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * The login JWT lives in an HttpOnly cookie instead of localStorage, so injected JavaScript
 * can't read or steal it. SameSite=Strict keeps other sites from sending it (CSRF).
 */
@Component
public class SessionCookie {

    public static final String NAME = "accessmap_session";

    private final Duration maxAge;

    public SessionCookie(@Value("${jwt.expiration-ms:86400000}") long expirationMs) {
        this.maxAge = Duration.ofMillis(expirationMs);
    }

    public void set(HttpServletRequest request, HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, build(request, token, maxAge).toString());
    }

    public void clear(HttpServletRequest request, HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, build(request, "", Duration.ZERO).toString());
    }

    public static String read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (NAME.equals(c.getName())) return c.getValue();
        }
        return null;
    }

    private static ResponseCookie build(HttpServletRequest request, String value, Duration age) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                // Secure on HTTPS (e.g. the Cloudflare tunnel); plain http on LAN/localhost still works
                .secure(isHttps(request))
                .sameSite("Strict")
                .path("/api")
                .maxAge(age)
                .build();
    }

    private static boolean isHttps(HttpServletRequest request) {
        if (request.isSecure()) return true;
        String proto = request.getHeader("X-Forwarded-Proto");
        return proto != null && proto.trim().toLowerCase().startsWith("https");
    }
}
