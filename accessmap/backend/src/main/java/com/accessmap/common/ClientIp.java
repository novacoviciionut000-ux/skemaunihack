package com.accessmap.common;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Resolves the caller's IP for rate limiting.
 *
 * Forwarding headers are only trusted when the request arrives from a local proxy
 * (Vite dev server or cloudflared on the same machine). Otherwise any client could send
 * a fake X-Forwarded-For header and get a fresh rate-limit bucket on every request.
 */
public final class ClientIp {

    private ClientIp() {}

    public static String resolve(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        if (!isLoopback(remote)) {
            return remote;
        }
        // Set by Cloudflare itself; clients cannot override it through the tunnel
        String cf = request.getHeader("CF-Connecting-IP");
        if (cf != null && !cf.isBlank()) {
            return cf.trim();
        }
        // The last entry is the one appended by the nearest (trusted, local) proxy;
        // earlier entries are client-controlled.
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] parts = xff.split(",");
            for (int i = parts.length - 1; i >= 0; i--) {
                String candidate = parts[i].trim();
                if (!candidate.isEmpty() && !isLoopback(candidate)) {
                    return candidate;
                }
            }
        }
        return remote;
    }

    private static boolean isLoopback(String ip) {
        return ip != null && (ip.startsWith("127.") || ip.equals("::1") || ip.equals("0:0:0:0:0:0:0:1"));
    }
}
