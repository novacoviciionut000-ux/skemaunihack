package com.accessmap.report;

import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReportService {

    private static final int MAX_TRACKED_VOTES = 10_000;

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
}
