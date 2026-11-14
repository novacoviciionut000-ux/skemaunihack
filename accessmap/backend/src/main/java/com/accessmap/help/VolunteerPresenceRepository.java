package com.accessmap.help;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface VolunteerPresenceRepository extends JpaRepository<VolunteerPresence, Long> {

    List<VolunteerPresence> findByOnDutyTrueAndUpdatedAtAfter(Instant since);
}
