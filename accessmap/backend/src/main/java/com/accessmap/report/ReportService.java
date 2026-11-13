package com.accessmap.report;

import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class ReportService {
    
    private final ReportRepository repository;

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
}