package com.accessmap.report;

import com.accessmap.route.BlockedArea;
import com.accessmap.route.BlockedAreaProvider;
import org.springframework.stereotype.Component;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class ReportBlockedAreaProvider implements BlockedAreaProvider {

    private final ReportService reportService;

    public ReportBlockedAreaProvider(ReportService reportService) {
        this.reportService = reportService;
    }

    @Override
    public List<BlockedArea> getBlockedAreas() {
        return reportService.getActiveReports().stream()
                .map(report -> new BlockedArea(report.getLatitude(), report.getLongitude(), 20.0)) 
                .collect(Collectors.toList());
    }
}