package com.accessmap.report;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService service;

    public ReportController(ReportService service) {
        this.service = service;
    }

    @PostMapping
    public Report createReport(@RequestBody Report report) {
        return service.saveReport(report);
    }

    @GetMapping
    public List<Report> getAllActiveReports() {
        return service.getActiveReports();
    }

    @PostMapping("/{id}/upvote")
    public void upvote(@PathVariable Long id) {
        service.upvoteReport(id);
    }
}