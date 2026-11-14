package com.accessmap.help;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface HelpRequestRepository extends JpaRepository<HelpRequest, Long> {

    Optional<HelpRequest> findFirstByClientIdAndStatusInOrderByCreatedAtDesc(Long clientId, Collection<HelpStatus> statuses);

    Optional<HelpRequest> findFirstByVolunteerIdAndStatusInOrderByCreatedAtDesc(Long volunteerId, Collection<HelpStatus> statuses);

    List<HelpRequest> findByStatus(HelpStatus status);

    List<HelpRequest> findByStatusIn(Collection<HelpStatus> statuses);

    Optional<HelpRequest> findFirstByVolunteerIdAndStatusAndClosedAtAfterOrderByClosedAtDesc(
            Long volunteerId, HelpStatus status, java.time.Instant since);
}
