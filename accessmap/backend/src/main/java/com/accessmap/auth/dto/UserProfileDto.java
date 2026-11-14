package com.accessmap.auth.dto;

import java.time.LocalDateTime;

public class UserProfileDto {

    private Long id;
    private String username;
    private String email;
    private String fullName;
    private String avatarUrl;
    private String role;
    private String provider;
    private String preferredProfile;
    private boolean hasPassword;
    private boolean hasGoogle;
    private boolean hasFacebook;
    private LocalDateTime createdAt;
    private LocalDateTime lastLoginAt;

    public UserProfileDto() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }

    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }

    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }

    public String getPreferredProfile() { return preferredProfile; }
    public void setPreferredProfile(String preferredProfile) { this.preferredProfile = preferredProfile; }

    public boolean isHasPassword() { return hasPassword; }
    public void setHasPassword(boolean hasPassword) { this.hasPassword = hasPassword; }

    public boolean isHasGoogle() { return hasGoogle; }
    public void setHasGoogle(boolean hasGoogle) { this.hasGoogle = hasGoogle; }

    public boolean isHasFacebook() { return hasFacebook; }
    public void setHasFacebook(boolean hasFacebook) { this.hasFacebook = hasFacebook; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getLastLoginAt() { return lastLoginAt; }
    public void setLastLoginAt(LocalDateTime lastLoginAt) { this.lastLoginAt = lastLoginAt; }
}
