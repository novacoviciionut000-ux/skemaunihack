package com.accessmap.report;

import com.accessmap.auth.repository.UserRepository;
import com.accessmap.common.ClientIp;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService service;
    private final UserRepository userRepository;

    public ReportController(ReportService service, UserRepository userRepository) {
        this.service = service;
        this.userRepository = userRepository;
    }

    @PostMapping
    public Report createReport(@Valid @RequestBody CreateReportRequest request) {
        Report report = new Report();
        report.setLatitude(request.latitude());
        report.setLongitude(request.longitude());
        report.setType(request.type());
        report.setDescription(request.description() == null ? null : request.description().trim());

        // Author comes from the verified JWT, never from the request body
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
            userRepository.findByUsernameIgnoreCase(auth.getName()).ifPresent(user -> {
                report.setAuthorId(user.getId());
                String name = user.getFullName() != null ? user.getFullName() : user.getUsername();
                report.setAuthorName(name.length() > 100 ? name.substring(0, 100) : name);
            });
        }
        return service.saveReport(report);
    }

    @GetMapping
    public List<Report> getAllActiveReports() {
        return service.getActiveReports();
    }

    @PostMapping("/{id}/upvote")
    public void upvote(@PathVariable Long id, HttpServletRequest request) {
        service.upvoteReport(id, ClientIp.resolve(request));
    }
}
