package com.accessmap.auth;

import com.accessmap.auth.dto.AuthResponse;
import com.accessmap.auth.dto.LoginRequest;
import com.accessmap.auth.dto.OAuthRequest;
import com.accessmap.auth.dto.RegisterRequest;
import com.accessmap.auth.model.AuthProvider;
import com.accessmap.auth.model.Role;
import com.accessmap.auth.model.User;
import com.accessmap.auth.repository.UserRepository;
import com.accessmap.auth.security.JwtUtil;
import com.accessmap.auth.security.RateLimitingService;
import com.accessmap.auth.service.AuthService;
import com.accessmap.auth.service.EmailService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class AuthServiceTest {

    private UserRepository userRepository;
    private PasswordEncoder passwordEncoder;
    private JwtUtil jwtUtil;
    private RateLimitingService rateLimitingService;
    private EmailService emailService;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        passwordEncoder = new BCryptPasswordEncoder(10);
        jwtUtil = mock(JwtUtil.class);
        rateLimitingService = mock(RateLimitingService.class);
        emailService = mock(EmailService.class);

        authService = new AuthService(userRepository, passwordEncoder, jwtUtil, rateLimitingService, emailService);

        when(jwtUtil.generateToken(any(User.class))).thenReturn("mocked_jwt_token_12345");
    }

    @Test
    @DisplayName("Înregistrarea cu date proprii funcționează și generează hash BCrypt + JWT")
    void testRegisterSuccess() {
        RegisterRequest req = new RegisterRequest();
        req.setUsername("alex_pop");
        req.setEmail("alex@example.com");
        req.setPassword("ParolaMea123!");
        req.setFullName("Alex Pop");

        when(userRepository.existsByUsernameIgnoreCase("alex_pop")).thenReturn(false);
        when(userRepository.existsByEmailIgnoreCase("alex@example.com")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User u = invocation.getArgument(0);
            u.setId(10L);
            return u;
        });

        AuthResponse resp = authService.register(req);

        assertNotNull(resp);
        assertEquals("alex_pop", resp.getUsername());
        assertEquals("alex@example.com", resp.getEmail());
        assertEquals("mocked_jwt_token_12345", resp.getToken());
        assertTrue(resp.isHasPassword());
    }

    @Test
    @DisplayName("Dacă un username este deja ocupat, altcineva NU se poate înregistra (409 Conflict)")
    void testRegisterDuplicateUsernameRejected() {
        RegisterRequest req = new RegisterRequest();
        req.setUsername("alex_pop");
        req.setEmail("altul@example.com");
        req.setPassword("ParolaMea123!");

        // Simulăm că username-ul există deja (case-insensitive)
        when(userRepository.existsByUsernameIgnoreCase("alex_pop")).thenReturn(true);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> {
            authService.register(req);
        });

        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        assertTrue(ex.getReason().contains("deja folosit de altcineva"));
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("Dacă adresa de email este deja înregistrată, este refuzat cu 409 Conflict")
    void testRegisterDuplicateEmailRejected() {
        RegisterRequest req = new RegisterRequest();
        req.setUsername("utilizator_nou");
        req.setEmail("deja_inregistrat@example.com");
        req.setPassword("ParolaMea123!");

        when(userRepository.existsByUsernameIgnoreCase("utilizator_nou")).thenReturn(false);
        when(userRepository.existsByEmailIgnoreCase("deja_inregistrat@example.com")).thenReturn(true);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> {
            authService.register(req);
        });

        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());
        assertTrue(ex.getReason().contains("deja înregistrată"));
    }

    @Test
    @DisplayName("Autentificarea locală reușită prin username sau email")
    void testLoginSuccess() {
        User user = new User();
        user.setId(1L);
        user.setUsername("alex_pop");
        user.setEmail("alex@example.com");
        user.setPasswordHash(passwordEncoder.encode("ParolaMea123!"));
        user.setRole(Role.ROLE_USER);
        user.setProvider(AuthProvider.LOCAL);
        user.setEnabled(true);

        when(rateLimitingService.isBlocked(any())).thenReturn(false);
        when(userRepository.findByUsernameOrEmail("alex_pop")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenReturn(user);

        LoginRequest loginReq = new LoginRequest("alex_pop", "ParolaMea123!");
        AuthResponse resp = authService.login(loginReq, "127.0.0.1");

        assertNotNull(resp);
        assertEquals("alex_pop", resp.getUsername());
        assertEquals("mocked_jwt_token_12345", resp.getToken());
    }

    @Test
    @DisplayName("Autentificarea eșuată cu parolă greșită aruncă BadCredentialsException")
    void testLoginWrongPassword() {
        User user = new User();
        user.setUsername("alex_pop");
        user.setEmail("alex@example.com");
        user.setPasswordHash(passwordEncoder.encode("ParolaCorecta123!"));
        user.setRole(Role.ROLE_USER);
        user.setEnabled(true);

        when(rateLimitingService.isBlocked(any())).thenReturn(false);
        when(userRepository.findByUsernameOrEmail("alex_pop")).thenReturn(Optional.of(user));

        LoginRequest loginReq = new LoginRequest("alex_pop", "ParolaGresita999!");

        assertThrows(BadCredentialsException.class, () -> {
            authService.login(loginReq, "127.0.0.1");
        });
    }

    @Test
    @DisplayName("Google OAuth fără token este refuzat (nu se poate prelua un cont doar cu emailul)")
    void testOAuthGoogleWithoutTokenIsRejected() {
        OAuthRequest req = new OAuthRequest();
        req.setProvider("google");
        req.setEmail("victima@gmail.com");
        req.setProviderId("google_sub_999");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> authService.oauthLogin(req));
        assertEquals(HttpStatus.UNAUTHORIZED, ex.getStatusCode());
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("Google OAuth cu token este refuzat dacă GOOGLE_CLIENT_ID nu e configurat")
    void testOAuthGoogleWithoutClientIdIsRejected() {
        OAuthRequest req = new OAuthRequest();
        req.setProvider("google");
        req.setToken("header.payload.signature");
        req.setEmail("victima@gmail.com");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> authService.oauthLogin(req));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, ex.getStatusCode());
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("Facebook OAuth (neverificabil pe server) este refuzat")
    void testOAuthFacebookIsRejected() {
        OAuthRequest req = new OAuthRequest();
        req.setProvider("facebook");
        req.setEmail("victima@gmail.com");
        req.setProviderId("facebook_sub_888");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> authService.oauthLogin(req));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    @DisplayName("Verificarea rapidă a disponibilității username-ului (isUsernameTaken)")
    void testIsUsernameTaken() {
        when(userRepository.existsByUsernameIgnoreCase("utilizator_existent")).thenReturn(true);
        when(userRepository.existsByUsernameIgnoreCase("UTILIZATOR_EXISTENT")).thenReturn(true);
        when(userRepository.existsByUsernameIgnoreCase("utilizator_liber")).thenReturn(false);

        assertTrue(authService.isUsernameTaken("utilizator_existent"));
        assertTrue(authService.isUsernameTaken("UTILIZATOR_EXISTENT"));
        assertFalse(authService.isUsernameTaken("utilizator_liber"));
    }
}
