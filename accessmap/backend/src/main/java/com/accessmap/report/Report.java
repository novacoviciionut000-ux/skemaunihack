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

    /** Votes from users who passed by and saw that the obstacle is gone. */
    @Column(name = "not_there_votes", nullable = false, columnDefinition = "integer default 0 not null")
    private int notThereVotes = 0;

    private boolean active = true;

    @Column(name = "author_id")
    private Long authorId;

    @Column(name = "author_name", length = 100)
    private String authorName;

    public Report() {}

    public Long getId() { return id; }
    public double getLatitude() { return latitude; }
    public double getLongitude() { return longitude; }
    public ReportType getType() { return type; }
    public String getDescription() { return description; }
    public int getUpvotes() { return upvotes; }
    public int getNotThereVotes() { return notThereVotes; }
    public void setNotThereVotes(int notThereVotes) { this.notThereVotes = notThereVotes; }
    public boolean isActive() { return active; }
    public Long getAuthorId() { return authorId; }
    public String getAuthorName() { return authorName; }

    public void setLatitude(double latitude) { this.latitude = latitude; }
    public void setLongitude(double longitude) { this.longitude = longitude; }
    public void setType(ReportType type) { this.type = type; }
    public void setDescription(String description) { this.description = description; }
    public void setUpvotes(int upvotes) { this.upvotes = upvotes; }
    public void setActive(boolean active) { this.active = active; }
    public void setAuthorId(Long authorId) { this.authorId = authorId; }
    public void setAuthorName(String authorName) { this.authorName = authorName; }
}
