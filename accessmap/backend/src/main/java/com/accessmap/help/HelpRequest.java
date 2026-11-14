package com.accessmap.help;

import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "help_requests", indexes = {
        @Index(name = "idx_help_status", columnList = "status"),
        @Index(name = "idx_help_client", columnList = "client_id"),
        @Index(name = "idx_help_volunteer", columnList = "volunteer_id")
})
public class HelpRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Optimistic lock: two volunteers accepting at the same moment can't both win. */
    @Version
    private Long version;

    @Column(name = "client_id", nullable = false)
    private Long clientId;

    @Column(name = "client_name", length = 100)
    private String clientName;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(length = 200)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private HelpStatus status = HelpStatus.OPEN;

    @Column(name = "volunteer_id")
    private Long volunteerId;

    @Column(name = "volunteer_name", length = 100)
    private String volunteerName;

    /** Where the volunteer was when accepting; used for the distance bonus. */
    @Column(name = "volunteer_start_lat")
    private Double volunteerStartLat;

    @Column(name = "volunteer_start_lng")
    private Double volunteerStartLng;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    /** How many times the client answered "no, it wasn't done". */
    @Column(name = "rejected_count", nullable = false)
    private int rejectedCount = 0;

    @Column(name = "points_awarded", nullable = false)
    private int pointsAwarded = 0;

    public Long getId() { return id; }
    public Long getClientId() { return clientId; }
    public void setClientId(Long clientId) { this.clientId = clientId; }
    public String getClientName() { return clientName; }
    public void setClientName(String clientName) { this.clientName = clientName; }
    public double getLatitude() { return latitude; }
    public void setLatitude(double latitude) { this.latitude = latitude; }
    public double getLongitude() { return longitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public HelpStatus getStatus() { return status; }
    public void setStatus(HelpStatus status) { this.status = status; }
    public Long getVolunteerId() { return volunteerId; }
    public void setVolunteerId(Long volunteerId) { this.volunteerId = volunteerId; }
    public String getVolunteerName() { return volunteerName; }
    public void setVolunteerName(String volunteerName) { this.volunteerName = volunteerName; }
    public Double getVolunteerStartLat() { return volunteerStartLat; }
    public void setVolunteerStartLat(Double v) { this.volunteerStartLat = v; }
    public Double getVolunteerStartLng() { return volunteerStartLng; }
    public void setVolunteerStartLng(Double v) { this.volunteerStartLng = v; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getAcceptedAt() { return acceptedAt; }
    public void setAcceptedAt(Instant acceptedAt) { this.acceptedAt = acceptedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
    public Instant getClosedAt() { return closedAt; }
    public void setClosedAt(Instant closedAt) { this.closedAt = closedAt; }
    public int getRejectedCount() { return rejectedCount; }
    public void setRejectedCount(int rejectedCount) { this.rejectedCount = rejectedCount; }
    public int getPointsAwarded() { return pointsAwarded; }
    public void setPointsAwarded(int pointsAwarded) { this.pointsAwarded = pointsAwarded; }
}
