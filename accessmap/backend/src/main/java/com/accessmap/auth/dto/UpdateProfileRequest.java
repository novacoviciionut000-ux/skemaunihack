package com.accessmap.auth.dto;

import jakarta.validation.constraints.Size;

public class UpdateProfileRequest {

    private String username;
    private String fullName;
    private String preferredProfile;

    private String currentPassword;

    @Size(min = 8, max = 100, message = "Noua parolă trebuie să aibă cel puțin 8 caractere.")
    private String newPassword;

    public UpdateProfileRequest() {}

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getPreferredProfile() { return preferredProfile; }
    public void setPreferredProfile(String preferredProfile) { this.preferredProfile = preferredProfile; }

    public String getCurrentPassword() { return currentPassword; }
    public void setCurrentPassword(String currentPassword) { this.currentPassword = currentPassword; }

    public String getNewPassword() { return newPassword; }
    public void setNewPassword(String newPassword) { this.newPassword = newPassword; }
}
