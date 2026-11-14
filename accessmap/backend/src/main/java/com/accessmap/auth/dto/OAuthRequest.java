package com.accessmap.auth.dto;

import jakarta.validation.constraints.NotBlank;

public class OAuthRequest {

    @NotBlank(message = "Furnizorul OAuth este obligatoriu (ex: google, facebook).")
    private String provider;

    private String token;
    private String email;
    private String name;
    private String providerId;
    private String avatarUrl;

    public OAuthRequest() {}

    public String getProvider() { return provider; }
    public void setProvider(String provider) { this.provider = provider; }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getProviderId() { return providerId; }
    public void setProviderId(String providerId) { this.providerId = providerId; }

    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }

    /** Only used when this login creates a new account. */
    private String accountType;

    public String getAccountType() { return accountType; }
    public void setAccountType(String accountType) { this.accountType = accountType; }
}
