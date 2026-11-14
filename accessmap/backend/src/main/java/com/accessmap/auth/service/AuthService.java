package com.accessmap.auth.service;

import com.accessmap.auth.dto.*;
import com.accessmap.auth.model.AuthProvider;
import com.accessmap.auth.model.Role;
import com.accessmap.auth.model.User;
import com.accessmap.auth.repository.UserRepository;
import com.accessmap.auth.security.JwtUtil;
import com.accessmap.auth.security.RateLimitingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class AuthService {

    private static final Pattern PASSWORD_PATTERN = Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).{8,}$");
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[a-zA-Z0-9_.-]{3,30}$");
    private static final String MOCK_GOOGLE_CLIENT_ID = "mock-google-client-id";
    private static final int MAX_FAILURES_PER_IP = 20;
    private static final int MAX_FAILURES_PER_ACCOUNT = 100;


    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

    @Value("${auth.oauth.google.client-id:}")
    private String googleClientId;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final RateLimitingService rateLimitingService;
    private final String dummyPasswordHash;
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
        // Real hash of a random value, compared against for unknown users to equalize timing
        this.dummyPasswordHash = passwordEncoder.encode(java.util.UUID.randomUUID().toString());
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
        String[] keys = rateLimitKeys(clientIp, identifier);

        // 1. Rate limiting. Keyed per IP+account, per IP and (with a high threshold) per account,
        // so an attacker can no longer lock a victim out with 5 wrong passwords.
        long remaining = 0;
        for (String key : keys) {
            if (rateLimitingService.isBlocked(key)) {
                remaining = Math.max(remaining, rateLimitingService.getRemainingLockoutSeconds(key));
            }
        }
        if (remaining > 0) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Prea multe încercări eșuate de autentificare. Încearcă din nou peste " + (remaining > 0 ? remaining + " secunde." : "câteva minute."));
        }

        // 2. Căutare utilizator după username sau email (case-insensitive)
        Optional<User> userOpt = userRepository.findByUsernameOrEmail(identifier);

        if (userOpt.isEmpty()) {
            // Same BCrypt cost as a real check, so response time doesn't reveal which accounts exist
            passwordEncoder.matches(request.getPassword(), dummyPasswordHash);
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
            passwordEncoder.matches(request.getPassword(), dummyPasswordHash);
            recordFailure(clientIp, identifier);
            // Generic message: revealing "this account uses Google" confirms the account exists
            throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă. "
                    + "Dacă ți-ai creat contul cu Google, folosește butonul Google.");
        }

        // 5. Verificare hash parolă cu BCrypt
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            recordFailure(clientIp, identifier);
            throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă.");
        }

        // 6. Succes: resetare încercări eșuate și actualizare timestamp login
        rateLimitingService.resetAttempts(keys[0]); // the IP+account pair
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
        String providerStr = request.getProvider() != null ? request.getProvider().trim().toUpperCase() : "";
        AuthProvider provider;
        try {
            provider = AuthProvider.valueOf(providerStr);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Furnizor OAuth necunoscut: " + request.getProvider());
        }

        // Only Google can be verified server-side. Facebook logins were accepted without any
        // verification, which let anyone obtain a token for any email address.
        if (provider != AuthProvider.GOOGLE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Doar autentificarea Google este suportată.");
        }

        // Identity (email, sub, name, picture) is taken ONLY from Google's verification response,
        // never from the request body.
        verifyGoogleToken(request);

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

            if (provider == AuthProvider.GOOGLE && providerId != null && !providerId.equals(user.getGoogleId())) {
                // First Google link to an account found by email. Local sign-ups don't verify the
                // email, so the existing password may belong to someone who pre-registered the
                // victim's address. Google just proved ownership; drop that password. The owner
                // can set a new one from the profile page.
                if (user.getGoogleId() == null && user.getPasswordHash() != null) {
                    user.setPasswordHash(null);
                }
                user.setGoogleId(providerId);
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
     * Verifies a Google ID token (JWT) or access token with Google's tokeninfo endpoint and
     * overwrites the request identity with the verified values. Fails closed: if Google cannot
     * confirm the token, was not issued for this app, or the email is unverified, login is refused.
     */
    private void verifyGoogleToken(OAuthRequest request) {
        String token = request.getToken() != null ? request.getToken().trim() : "";
        if (token.isEmpty() || token.length() > 4096) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Autentificarea cu Google necesită un token Google valid.");
        }
        if (!StringUtils.hasText(googleClientId) || MOCK_GOOGLE_CLIENT_ID.equals(googleClientId)) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Autentificarea Google nu este configurată pe server (GOOGLE_CLIENT_ID).");
        }

        boolean isIdToken = token.chars().filter(c -> c == '.').count() == 2;
        String param = isIdToken ? "id_token" : "access_token";
        JsonNode info;
        try {
            HttpRequest httpReq = HttpRequest.newBuilder()
                    .uri(URI.create("https://oauth2.googleapis.com/tokeninfo?" + param + "="
                            + URLEncoder.encode(token, StandardCharsets.UTF_8)))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> resp = HTTP.send(httpReq, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                        "Token-ul Google este invalid sau expirat.");
            }
            info = JSON.readTree(resp.body());
        } catch (ResponseStatusException rse) {
            throw rse;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Google nu a putut fi contactat.");
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Google nu a putut fi contactat.");
        }

        // The token must have been issued to OUR client, otherwise a token from any other
        // Google-enabled site could be replayed here.
        String aud = info.path("aud").asText("");
        String azp = info.path("azp").asText("");
        if (!googleClientId.equals(aud) && !googleClientId.equals(azp)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token-ul Google nu a fost emis pentru această aplicație.");
        }
        if (isIdToken) {
            String iss = info.path("iss").asText("");
            if (!"accounts.google.com".equals(iss) && !"https://accounts.google.com".equals(iss)) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Emitent token invalid.");
            }
        }

        String email = info.path("email").asText("");
        String sub = info.path("sub").asText("");
        boolean emailVerified = "true".equalsIgnoreCase(info.path("email_verified").asText(""));
        if (email.isEmpty() || sub.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Google nu a furnizat adresa de email (lipsește permisiunea email).");
        }
        if (!emailVerified) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Adresa de email a contului Google nu este verificată.");
        }

        request.setEmail(email);
        request.setProviderId(sub);
        // tokeninfo for access tokens has no name/picture; keep client values only as display data
        if (info.hasNonNull("name")) request.setName(info.get("name").asText());
        if (info.hasNonNull("picture")) request.setAvatarUrl(info.get("picture").asText());
        if (request.getName() != null && request.getName().length() > 100) {
            request.setName(request.getName().substring(0, 100));
        }
        String avatar = request.getAvatarUrl();
        if (avatar != null && (avatar.length() > 500 || !avatar.startsWith("https://"))) {
            request.setAvatarUrl(null);
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

    /** New session token for an existing user (e.g. after a username change). */
    @Transactional(readOnly = true)
    public String issueToken(String username) {
        User user = userRepository.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));
        return jwtUtil.generateToken(user);
    }

    @Transactional
    public UserProfileDto updateProfile(String username, UpdateProfileRequest request) {
        User user = userRepository.findByUsernameIgnoreCase(username)
                .or(() -> userRepository.findByUsername(username))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));

        // Modificare username dacă se dorește
        if (StringUtils.hasText(request.getUsername())) {
            String newUsername = request.getUsername().trim().toLowerCase();
            if (!USERNAME_PATTERN.matcher(newUsername).matches()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Numele de utilizator trebuie să aibă 3-30 caractere: litere, cifre, punct, linie sau underscore.");
            }
            if (!newUsername.equalsIgnoreCase(user.getUsername())) {
                if (userRepository.existsByUsernameIgnoreCase(newUsername)) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Numele de utilizator \"" + newUsername + "\" este deja folosit de alt utilizator.");
                }
                user.setUsername(newUsername);
            }
        }

        if (StringUtils.hasText(request.getFullName())) {
            String fullName = request.getFullName().trim();
            user.setFullName(fullName.length() > 100 ? fullName.substring(0, 100) : fullName);
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

    private String[] rateLimitKeys(String clientIp, String identifier) {
        String account = identifier.toLowerCase();
        return new String[] {"pair:" + clientIp + "|" + account, "ip:" + clientIp, "acct:" + account};
    }

    private void recordFailure(String clientIp, String identifier) {
        String[] keys = rateLimitKeys(clientIp, identifier);
        rateLimitingService.recordFailedAttempt(keys[0]);                        // 5 tries per IP per account
        rateLimitingService.recordFailedAttempt(keys[1], MAX_FAILURES_PER_IP);   // one IP guessing many accounts
        rateLimitingService.recordFailedAttempt(keys[2], MAX_FAILURES_PER_ACCOUNT); // distributed guessing
    }
}
