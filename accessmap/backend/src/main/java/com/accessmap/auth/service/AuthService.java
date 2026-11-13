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

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class AuthService {

    private static final Pattern PASSWORD_PATTERN = Pattern.compile("^(?=.*[A-Za-z])(?=.*\\d).{8,}$");

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final RateLimitingService rateLimitingService;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       JwtUtil jwtUtil,
                       RateLimitingService rateLimitingService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
        this.rateLimitingService = rateLimitingService;
    }

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String cleanUsername = request.getUsername().trim().toLowerCase();
        String cleanEmail = request.getEmail().trim().toLowerCase();

        // 1. Verificare unicitate username
        if (userRepository.existsByUsernameIgnoreCase(cleanUsername)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Numele de utilizator este deja folosit.");
        }

        // 2. Verificare unicitate email
        if (userRepository.existsByEmailIgnoreCase(cleanEmail)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Adresa de email este deja înregistrată.");
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

        return new AuthResponse(
                token,
                savedUser.getId(),
                savedUser.getUsername(),
                savedUser.getEmail(),
                savedUser.getFullName(),
                savedUser.getRole().name(),
                savedUser.getProvider().name(),
                savedUser.getAvatarUrl(),
                savedUser.getPreferredProfile(),
                "Cont creat cu succes!"
        );
    }

    @Transactional
    public AuthResponse login(LoginRequest request, String clientIp) {
        String identifier = request.getUsernameOrEmail().trim();

        // 1. Verificare Rate-Limiting împotriva atacurilor de tip brute-force
        if (rateLimitingService.isBlocked(clientIp) || rateLimitingService.isBlocked(identifier)) {
            long remaining = Math.max(
                    rateLimitingService.getRemainingLockoutSeconds(clientIp),
                    rateLimitingService.getRemainingLockoutSeconds(identifier)
            );
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Prea multe încercări eșuate de autentificare. Încearcă din nou peste " + (remaining > 0 ? remaining + " secunde." : "câteva minute."));
        }

        // 2. Căutare utilizator după username sau email
        Optional<User> userOpt = userRepository.findByUsernameOrEmail(identifier);

        if (userOpt.isEmpty()) {
            recordFailure(clientIp, identifier);
            throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă.");
        }

        User user = userOpt.get();

        // 3. Verificare dacă contul este blocat
        if (user.isAccountLocked()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Contul este temporar blocat din motive de securitate.");
        }

        if (!user.isEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Contul este dezactivat.");
        }

        // 4. Verificare dacă utilizatorul este exclusiv OAuth (fără parolă locală setată)
        if (user.getPasswordHash() == null) {
            recordFailure(clientIp, identifier);
            throw new BadCredentialsException("Acest cont folosește autentificare prin " + user.getProvider() + ". Te rugăm să folosești butonul corespunzător.");
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

        return new AuthResponse(
                token,
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getFullName(),
                user.getRole().name(),
                user.getProvider().name(),
                user.getAvatarUrl(),
                user.getPreferredProfile(),
                "Autentificare reușită!"
        );
    }

    @Transactional
    public AuthResponse oauthLogin(OAuthRequest request) {
        String providerStr = request.getProvider().trim().toUpperCase();
        AuthProvider provider;
        try {
            provider = AuthProvider.valueOf(providerStr);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Furnizor OAuth necunoscut: " + request.getProvider());
        }

        if (provider != AuthProvider.GOOGLE && provider != AuthProvider.FACEBOOK) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Doar Google și Facebook sunt suportate.");
        }

        String email = request.getEmail() != null ? request.getEmail().trim().toLowerCase() : null;
        if (!StringUtils.hasText(email)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Emailul este obligatoriu pentru autentificarea " + provider);
        }

        // Verificăm dacă există deja un cont cu acest email sau providerId
        Optional<User> existingUser = userRepository.findByEmail(email);
        User user;

        if (existingUser.isPresent()) {
            user = existingUser.get();
            // Actualizăm datele de profil dacă e cazul
            if (StringUtils.hasText(request.getName()) && !StringUtils.hasText(user.getFullName())) {
                user.setFullName(request.getName());
            }
            if (StringUtils.hasText(request.getAvatarUrl())) {
                user.setAvatarUrl(request.getAvatarUrl());
            }
            if (user.getProvider() == AuthProvider.LOCAL) {
                // Legăm contul de providerul OAuth
                user.setProvider(provider);
                user.setProviderId(request.getProviderId());
            }
            user.setLastLoginAt(LocalDateTime.now());
        } else {
            // Creăm automat un cont nou pentru utilizatorul OAuth
            user = new User();
            String baseUsername = email.split("@")[0].replaceAll("[^a-zA-Z0-9_.-]", "");
            if (baseUsername.length() < 3) baseUsername = "user_" + baseUsername;
            String uniqueUsername = baseUsername;
            int counter = 1;
            while (userRepository.existsByUsernameIgnoreCase(uniqueUsername)) {
                uniqueUsername = baseUsername + counter++;
            }

            user.setUsername(uniqueUsername);
            user.setEmail(email);
            // Generăm un hash securizat aleator (nu va fi folosit direct deoarece logarea se face prin OAuth)
            user.setPasswordHash(passwordEncoder.encode(UUID.randomUUID().toString()));
            user.setFullName(StringUtils.hasText(request.getName()) ? request.getName() : baseUsername);
            user.setAvatarUrl(request.getAvatarUrl());
            user.setRole(Role.ROLE_USER);
            user.setProvider(provider);
            user.setProviderId(request.getProviderId());
            user.setPreferredProfile("wheelchair");
            user.setEnabled(true);
            user.setCreatedAt(LocalDateTime.now());
            user.setLastLoginAt(LocalDateTime.now());
        }

        User savedUser = userRepository.save(user);
        String token = jwtUtil.generateToken(savedUser);

        return new AuthResponse(
                token,
                savedUser.getId(),
                savedUser.getUsername(),
                savedUser.getEmail(),
                savedUser.getFullName(),
                savedUser.getRole().name(),
                savedUser.getProvider().name(),
                savedUser.getAvatarUrl(),
                savedUser.getPreferredProfile(),
                "Autentificare prin " + provider + " reușită!"
        );
    }

    @Transactional(readOnly = true)
    public UserProfileDto getCurrentUserProfile(String username) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));

        UserProfileDto dto = new UserProfileDto();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setFullName(user.getFullName());
        dto.setAvatarUrl(user.getAvatarUrl());
        dto.setRole(user.getRole().name());
        dto.setProvider(user.getProvider().name());
        dto.setPreferredProfile(user.getPreferredProfile());
        dto.setCreatedAt(user.getCreatedAt());
        dto.setLastLoginAt(user.getLastLoginAt());
        return dto;
    }

    @Transactional
    public UserProfileDto updateProfile(String username, UpdateProfileRequest request) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Utilizatorul nu a fost găsit."));

        if (StringUtils.hasText(request.getFullName())) {
            user.setFullName(request.getFullName().trim());
        }

        if (StringUtils.hasText(request.getPreferredProfile())) {
            user.setPreferredProfile(request.getPreferredProfile().trim());
        }

        // Schimbare parolă dacă este solicitată
        if (StringUtils.hasText(request.getNewPassword())) {
            if (user.getProvider() == AuthProvider.LOCAL) {
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

        UserProfileDto dto = new UserProfileDto();
        dto.setId(updated.getId());
        dto.setUsername(updated.getUsername());
        dto.setEmail(updated.getEmail());
        dto.setFullName(updated.getFullName());
        dto.setAvatarUrl(updated.getAvatarUrl());
        dto.setRole(updated.getRole().name());
        dto.setProvider(updated.getProvider().name());
        dto.setPreferredProfile(updated.getPreferredProfile());
        dto.setCreatedAt(updated.getCreatedAt());
        dto.setLastLoginAt(updated.getLastLoginAt());
        return dto;
    }

    private void recordFailure(String clientIp, String identifier) {
        rateLimitingService.recordFailedAttempt(clientIp);
        rateLimitingService.recordFailedAttempt(identifier);
    }
}
