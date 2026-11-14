package com.accessmap.report;

import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReportService {

    private static final int MAX_TRACKED_VOTES = 10_000;
    static final int NOT_THERE_THRESHOLD = 3;

    private final ReportRepository repository;

    // "reportId:ip" pairs that already voted (bounded, oldest evicted) so one client can't spam upvotes
    private final Map<String, Boolean> votes = Collections.synchronizedMap(
            new LinkedHashMap<>(256, 0.75f, false) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > MAX_TRACKED_VOTES;
                }
            });

    public ReportService(ReportRepository repository) {
        this.repository = repository;
    }

    public Report saveReport(Report report) {
        return repository.save(report);
    }

    public List<Report> getActiveReports() {
        return repository.findAllByActiveTrue();
    }

    public void upvoteReport(Long id) {
        repository.findById(id).ifPresent(report -> {
            report.setUpvotes(report.getUpvotes() + 1);
            repository.save(report);
        });
    }

    /** Upvote at most once per client IP per report. */
    public void upvoteReport(Long id, String clientIp) {
        if (votes.putIfAbsent(id + ":" + clientIp, Boolean.TRUE) != null) {
            return;
        }
        upvoteReport(id);
    }

    /** Result of a "the obstacle is not there" vote. */
    public record NotThereResult(boolean removed, int notThereVotes) {}

    /**
     * Records that a client found the obstacle gone, at most once per client IP per report.
     * The report is switched off when at least {@value #NOT_THERE_THRESHOLD} people say it is
     * gone and they outnumber the people who confirmed it, so one person cannot erase a real
     * obstacle that others keep confirming. Returns null if the report does not exist.
     */
    public synchronized NotThereResult markNotThere(Long id, String clientIp) {
        Report report = repository.findById(id).orElse(null);
        if (report == null || !report.isActive()) {
            return report == null ? null : new NotThereResult(true, report.getNotThereVotes());
        }
        if (votes.putIfAbsent("gone:" + id + ":" + clientIp, Boolean.TRUE) == null) {
            report.setNotThereVotes(report.getNotThereVotes() + 1);
            if (report.getNotThereVotes() >= NOT_THERE_THRESHOLD
                    && report.getNotThereVotes() > report.getUpvotes()) {
                report.setActive(false);
            }
            repository.save(report);
        }
        return new NotThereResult(!report.isActive(), report.getNotThereVotes());
    }
}
