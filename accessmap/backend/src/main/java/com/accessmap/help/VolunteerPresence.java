package com.accessmap.help;

import jakarta.persistence.*;

import java.time.Instant;

/** Last known position of a volunteer. One row per volunteer, updated every few seconds. */
@Entity
@Table(name = "volunteer_presence")
public class VolunteerPresence {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "display_name", length = 100)
    private String displayName;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(name = "on_duty", nullable = false)
    private boolean onDuty;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public double getLatitude() { return latitude; }
    public void setLatitude(double latitude) { this.latitude = latitude; }
    public double getLongitude() { return longitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public boolean isOnDuty() { return onDuty; }
    public void setOnDuty(boolean onDuty) { this.onDuty = onDuty; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
