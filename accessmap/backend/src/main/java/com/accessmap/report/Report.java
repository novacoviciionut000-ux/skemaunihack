package com.accessmap.report;

import jakarta.persistence.*;

@Entity
@Table(name = "reports") 
public class Report {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private double latitude;
    private double longitude;

    @Enumerated(EnumType.STRING)
    private ReportType type;
    
    private String description;
    
    private int upvotes = 1;
    private boolean active = true;

    public Report() {}

    public Long getId() { return id; }
    public double getLatitude() { return latitude; }
    public double getLongitude() { return longitude; }
    public ReportType getType() { return type; }
    public String getDescription() { return description; }
    public int getUpvotes() { return upvotes; }
    public boolean isActive() { return active; }

    public void setLatitude(double latitude) { this.latitude = latitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public void setType(ReportType type) { this.type = type; }
    public void setDescription(String description) { this.description = description; }
    public void setUpvotes(int upvotes) { this.upvotes = upvotes; }
    public void setActive(boolean active) { this.active = active; }
}