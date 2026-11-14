package com.accessmap.auth.security;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    /** Public address(es) of the app, comma-separated, e.g. https://app.domeniu.ro (from .env). */
    private final String publicOrigins;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter,
                          @Value("${app.public-origins:}") String publicOrigins) {
        this.jwtAuthenticationFilter = jwtAuthenticationFilter;
        this.publicOrigins = publicOrigins == null ? "" : publicOrigins;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt cu factor de complexitate 12 pentru securitate ridicată împotriva atacurilor de tip brute-force
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration configuration) throws Exception {
        return configuration.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // CSRF token not needed: the session cookie is SameSite=Strict, so the browser never
                // attaches it to requests started by another site
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                // Nu păstrăm sesiuni pe server (Stateless REST)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Gestiunea excepțiilor de autentificare cu răspuns JSON curat (fără redirect la pagină HTML de login)
                .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, authException) -> {
                    response.setContentType("application/json;charset=UTF-8");
                    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                    response.getWriter().write("{\"error\":\"Neautorizat: Este necesar un token valid pentru această acțiune.\",\"status\":401}");
                }))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/error").permitAll()
                        // 1. Endpoint-urile publice de autentificare
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login",
                                "/api/auth/oauth", "/api/auth/oauth/*", "/api/auth/logout").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/check-username", "/api/auth/oauth-config").permitAll()
                        // 2. Navigarea, TTS și harta sunt publice
                        .requestMatchers(HttpMethod.GET, "/api/v1/**").permitAll()
                        .requestMatchers("/api/geocode/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/crossings").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/reports").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/reports", "/api/reports/*/upvote").permitAll()
                        // 3. Resurse ce necesită autentificare
                        .requestMatchers("/api/auth/me", "/api/auth/profile", "/api/auth/test-email").authenticated()
                        // 3b. Distress signals, volunteers and Deed points (HelpController)
                        .requestMatchers("/api/help", "/api/help/**", "/api/volunteers/**").authenticated()
                        // 4. Orice endpoint nelistat explicit este refuzat
                        .anyRequest().denyAll()
                )
                // Adăugăm filtrul JWT înainte de cel clasic
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        // Permitem originea frontend-ului Vite (implicit portul 3000 sau 5173)
        // Browsers send Origin on every POST. Behind the Vite proxy / Cloudflare tunnel the page and
        // /api share an address, but the backend only sees that header, so list every address the
        // app is served from. Without this, every POST from a phone got "403 Invalid CORS request".
        // (*.trycloudflare.com is on the Public Suffix List, so other tunnels are other sites and
        // never receive the SameSite=Strict session cookie.)
        List<String> origins = new ArrayList<>(List.of(
                "http://localhost:*", "http://127.0.0.1:*", "https://*.trycloudflare.com"));
        for (String o : publicOrigins.split(",")) {
            String trimmed = o.trim().replaceAll("/+$", "");
            if (!trimmed.isEmpty()) origins.add(trimmed);
        }
        configuration.setAllowedOriginPatterns(origins);
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        configuration.setAllowedHeaders(Arrays.asList("Authorization", "Content-Type", "Accept", "X-Requested-With"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
