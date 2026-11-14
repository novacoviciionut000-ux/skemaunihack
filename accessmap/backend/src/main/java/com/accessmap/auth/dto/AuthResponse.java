package com.accessmap.auth.dto;

public class AuthResponse {

    private String token;
    private String type = "Bearer";
    private Long id;
    private String username;
    private String email;
    private String fullName;
    private String role;
    private String provider;
    private String avatarUrl;
    private String preferredProfile;
    private boolean hasPassword;
    private boolean hasGoogle;
    private boolean hasFacebook;
    private boolean emailSent = true;
    private String emailRecipient;
    private String emailDeliveryMode;
    private String emailMessage;
    private String message;

    public AuthResponse() {}

    public AuthResponse(String token, Long id, String username, String email, String fullName,
                        String role, String provider, String avatarUrl, String preferredProfile, String message) {
        this.token = token;
        this.id = id;
        this.username = username;
        this.email = email;
        this.fullName = fullName;
        this.role = role;
        this.provider = provider;
        this.avatarUrl = avatarUrl;
        this.preferredProfile = preferredProfile;
        this.message = message;
    }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }

    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }

    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }

    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }

    public String getPreferredProfile() { return preferredProfile; }
    public void setPreferredProfile(String preferredProfile) { this.preferredProfile = preferredProfile; }

    public boolean isHasPassword() { return hasPassword; }
    public void setHasPassword(boolean hasPassword) { this.hasPassword = hasPassword; }

    public boolean isHasGoogle() { return hasGoogle; }
    public void setHasGoogle(boolean hasGoogle) { this.hasGoogle = hasGoogle; }

    public boolean isHasFacebook() { return hasFacebook; }
    public void setHasFacebook(boolean hasFacebook) { this.hasFacebook = hasFacebook; }

    public boolean isEmailSent() { return emailSent; }
    public void setEmailSent(boolean emailSent) { this.emailSent = emailSent; }

    public String getEmailRecipient() { return emailRecipient; }
    public void setEmailRecipient(String emailRecipient) { this.emailRecipient = emailRecipient; }

    public String getEmailDeliveryMode() { return emailDeliveryMode; }
    public void setEmailDeliveryMode(String emailDeliveryMode) { this.emailDeliveryMode = emailDeliveryMode; }

    public String getEmailMessage() { return emailMessage; }
    public void setEmailMessage(String emailMessage) { this.emailMessage = emailMessage; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}
