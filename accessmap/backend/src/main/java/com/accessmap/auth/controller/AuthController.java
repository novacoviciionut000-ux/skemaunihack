package com.accessmap.auth.controller;

import com.accessmap.auth.dto.*;
import com.accessmap.auth.service.AuthService;
import com.accessmap.auth.service.EmailService;
import com.accessmap.common.ClientIp;
import com.accessmap.auth.security.SessionCookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final EmailService emailService;

    @Value("${auth.oauth.google.client-id:mock-google-client-id}")
    private String googleClientId;

    private final SessionCookie sessionCookie;

    public AuthController(AuthService authService, EmailService emailService, SessionCookie sessionCookie) {
        this.authService = authService;
        this.emailService = emailService;
        this.sessionCookie = sessionCookie;
    }

    @GetMapping("/oauth-config")
    public ResponseEntity<Map<String, Object>> getOAuthConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("googleClientId", googleClientId);
        config.put("googleConfigured", !googleClientId.equals("mock-google-client-id"));
        config.put("mailConfigured", emailService.isSmtpConfigured());
        return ResponseEntity.ok(config);
    }

    /**
     * Sends a test email to the logged-in user's own address. It used to be public and accept
     * any recipient, which turned the app's Gmail account into an open spam relay.
     */
    @PostMapping("/test-email")
    public ResponseEntity<Map<String, Object>> testEmail() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String toEmail = authService.getCurrentUserProfile(auth.getName()).getEmail();
        boolean success = emailService.sendTestEmail(toEmail);
        Map<String, Object> resp = new HashMap<>();
        resp.put("success", success);
        resp.put("recipient", toEmail);
        resp.put("deliveryMode", emailService.getLastDeliveryMode());
        resp.put("message", emailService.isSmtpConfigured()
                ? "Email de test trimis către " + toEmail
                : "SMTP nu este configurat; emailul de test a fost doar logat local.");
        return ResponseEntity.ok(resp);
    }

    @GetMapping("/check-username")
    public ResponseEntity<Map<String, Object>> checkUsername(@RequestParam(value = "username", required = false) String username) {
        Map<String, Object> result = new HashMap<>();
        if (!org.springframework.util.StringUtils.hasText(username)) {
            result.put("available", false);
            result.put("username", "");
            result.put("message", "Numele de utilizator este obligatoriu.");
            return ResponseEntity.ok(result);
        }

        String clean = username.trim().toLowerCase();
        if (clean.length() < 3 || clean.length() > 30) {
            result.put("available", false);
            result.put("username", clean);
            result.put("message", "Numele de utilizator trebuie să aibă între 3 și 30 de caractere.");
            return ResponseEntity.ok(result);
        }

        if (!clean.matches("^[a-zA-Z0-9_.-]+$")) {
            result.put("available", false);
            result.put("username", clean);
            result.put("message", "Numele de utilizator poate conține doar litere, cifre, punct, linie și underscore.");
            return ResponseEntity.ok(result);
        }

        boolean taken = authService.isUsernameTaken(clean);
        result.put("available", !taken);
        result.put("username", clean);
        result.put("message", taken
                ? "Numele de utilizator \"" + clean + "\" este deja folosit de altcineva."
                : "Numele de utilizator \"" + clean + "\" este disponibil!");
        return ResponseEntity.ok(result);
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request,
                                                 HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        AuthResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(startSession(response, httpRequest, httpResponse));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request,
                                              HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        AuthResponse response = authService.login(request, extractClientIp(httpRequest));
        return ResponseEntity.ok(startSession(response, httpRequest, httpResponse));
    }

    @PostMapping("/oauth")
    public ResponseEntity<AuthResponse> oauthLogin(@Valid @RequestBody OAuthRequest request,
                                                   HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        AuthResponse response = authService.oauthLogin(request, extractClientIp(httpRequest));
        return ResponseEntity.ok(startSession(response, httpRequest, httpResponse));
    }

    @PostMapping("/oauth/{provider}")
    public ResponseEntity<AuthResponse> oauthLoginWithProvider(
            @PathVariable String provider,
            @Valid @RequestBody OAuthRequest request,
            HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        request.setProvider(provider);
        AuthResponse response = authService.oauthLogin(request, extractClientIp(httpRequest));
        return ResponseEntity.ok(startSession(response, httpRequest, httpResponse));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        sessionCookie.clear(httpRequest, httpResponse);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public ResponseEntity<UserProfileDto> getCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        String username = auth.getName();
        UserProfileDto profile = authService.getCurrentUserProfile(username);
        return ResponseEntity.ok(profile);
    }

    @PutMapping("/profile")
    public ResponseEntity<UserProfileDto> updateProfile(@Valid @RequestBody UpdateProfileRequest request,
                                                        HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        UserProfileDto updated = authService.updateProfile(auth.getName(), request);
        // The token is keyed on the username; re-issue it so a renamed user stays logged in
        sessionCookie.set(httpRequest, httpResponse, authService.issueToken(updated.getUsername()));
        return ResponseEntity.ok(updated);
    }

    /** Puts the JWT in the HttpOnly cookie and strips it from the JSON body. */
    private AuthResponse startSession(AuthResponse response, HttpServletRequest req, HttpServletResponse res) {
        sessionCookie.set(req, res, response.getToken());
        response.setToken(null);
        return response;
    }

    // Gestionare unificată a erorilor pentru răspunsuri JSON curate
    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<Map<String, Object>> handleBadCredentials(BadCredentialsException ex) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", HttpStatus.UNAUTHORIZED.value());
        body.put("error", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(body);
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException ex) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", ex.getStatusCode().value());
        body.put("error", ex.getReason());
        return ResponseEntity.status(ex.getStatusCode()).body(body);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidationExceptions(MethodArgumentNotValidException ex) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", HttpStatus.BAD_REQUEST.value());

        FieldError fieldError = ex.getBindingResult().getFieldError();
        String message = fieldError != null ? fieldError.getDefaultMessage() : "Date de intrare invalide.";
        body.put("error", message);

        Map<String, String> fieldErrors = new HashMap<>();
        for (FieldError err : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.put(err.getField(), err.getDefaultMessage());
        }
        body.put("fields", fieldErrors);

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    private String extractClientIp(HttpServletRequest request) {
        return ClientIp.resolve(request);
    }
}
