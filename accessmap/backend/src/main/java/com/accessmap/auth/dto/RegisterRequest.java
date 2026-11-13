package com.accessmap.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public class RegisterRequest {

    @NotBlank(message = "Numele de utilizator este obligatoriu.")
    @Size(min = 3, max = 30, message = "Numele de utilizator trebuie să aibă între 3 și 30 de caractere.")
    @Pattern(regexp = "^[a-zA-Z0-9_.-]+$", message = "Numele de utilizator poate conține doar litere, cifre, punct, linie și underscore.")
    private String username;

    @NotBlank(message = "Adresa de email este obligatorie.")
    @Email(message = "Adresa de email nu are un format valid.")
    private String email;

    @NotBlank(message = "Parola este obligatorie.")
    @Size(min = 8, max = 100, message = "Parola trebuie să aibă cel puțin 8 caractere.")
    private String password;

    private String fullName;
    private String preferredProfile = "wheelchair";

    public RegisterRequest() {}

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getPreferredProfile() { return preferredProfile; }
    public void setPreferredProfile(String preferredProfile) { this.preferredProfile = preferredProfile; }
}
