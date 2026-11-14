package com.accessmap.report;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Fields a client may set when creating a report. Everything else (id, upvotes, active,
 * author) is decided by the server.
 */
public record CreateReportRequest(
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @NotNull ReportType type,
        @Size(max = 500) String description
) {}
