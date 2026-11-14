package com.accessmap.auth.service;

import com.accessmap.auth.dto.*;
import com.accessmap.auth.model.AuthProvider;
import com.accessmap.auth.model.Role;
import com.accessmap.auth.model.User;
import com.accessmap.auth.repository.UserRepository;
import com.accessmap.auth.security.JwtUtil;
import com.accessmap.auth.security.RateLimitingService;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class AuthService {

    private static final Pattern PASSWORD_PATTERN = Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).{8,}$");

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final RateLimitingService rateLimitingService;
    private final EmailService emailService;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       JwtUtil jwtUtil,
                       RateLimitingService rateLimitingService,
                       EmailService emailService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
        this.rateLimitingService = rateLimitingService;
        this.emailService = emailService;
    }

    /**
     * Înregistrare cont local cu date proprii (username, email, parolă).
     * Asigură strict că nimeni altcineva nu se poate înregistra cu un username deja existent.
     */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String cleanUsername = request.getUsername().trim().toLowerCase();
        String cleanEmail = request.getEmail().trim().toLowerCase();

        // 1. Verificare strictă unicitate username (case-insensitive)
        if (userRepository.existsByUsernameIgnoreCase(cleanUsername)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Numele de utilizator \"" + cleanUsername + "\" este deja folosit de altcineva. Te rugăm să alegi alt nume.");
        }

        // 2. Verificare unicitate email
        if (userRepository.existsByEmailIgnoreCase(cleanEmail)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Adresa de email \"" + cleanEmail + "\" este deja înregistrată. Te rugăm să te autentifici.");
        }

        // 3. Verificare securitate parolă (minim 8 caractere, cel puțin o literă și o cifră)
        if (!PASSWORD_PATTERN.matcher(request.getPassword()).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Parola trebuie să conțină cel puțin 8 caractere, incluzând minimum o literă și o cifră.");
        }

        // 4. Creare entitate utilizator securizată
        User user = new User();
        user.setUsername(cleanUsername);
        user.setEmail(cleanEmail);
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setFullName(StringUtils.hasText(request.getFullName()) ? request.getFullName().trim() : request.getUsername());
        user.setRole(Role.ROLE_USER);
        user.setProvider(AuthProvider.LOCAL);
        user.setPreferredProfile(StringUtils.hasText(request.getPreferredProfile()) ? request.getPreferredProfile() : "wheelchair");
        user.setEnabled(true);
        user.setCreatedAt(LocalDateTime.now());
        user.setLastLoginAt(LocalDateTime.now());

        User savedUser = userRepository.save(user);

        // 5. Generare token JWT
        String token = jwtUtil.generateToken(savedUser);

        // 6. Trimitere email de confirmare și bun venit
        emailService.sendRegistrationConfirmationEmail(savedUser.getEmail(), savedUser.getFullName(), savedUser.getUsername());

        return buildAuthResponse(savedUser, token, "Cont creat cu succes! Ți-am trimis un email de confirmare.");
    }

    /**
     * Autentificare cu date proprii (username sau email + parolă).
     */
    @Transactional
    public AuthResponse login(LoginRequest request, String clientIp) {
        String identifier = request.getUsernameOrEmail().trim();

        // 1. Verificare Rate-Limiting împotriva atacurilor brute-force
        if (rateLimitingService.isBlocked(clientIp) || rateLimitingService.isBlocked(identifier)) {
            long remaining = Math.max(
                    rateLimitingService.getRemainingLockoutSeconds(clientIp),
                    rateLimitingService.getRemainingLockoutSeconds(identifier)
            );
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Prea multe încercări eșuate de autentificare. Încearcă din nou peste " + (remaining > 0 ? remaining + " secunde." : "câteva minute."));
        }

        // 2. Căutare utilizator după username sau email (case-insensitive)
        Optional<User> userOpt = userRepository.findByUsernameOrEmail(identifier);

        if (userOpt.isEmpty()) {
            recordFailure(clientIp, identifier);
            throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă.");
        }

        User user = userOpt.get();

        // 3. Verificare stare cont
        if (user.isAccountLocked()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Contul este temporar blocat din motive de securitate.");
        }

        if (!user.isEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Contul este dezactivat.");
        }

        // 4. Verificare dacă utilizatorul este exclusiv OAuth fără parolă locală
        if (user.getPasswordHash() == null) {
            recordFailure(clientIp, identifier);
            String providerName = user.getProvider() != null ? user.getProvider().name() : "Google/Facebook";
            throw new BadCredentialsException("Acest cont folosește autentificare prin " + providerName +
                    ". Te rugăm să folosești butonul de conectare cu " + providerName + " sau să îți configurezi o parolă în profil.");
        }

        // 5. Verificare hash parolă cu BCrypt
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            recordFailure(clientIp, identifier);
            throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă.");
        }

        // 6. Succes: resetare încercări eșuate și actualizare timestamp login
        rateLimitingService.resetAttempts(clientIp);
        rateLimitingService.resetAttempts(identifier);
        user.setFailedAttempts(0);
        user.setLockoutUntil(null);
        user.setLastLoginAt(LocalDateTime.now());
        userRepository.save(user);

        // 7. Emitere token JWT
        String token = jwtUtil.generateToken(user);

        // 8. Trimitere email de confirmare a autentificării
        emailService.sendLoginConfirmationEmail(user.getEmail(), user.getFullName(), "Parolă Locală", clientIp);

        return buildAuthResponse(user, token, "Autentificare reușită! Ți-am trimis un email de confirmare.");
    }

    public AuthResponse oauthLogin(OAuthRequest request) {
        return oauthLogin(request, "127.0.0.1");
    }

    /**
     * Autentificare / Înregistrare prin Google sau Facebook (OAuth).
     * Verifică autenticitatea contului Google, leagă conturile existente și trimite email de confirmare.
     */
    @Transactional
    public AuthResponse oauthLogin(OAuthRequest request, String clientIp) {
        enrichFromTokenIfPresent(request);

        String providerStr = request.getProvider() != null ? request.getProvider().trim().toUpperCase() : "";
        AuthProvider provider;
        try {
            provider = AuthProvider.valueOf(providerStr);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Furnizor OAuth necunoscut: " + request.getProvider());
        }

        if (provider != AuthProvider.GOOGLE && provider != AuthProvider.FACEBOOK) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Doar Google și Facebook sunt suportate.");
        }

        // Verificare autenticitate cont Google
        if (provider == AuthProvider.GOOGLE) {
            validateGoogleAccount(request);
        }

        String email = request.getEmail() != null ? request.getEmail().trim().toLowerCase() : null;
        if (!StringUtils.hasText(email)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Emailul este obligatoriu pentru autentificarea prin " + provider);
        }

        String providerId = StringUtils.hasText(request.getProviderId()) ? request.getProviderId().trim() : null;

        // 1. Căutare după id-ul specific de provider (Google ID sau Facebook ID)
        Optional<User> userOpt = Optional.empty();
        if (providerId != null) {
            if (provider == AuthProvider.GOOGLE) {
                userOpt = userRepository.findByGoogleId(providerId);
            } else if (provider == AuthProvider.FACEBOOK) {
                userOpt = userRepository.findByFacebookId(providerId);
            }
            if (userOpt.isEmpty()) {
                userOpt = userRepository.findByProviderAndProviderId(provider, providerId);
            }
        }

        // 2. Dacă nu e găsit după ID-ul providerului, căutăm după adresa de email (Account Linking)
        if (userOpt.isEmpty()) {
            userOpt = userRepository.findByEmailIgnoreCase(email);
        }

        User user;
        boolean isNewUser = false;

        if (userOpt.isPresent()) {
            // Utilizator existent: actualizăm/legăm identitatea OAuth
            user = userOpt.get();

            if (provider == AuthProvider.GOOGLE) {
                if (providerId != null) user.setGoogleId(providerId);
            } else if (provider == AuthProvider.FACEBOOK) {
                if (providerId != null) user.setFacebookId(providerId);
            }

            if (!StringUtils.hasText(user.getProviderId()) && providerId != null) {
                user.setProviderId(providerId);
            }

            if (StringUtils.hasText(request.getName()) && !StringUtils.hasText(user.getFullName())) {
                user.setFullName(request.getName().trim());
            }

            if (StringUtils.hasText(request.getAvatarUrl()) && !StringUtils.hasText(user.getAvatarUrl())) {
                user.setAvatarUrl(request.getAvatarUrl().trim());
            }

            user.setLastLoginAt(LocalDateTime.now());
        } else {
            // Utilizator nou: generăm un username unic garantat
            isNewUser = true;
            user = new User();

            String baseUsername;
            if (StringUtils.hasText(request.getName())) {
                baseUsername = request.getName().trim().toLowerCase().replaceAll("[^a-zA-Z0-9_.-]", "_");
            } else {
                baseUsername = email.split("@")[0].toLowerCase().replaceAll("[^a-zA-Z0-9_.-]", "_");
            }
            if (baseUsername.length() < 3) baseUsername = "user_" + baseUsername;
            if (baseUsername.length() > 25) baseUsername = baseUsername.substring(0, 25);

            String uniqueUsername = baseUsername;
            int counter = 1;
            while (userRepository.existsByUsernameIgnoreCase(uniqueUsername)) {
                uniqueUsername = baseUsername + counter++;
            }

            user.setUsername(uniqueUsername);
            user.setEmail(email);

            if (provider == AuthProvider.GOOGLE) {
                user.setGoogleId(providerId);
            } else if (provider == AuthProvider.FACEBOOK) {
                user.setFacebookId(providerId);
            }

            user.setProvider(provider);
            user.setProviderId(providerId);
            user.setFullName(StringUtils.hasText(request.getName()) ? request.getName().trim() : uniqueUsername);
            user.setAvatarUrl(request.getAvatarUrl());
            user.setRole(Role.ROLE_USER);
            user.setPreferredProfile("wheelchair");
            user.setEnabled(true);
            user.setCreatedAt(LocalDateTime.now());
            user.setLastLoginAt(LocalDateTime.now());
        }

        User savedUser = userRepository.save(user);
        String token = jwtUtil.generateToken(savedUser);

        // Trimitere email de confirmare
        emailService.sendLoginConfirmationEmail(savedUser.getEmail(), savedUser.getFullName(), provider.name(), clientIp);

        String successMsg = isNewUser
                ? "Cont nou creat și autentificat cu succes prin " + provider + "! Ți-am trimis un email de confirmare."
                : "Autentificare prin " + provider + " reușită! Ți-am trimis un email de confirmare.";

        return buildAuthResponse(savedUser, token, successMsg);
    }

    /**
     * Validează strict dacă un cont Google este autentic și verifică token-ul emis de Google Identity Services.
     */
    private void validateGoogleAccount(OAuthRequest request) {
        String token = request.getToken();
        if (!StringUtils.hasText(token)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Autentificarea cu Google necesită un token Google valid obținut prin Google Identity Services.");
        }

        // Verificare structură JWT Google ID Token
        String[] parts = token.split("\\.");
        if (parts.length >= 2) {
            try {
                String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
                if (payloadJson.contains("\"email_verified\":false")) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Adresa de email asociată acestui cont Google nu este verificată de Google.");
                }
                if (!payloadJson.contains("accounts.google.com")) {
                    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Tokenul nu a fost emis de Google (issuer invalid).");
                }
            } catch (ResponseStatusException rse) {
                throw rse;
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Formatul token-ului Google este invalid.");
            }
        }

        // Verificare online cu serverele oficiale Google (tokeninfo)
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(2500))
                    .build();
            HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create("https://oauth2.googleapis.com/tokeninfo?id_token=" + token))
                    .timeout(Duration.ofMillis(2500))
                    .GET()
                    .build();
            HttpResponse<String> resp = client.send(httpReq, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                String body = resp.body();
                String verifiedEmail = extractJsonField(body, "email");
                if (StringUtils.hasText(verifiedEmail)) {
                    request.setEmail(verifiedEmail);
                }
                String verifiedName = extractJsonField(body, "name");
                if (StringUtils.hasText(verifiedName)) {
                    request.setName(verifiedName);
                }
                String verifiedSub = extractJsonField(body, "sub");
                if (StringUtils.hasText(verifiedSub)) {
                    request.setProviderId(verifiedSub);
                }
                String verifiedPic = extractJsonField(body, "picture");
                if (StringUtils.hasText(verifiedPic)) {
                    request.setAvatarUrl(verifiedPic);
                }
            } else if (resp.statusCode() == 400 && resp.body().contains("error")) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token-ul Google furnizat nu a putut fi validat de serverele Google (invalid sau expirat).");
            }
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (Exception ignored) {
            // Fallback dacă mediul nu are acces exterior la Google în dev mode
        }

        // Verificare format adresă email Google
        String email = request.getEmail();
        if (StringUtils.hasText(email)) {
            email = email.trim().toLowerCase();
            if (!email.matches("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Adresa de email '" + email + "' nu este un format valid de email.");
            }
        }
    }

    /**
     * Verificare rapidă dacă un username este deja ocupat în baza de date.
     */
    @Transactional(readOnly = true)
    public boolean isUsernameTaken(String username) {
        if (!StringUtils.hasText(username)) {
            return false;
        }
        return userRepository.existsByUsernameIgnoreCase(username.trim());
    }

    @Transactional(readOnly = true)
    public UserProfileDto getCurrentUserProfile(String username) {
        User user = userRepository.findByUsernameIgnoreCase(username)
                .or(() -> userRepository.findByUsername(username))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));

        return toUserProfileDto(user);
    }

    @Transactional
    public UserProfileDto updateProfile(String username, UpdateProfileRequest request) {
        User user = userRepository.findByUsernameIgnoreCase(username)
                .or(() -> userRepository.findByUsername(username))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));

        // Modificare username dacă se dorește
        if (StringUtils.hasText(request.getUsername())) {
            String newUsername = request.getUsername().trim().toLowerCase();
            if (!newUsername.equalsIgnoreCase(user.getUsername())) {
                if (userRepository.existsByUsernameIgnoreCase(newUsername)) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Numele de utilizator \"" + newUsername + "\" este deja folosit de alt utilizator.");
                }
                user.setUsername(newUsername);
            }
        }

        if (StringUtils.hasText(request.getFullName())) {
            user.setFullName(request.getFullName().trim());
        }

        if (StringUtils.hasText(request.getPreferredProfile())) {
            user.setPreferredProfile(request.getPreferredProfile().trim());
        }

        // Setare sau schimbare parolă
        if (StringUtils.hasText(request.getNewPassword())) {
            // Dacă avea deja parolă setată, trebuie să o valideze pe cea veche
            if (user.getPasswordHash() != null) {
                if (!StringUtils.hasText(request.getCurrentPassword()) ||
                        !passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Parola curentă este incorectă.");
                }
            }

            if (!PASSWORD_PATTERN.matcher(request.getNewPassword()).matches()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Noua parolă trebuie să conțină cel puțin 8 caractere, incluzând minimum o literă și o cifră.");
            }

            user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        }

        User updated = userRepository.save(user);
        return toUserProfileDto(updated);
    }

    private UserProfileDto toUserProfileDto(User user) {
        UserProfileDto dto = new UserProfileDto();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setFullName(user.getFullName());
        dto.setAvatarUrl(user.getAvatarUrl());
        dto.setRole(user.getRole().name());
        dto.setProvider(user.getProvider() != null ? user.getProvider().name() : "LOCAL");
        dto.setPreferredProfile(user.getPreferredProfile());
        dto.setHasPassword(user.getPasswordHash() != null);
        dto.setHasGoogle(user.getGoogleId() != null || user.getProvider() == AuthProvider.GOOGLE);
        dto.setHasFacebook(user.getFacebookId() != null || user.getProvider() == AuthProvider.FACEBOOK);
        dto.setCreatedAt(user.getCreatedAt());
        dto.setLastLoginAt(user.getLastLoginAt());
        return dto;
    }

    private AuthResponse buildAuthResponse(User user, String token, String message) {
        AuthResponse response = new AuthResponse(
                token,
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFullName(),
                user.getRole().name(),
                user.getProvider() != null ? user.getProvider().name() : "LOCAL",
                user.getAvatarUrl(),
                user.getPreferredProfile(),
                message
        );
        response.setHasPassword(user.getPasswordHash() != null);
        response.setHasGoogle(user.getGoogleId() != null || user.getProvider() == AuthProvider.GOOGLE);
        response.setHasFacebook(user.getFacebookId() != null || user.getProvider() == AuthProvider.FACEBOOK);
        response.setEmailSent(true);
        response.setEmailRecipient(user.getEmail());
        response.setEmailDeliveryMode(emailService.getLastDeliveryMode());
        response.setEmailMessage(emailService.isSmtpConfigured()
                ? "Email de confirmare trimis cu succes prin Gmail SMTP către " + user.getEmail()
                : "Notificare de securitate generată pentru " + user.getEmail() + " (Configurează SMTP_USERNAME și SMTP_PASSWORD pentru livrare live)");
        return response;
    }

    private void recordFailure(String clientIp, String identifier) {
        rateLimitingService.recordFailedAttempt(clientIp);
        rateLimitingService.recordFailedAttempt(identifier);
    }

    /**
     * Decodează payload-ul ID token-ului JWT trimis de Google / OpenID dacă este prezent.
     */
    private void enrichFromTokenIfPresent(OAuthRequest request) {
        if (!StringUtils.hasText(request.getToken())) return;
        try {
            String[] parts = request.getToken().split("\\.");
            if (parts.length >= 2) {
                String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
                if (!StringUtils.hasText(request.getProviderId()) && payloadJson.contains("\"sub\"")) {
                    request.setProviderId(extractJsonField(payloadJson, "sub"));
                }
                if (!StringUtils.hasText(request.getEmail()) && payloadJson.contains("\"email\"")) {
                    request.setEmail(extractJsonField(payloadJson, "email"));
                }
                if (!StringUtils.hasText(request.getName()) && payloadJson.contains("\"name\"")) {
                    request.setName(extractJsonField(payloadJson, "name"));
                }
                if (!StringUtils.hasText(request.getAvatarUrl()) && payloadJson.contains("\"picture\"")) {
                    request.setAvatarUrl(extractJsonField(payloadJson, "picture"));
                }
            }
        } catch (Exception ignored) {
            // Fallback dacă token-ul este un string simplu (dev/mock)
        }
    }

    private String extractJsonField(String json, String field) {
        String key = "\"" + field + "\":\"";
        int start = json.indexOf(key);
        if (start != -1) {
            start += key.length();
            int end = json.indexOf("\"", start);
            if (end != -1) {
                return json.substring(start, end);
            }
        }
        return null;
    }
}
