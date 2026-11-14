package com.accessmap.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ReportServiceTest {

    private ReportRepository repository;
    private ReportService service;
    private Report report;

    @BeforeEach
    void setUp() {
        repository = mock(ReportRepository.class);
        service = new ReportService(repository);
        report = new Report();
        when(repository.findById(1L)).thenReturn(Optional.of(report));
        when(repository.save(any(Report.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void reportStaysActiveBelowThreshold() {
        service.markNotThere(1L, "10.0.0.1");
        ReportService.NotThereResult result = service.markNotThere(1L, "10.0.0.2");

        assertFalse(result.removed());
        assertEquals(2, result.notThereVotes());
        assertTrue(report.isActive());
    }

    @Test
    void reportIsRemovedWhenThreeDifferentClientsSayItIsGone() {
        service.markNotThere(1L, "10.0.0.1");
        service.markNotThere(1L, "10.0.0.2");
        ReportService.NotThereResult result = service.markNotThere(1L, "10.0.0.3");

        assertTrue(result.removed());
        assertFalse(report.isActive());
    }

    @Test
    void sameClientCountsOnlyOnce() {
        service.markNotThere(1L, "10.0.0.1");
        service.markNotThere(1L, "10.0.0.1");
        ReportService.NotThereResult result = service.markNotThere(1L, "10.0.0.1");

        assertEquals(1, result.notThereVotes());
        assertTrue(report.isActive());
    }

    @Test
    void confirmationsOutweighingNotThereVotesKeepTheReport() {
        report.setUpvotes(5);
        service.markNotThere(1L, "10.0.0.1");
        service.markNotThere(1L, "10.0.0.2");
        ReportService.NotThereResult result = service.markNotThere(1L, "10.0.0.3");

        assertFalse(result.removed());
        assertTrue(report.isActive());
    }

    @Test
    void unknownReportReturnsNull() {
        when(repository.findById(99L)).thenReturn(Optional.empty());
        assertNull(service.markNotThere(99L, "10.0.0.1"));
    }
}
