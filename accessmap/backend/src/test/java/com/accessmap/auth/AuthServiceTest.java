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
    @DisplayName("Înregistrarea prin Google alocă un username unic garantat și salvează googleId")
    void testOAuthGoogleNewUser() {
        OAuthRequest req = new OAuthRequest();
        req.setProvider("google");
        req.setEmail("andrei.ionescu@gmail.com");
        req.setName("Andrei Ionescu");
        req.setProviderId("google_sub_10928374");

        when(userRepository.findByGoogleId("google_sub_10928374")).thenReturn(Optional.empty());
        when(userRepository.findByEmailIgnoreCase("andrei.ionescu@gmail.com")).thenReturn(Optional.empty());
        when(userRepository.existsByUsernameIgnoreCase(anyString())).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User u = invocation.getArgument(0);
            u.setId(20L);
            return u;
        });

        AuthResponse resp = authService.oauthLogin(req);

        assertNotNull(resp);
        assertEquals("andrei_ionescu", resp.getUsername());
        assertEquals("andrei.ionescu@gmail.com", resp.getEmail());
        assertTrue(resp.isHasGoogle());
        assertEquals("mocked_jwt_token_12345", resp.getToken());

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(captor.capture());
        User saved = captor.getValue();
        assertEquals("google_sub_10928374", saved.getGoogleId());
    }

    @Test
    @DisplayName("Dacă un cont există deja (ex: creat local), logarea prin Google leagă contul (Account Linking)")
    void testOAuthGoogleExistingLocalUserLinksAccount() {
        User existing = new User();
        existing.setId(5L);
        existing.setUsername("ion_popescu");
        existing.setEmail("ion.popescu@gmail.com");
        existing.setPasswordHash(passwordEncoder.encode("ParolaLocala123!"));
        existing.setRole(Role.ROLE_USER);
        existing.setProvider(AuthProvider.LOCAL);
        existing.setEnabled(true);

        when(userRepository.findByGoogleId("google_sub_999")).thenReturn(Optional.empty());
        when(userRepository.findByEmailIgnoreCase("ion.popescu@gmail.com")).thenReturn(Optional.of(existing));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        OAuthRequest req = new OAuthRequest();
        req.setProvider("google");
        req.setEmail("ion.popescu@gmail.com");
        req.setName("Ion Popescu");
        req.setProviderId("google_sub_999");

        AuthResponse resp = authService.oauthLogin(req);

        assertNotNull(resp);
        assertEquals("ion_popescu", resp.getUsername());
        assertEquals("google_sub_999", existing.getGoogleId());
        assertTrue(resp.isHasPassword());
        assertTrue(resp.isHasGoogle());
    }

    @Test
    @DisplayName("Logarea ulterioară prin Facebook pe același cont nu șterge googleId")
    void testOAuthFacebookMultiProviderSupport() {
        User existing = new User();
        existing.setId(5L);
        existing.setUsername("ion_popescu");
        existing.setEmail("ion.popescu@gmail.com");
        existing.setGoogleId("google_sub_999");
        existing.setRole(Role.ROLE_USER);
        existing.setEnabled(true);

        when(userRepository.findByFacebookId("facebook_sub_888")).thenReturn(Optional.empty());
        when(userRepository.findByEmailIgnoreCase("ion.popescu@gmail.com")).thenReturn(Optional.of(existing));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        OAuthRequest req = new OAuthRequest();
        req.setProvider("facebook");
        req.setEmail("ion.popescu@gmail.com");
        req.setName("Ion Popescu");
        req.setProviderId("facebook_sub_888");

        AuthResponse resp = authService.oauthLogin(req);

        assertNotNull(resp);
        assertEquals("google_sub_999", existing.getGoogleId());
        assertEquals("facebook_sub_888", existing.getFacebookId());
        assertTrue(resp.isHasGoogle());
        assertTrue(resp.isHasFacebook());
    }

    @Test
    @DisplayName("Verificarea rapidă a disponibilității username-ului (isUsernameTaken)")
    void testIsUsernameTaken() {
        when(userRepository.existsByUsernameIgnoreCase("utilizator_existent")).thenReturn(true);
        when(userRepository.existsByUsernameIgnoreCase("utilizator_liber")).thenReturn(false);

        assertTrue(authService.isUsernameTaken("utilizator_existent"));
        assertTrue(authService.isUsernameTaken("UTILIZATOR_EXISTENT"));
        assertFalse(authService.isUsernameTaken("utilizator_liber"));
    }
}
