package com.accessmap.help;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Client:    POST /api/help, GET /api/help/active, POST /api/help/{id}/cancel, POST /api/help/{id}/confirm
 * Volunteer: POST /api/volunteers/presence, POST /api/help/{id}/accept|release|finish
 * Everyone:  GET /api/volunteers/leaderboard
 * All endpoints require a logged-in user (see SecurityConfig).
 */
@RestController
public class HelpController {

    private final HelpService service;

    public HelpController(HelpService service) {
        this.service = service;
    }

    public record LocationBody(
            @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
            @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
            @Size(max = 200) String note) {}

    public record PresenceBody(
            @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
            @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
            boolean onDuty) {}

    public record ConfirmBody(@NotNull Boolean completed) {}

    // ─── Client ────────────────────────────────────────────────────────────────

    @PostMapping("/api/help")
    public ResponseEntity<HelpService.ClientView> create(@Valid @RequestBody LocationBody body, Authentication auth) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(service.createRequest(name(auth), body.latitude(), body.longitude(), body.note()));
    }

    @GetMapping("/api/help/active")
    public Map<String, Object> active(Authentication auth) {
        Map<String, Object> out = new HashMap<>();
        out.put("asClient", service.clientActive(name(auth)));
        return out;
    }

    @PostMapping("/api/help/{id}/cancel")
    public HelpService.ClientView cancel(@PathVariable Long id, Authentication auth) {
        return service.cancel(name(auth), id);
    }

    @PostMapping("/api/help/{id}/confirm")
    public HelpService.ClientView confirm(@PathVariable Long id, @Valid @RequestBody ConfirmBody body, Authentication auth) {
        return service.confirm(name(auth), id, body.completed());
    }

    // ─── Volunteer ─────────────────────────────────────────────────────────────

    @PostMapping("/api/volunteers/presence")
    public HelpService.PresenceView presence(@Valid @RequestBody PresenceBody body, Authentication auth) {
        return service.presence(name(auth), body.latitude(), body.longitude(), body.onDuty());
    }

    @PostMapping("/api/help/{id}/accept")
    public HelpService.JobView accept(@PathVariable Long id, Authentication auth) {
        return service.accept(name(auth), id);
    }

    @PostMapping("/api/help/{id}/release")
    public ResponseEntity<Void> release(@PathVariable Long id, Authentication auth) {
        service.release(name(auth), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/help/{id}/finish")
    public HelpService.JobView finish(@PathVariable Long id, Authentication auth) {
        return service.finish(name(auth), id);
    }

    @GetMapping("/api/volunteers/leaderboard")
    public List<HelpService.LeaderboardEntry> leaderboard() {
        return service.leaderboard();
    }

    // ─── Errors as JSON with a readable message (the apps speak it out loud) ──────

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handle(ResponseStatusException ex) {
        Map<String, Object> body = new HashMap<>();
        body.put("error", ex.getReason());
        body.put("status", ex.getStatusCode().value());
        return ResponseEntity.status(ex.getStatusCode()).body(body);
    }

    private static String name(Authentication auth) {
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Trebuie să fii autentificat.");
        }
        return auth.getName();
    }
}
