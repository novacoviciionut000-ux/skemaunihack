package com.accessmap.help;

import com.accessmap.auth.model.User;
import com.accessmap.auth.repository.UserRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * Distress signals from clients, answered by the nearest volunteers.
 *
 * Who sees a request: only volunteers that are on duty (position sent in the last
 * {@link #PRESENCE_FRESH}) and within {@link #MAX_RADIUS_M}. At first only the
 * {@link #FIRST_WAVE} closest ones see it; every {@link #WAVE_INTERVAL} without an answer
 * the circle widens by another wave. Exact client coordinates are only revealed to the
 * volunteer who accepts.
 */
@Service
public class HelpService {

    static final double MAX_RADIUS_M = 15_000;
    static final int FIRST_WAVE = 5;
    static final Duration WAVE_INTERVAL = Duration.ofSeconds(60);
    static final Duration PRESENCE_FRESH = Duration.ofMinutes(2);
    static final Duration OPEN_TIMEOUT = Duration.ofMinutes(30);
    static final Duration JOB_TIMEOUT = Duration.ofHours(3);
    static final Duration RESULT_VISIBLE = Duration.ofMinutes(2);

    private static final Set<HelpStatus> ACTIVE =
            EnumSet.of(HelpStatus.OPEN, HelpStatus.ACCEPTED, HelpStatus.AWAITING_CONFIRMATION);
    private static final Set<HelpStatus> VOLUNTEER_ACTIVE =
            EnumSet.of(HelpStatus.ACCEPTED, HelpStatus.AWAITING_CONFIRMATION);

    private final HelpRequestRepository requests;
    private final VolunteerPresenceRepository presences;
    private final UserRepository users;

    public HelpService(HelpRequestRepository requests, VolunteerPresenceRepository presences, UserRepository users) {
        this.requests = requests;
        this.presences = presences;
        this.users = users;
    }

    // ─── Views returned to the apps ─────────────────────────────────────────────

    /** What the client sees about their own request. */
    public record ClientView(Long id, String status, Instant createdAt, long ageSeconds, String note,
                             int nearbyVolunteers, String volunteerName, Integer volunteerDistanceMeters,
                             Double volunteerLatitude, Double volunteerLongitude, int rejectedCount,
                             int pointsAwarded) {}

    /** An open request as a nearby volunteer sees it (approximate location only). */
    public record NearbyView(Long id, String clientFirstName, double approxLatitude, double approxLongitude,
                             int distanceMeters, long ageSeconds, String note) {}

    /** The job a volunteer accepted (exact location). */
    public record JobView(Long id, String status, String clientName, double latitude, double longitude,
                          String note, Integer distanceMeters, Instant acceptedAt, int rejectedCount,
                          int pointsAwarded, DeedPoints.Breakdown breakdown) {}

    public record PresenceView(boolean onDuty, int deedPoints, int deedsCompleted, String level, int nextLevelAt,
                               JobView activeJob, List<NearbyView> nearby, JobView recentResult) {}

    public record LeaderboardEntry(int rank, String name, int deedPoints, int deedsCompleted, String level) {}

    // ─── Client side ────────────────────────────────────────────────────────────

    @Transactional
    public ClientView createRequest(String username, double lat, double lng, String note) {
        User client = user(username);
        if (client.isVolunteer()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Contul tău este de voluntar. Doar clienții pot trimite semnal de ajutor.");
        }
        expireStale();

        // Pressing the button twice must not create two alerts
        var existing = requests.findFirstByClientIdAndStatusInOrderByCreatedAtDesc(client.getId(), ACTIVE);
        if (existing.isPresent()) {
            return clientView(existing.get());
        }

        HelpRequest r = new HelpRequest();
        r.setClientId(client.getId());
        r.setClientName(displayName(client));
        r.setLatitude(lat);
        r.setLongitude(lng);
        r.setNote(note == null || note.isBlank() ? null : note.trim());
        r.setStatus(HelpStatus.OPEN);
        r.setCreatedAt(Instant.now());
        return clientView(requests.save(r));
    }

    @Transactional
    public ClientView clientActive(String username) {
        User client = user(username);
        expireStale();
        return requests.findFirstByClientIdAndStatusInOrderByCreatedAtDesc(client.getId(), ACTIVE)
                .map(this::clientView)
                .orElse(null);
    }

    @Transactional
    public ClientView cancel(String username, Long id) {
        User client = user(username);
        HelpRequest r = owned(id, client);
        if (r.getStatus() != HelpStatus.OPEN && r.getStatus() != HelpStatus.ACCEPTED) {
            throw conflict("Cererea nu mai poate fi anulată.");
        }
        r.setStatus(HelpStatus.CANCELLED);
        r.setClosedAt(Instant.now());
        return clientView(save(r));
    }

    /**
     * The client's answer to "was the deed really done?". Yes awards the points; no sends the
     * job back to the volunteer, who can keep helping and report it finished again.
     */
    @Transactional
    public ClientView confirm(String username, Long id, boolean completed) {
        User client = user(username);
        HelpRequest r = owned(id, client);
        if (r.getStatus() != HelpStatus.AWAITING_CONFIRMATION) {
            throw conflict("Voluntarul nu a marcat încă fapta ca terminată.");
        }

        if (!completed) {
            r.setStatus(HelpStatus.ACCEPTED);
            r.setFinishedAt(null);
            r.setRejectedCount(r.getRejectedCount() + 1);
            return clientView(save(r));
        }

        DeedPoints.Breakdown points = breakdown(r);
        r.setStatus(HelpStatus.COMPLETED);
        r.setClosedAt(Instant.now());
        r.setPointsAwarded(points.total());
        save(r);

        users.findById(r.getVolunteerId()).ifPresent(v -> {
            v.setDeedPoints(v.getDeedPoints() + points.total());
            v.setDeedsCompleted(v.getDeedsCompleted() + 1);
            users.save(v);
        });
        return clientView(r);
    }

    // ─── Volunteer side ─────────────────────────────────────────────────────────

    /** Heartbeat from the volunteer app: stores the position and returns everything it shows. */
    @Transactional
    public PresenceView presence(String username, double lat, double lng, boolean onDuty) {
        User v = volunteer(username);
        expireStale();

        VolunteerPresence p = presences.findById(v.getId()).orElseGet(() -> {
            VolunteerPresence np = new VolunteerPresence();
            np.setUserId(v.getId());
            return np;
        });
        p.setDisplayName(displayName(v));
        p.setLatitude(lat);
        p.setLongitude(lng);
        p.setOnDuty(onDuty);
        p.setUpdatedAt(Instant.now());
        presences.save(p);

        JobView active = requests.findFirstByVolunteerIdAndStatusInOrderByCreatedAtDesc(v.getId(), VOLUNTEER_ACTIVE)
                .map(r -> jobView(r, p))
                .orElse(null);

        List<NearbyView> nearby = List.of();
        if (onDuty && active == null) {
            nearby = nearbyFor(v.getId(), p);
        }

        JobView recent = requests.findFirstByVolunteerIdAndStatusAndClosedAtAfterOrderByClosedAtDesc(
                        v.getId(), HelpStatus.COMPLETED, Instant.now().minus(RESULT_VISIBLE))
                .map(r -> jobView(r, p))
                .orElse(null);

        return new PresenceView(onDuty, v.getDeedPoints(), v.getDeedsCompleted(),
                DeedPoints.level(v.getDeedPoints()), DeedPoints.nextLevelAt(v.getDeedPoints()),
                active, nearby, recent);
    }

    @Transactional
    public JobView accept(String username, Long id) {
        User v = volunteer(username);
        expireStale();
        VolunteerPresence p = presences.findById(v.getId())
                .filter(this::isFresh)
                .filter(VolunteerPresence::isOnDuty)
                .orElseThrow(() -> conflict("Activează modul „În serviciu” ca să poți accepta cereri."));

        if (requests.findFirstByVolunteerIdAndStatusInOrderByCreatedAtDesc(v.getId(), VOLUNTEER_ACTIVE).isPresent()) {
            throw conflict("Ai deja o faptă în desfășurare. Termin-o întâi.");
        }

        HelpRequest r = requests.findById(id).orElseThrow(() -> notFound());
        if (r.getStatus() != HelpStatus.OPEN) {
            throw conflict("Altcineva a preluat deja această cerere.");
        }
        if (r.getClientId().equals(v.getId())) {
            throw conflict("Nu îți poți accepta propria cerere.");
        }
        if (!isVisibleTo(r, p, onDutyVolunteers())) {
            throw conflict("Cererea este prea departe de tine.");
        }

        r.setStatus(HelpStatus.ACCEPTED);
        r.setVolunteerId(v.getId());
        r.setVolunteerName(displayName(v));
        r.setVolunteerStartLat(p.getLatitude());
        r.setVolunteerStartLng(p.getLongitude());
        r.setAcceptedAt(Instant.now());
        return jobView(save(r), p);
    }

    /** Volunteer can't make it after all: the request goes back to the others. */
    @Transactional
    public void release(String username, Long id) {
        User v = volunteer(username);
        HelpRequest r = assigned(id, v);
        if (r.getStatus() != HelpStatus.ACCEPTED) {
            throw conflict("Cererea nu mai poate fi eliberată.");
        }
        r.setStatus(HelpStatus.OPEN);
        r.setVolunteerId(null);
        r.setVolunteerName(null);
        r.setVolunteerStartLat(null);
        r.setVolunteerStartLng(null);
        r.setAcceptedAt(null);
        // Count the wait from now, so the widening search restarts with the closest volunteers
        r.setCreatedAt(Instant.now());
        save(r);
    }

    /** "Deed finished": the client is then asked by voice whether it really was. */
    @Transactional
    public JobView finish(String username, Long id) {
        User v = volunteer(username);
        HelpRequest r = assigned(id, v);
        if (r.getStatus() != HelpStatus.ACCEPTED) {
            throw conflict("Fapta a fost deja raportată ca terminată.");
        }
        r.setStatus(HelpStatus.AWAITING_CONFIRMATION);
        r.setFinishedAt(Instant.now());
        return jobView(save(r), presences.findById(v.getId()).orElse(null));
    }

    @Transactional(readOnly = true)
    public List<LeaderboardEntry> leaderboard() {
        List<User> top = users.findTopVolunteers(PageRequest.of(0, 10));
        List<LeaderboardEntry> out = new ArrayList<>();
        for (int i = 0; i < top.size(); i++) {
            User u = top.get(i);
            out.add(new LeaderboardEntry(i + 1, displayName(u), u.getDeedPoints(), u.getDeedsCompleted(),
                    DeedPoints.level(u.getDeedPoints())));
        }
        return out;
    }

    // ─── Rules ──────────────────────────────────────────────────────────────────

    /**
     * Visible if the volunteer is within range and among the closest on-duty volunteers for
     * the current wave: 5 closest at first, 10 after a minute, 15 after two, ...
     */
    boolean isVisibleTo(HelpRequest r, VolunteerPresence p, List<VolunteerPresence> onDuty) {
        double d = DeedPoints.haversine(r.getLatitude(), r.getLongitude(), p.getLatitude(), p.getLongitude());
        if (d > MAX_RADIUS_M) return false;
        long waves = 1 + Math.max(0, Duration.between(r.getCreatedAt(), Instant.now()).getSeconds()) / WAVE_INTERVAL.getSeconds();
        long allowed = FIRST_WAVE * waves;
        long closer = onDuty.stream()
                .filter(o -> !o.getUserId().equals(p.getUserId()) && !o.getUserId().equals(r.getClientId()))
                .filter(o -> DeedPoints.haversine(r.getLatitude(), r.getLongitude(), o.getLatitude(), o.getLongitude()) < d)
                .count();
        return closer < allowed;
    }

    private List<NearbyView> nearbyFor(Long volunteerId, VolunteerPresence p) {
        List<VolunteerPresence> onDuty = onDutyVolunteers();
        return requests.findByStatus(HelpStatus.OPEN).stream()
                .filter(r -> !r.getClientId().equals(volunteerId))
                .filter(r -> isVisibleTo(r, p, onDuty))
                .map(r -> new NearbyView(
                        r.getId(),
                        firstName(r.getClientName()),
                        roundCoord(r.getLatitude()),
                        roundCoord(r.getLongitude()),
                        (int) Math.round(DeedPoints.haversine(r.getLatitude(), r.getLongitude(), p.getLatitude(), p.getLongitude())),
                        Duration.between(r.getCreatedAt(), Instant.now()).getSeconds(),
                        r.getNote()))
                .sorted(Comparator.comparingInt(NearbyView::distanceMeters))
                .limit(10)
                .toList();
    }

    private DeedPoints.Breakdown breakdown(HelpRequest r) {
        double travel = r.getVolunteerStartLat() == null ? 0 : DeedPoints.haversine(
                r.getVolunteerStartLat(), r.getVolunteerStartLng(), r.getLatitude(), r.getLongitude());
        return DeedPoints.compute(r.getCreatedAt(), r.getAcceptedAt(), travel, r.getRejectedCount());
    }

    /** Closes requests nobody answered and jobs left hanging. Cheap at hackathon scale. */
    void expireStale() {
        Instant now = Instant.now();
        for (HelpRequest r : requests.findByStatusIn(ACTIVE)) {
            boolean stale = r.getStatus() == HelpStatus.OPEN
                    ? r.getCreatedAt().isBefore(now.minus(OPEN_TIMEOUT))
                    : r.getAcceptedAt() != null && r.getAcceptedAt().isBefore(now.minus(JOB_TIMEOUT));
            if (stale) {
                r.setStatus(HelpStatus.EXPIRED);
                r.setClosedAt(now);
                requests.save(r);
            }
        }
    }

    // ─── View builders ──────────────────────────────────────────────────────────

    private ClientView clientView(HelpRequest r) {
        Integer vDist = null;
        Double vLat = null, vLng = null;
        if (r.getVolunteerId() != null) {
            var vp = presences.findById(r.getVolunteerId()).filter(this::isFresh);
            if (vp.isPresent()) {
                vLat = vp.get().getLatitude();
                vLng = vp.get().getLongitude();
                vDist = (int) Math.round(DeedPoints.haversine(r.getLatitude(), r.getLongitude(), vLat, vLng));
            }
        }
        int nearby = 0;
        if (r.getStatus() == HelpStatus.OPEN) {
            List<VolunteerPresence> onDuty = onDutyVolunteers();
            nearby = (int) onDuty.stream().filter(o -> isVisibleTo(r, o, onDuty)).count();
        }
        return new ClientView(r.getId(), r.getStatus().name(), r.getCreatedAt(),
                Duration.between(r.getCreatedAt(), Instant.now()).getSeconds(), r.getNote(), nearby,
                r.getVolunteerName(), vDist, vLat, vLng, r.getRejectedCount(), r.getPointsAwarded());
    }

    private JobView jobView(HelpRequest r, VolunteerPresence p) {
        Integer dist = p == null ? null : (int) Math.round(
                DeedPoints.haversine(r.getLatitude(), r.getLongitude(), p.getLatitude(), p.getLongitude()));
        DeedPoints.Breakdown b = r.getStatus() == HelpStatus.COMPLETED ? breakdown(r) : null;
        return new JobView(r.getId(), r.getStatus().name(), r.getClientName(), r.getLatitude(), r.getLongitude(),
                r.getNote(), dist, r.getAcceptedAt(), r.getRejectedCount(), r.getPointsAwarded(), b);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private List<VolunteerPresence> onDutyVolunteers() {
        return presences.findByOnDutyTrueAndUpdatedAtAfter(Instant.now().minus(PRESENCE_FRESH));
    }

    private boolean isFresh(VolunteerPresence p) {
        return p.getUpdatedAt() != null && p.getUpdatedAt().isAfter(Instant.now().minus(PRESENCE_FRESH));
    }

    private HelpRequest save(HelpRequest r) {
        try {
            return requests.saveAndFlush(r);
        } catch (ObjectOptimisticLockingFailureException e) {
            throw conflict("Cererea tocmai a fost modificată de altcineva. Reîncearcă.");
        }
    }

    private User user(String username) {
        return users.findByUsernameIgnoreCase(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Utilizator necunoscut."));
    }

    private User volunteer(String username) {
        User u = user(username);
        if (!u.isVolunteer()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Doar voluntarii pot face asta.");
        }
        return u;
    }

    private HelpRequest owned(Long id, User client) {
        HelpRequest r = requests.findById(id).orElseThrow(HelpService::notFound);
        // Same 404 as a missing id: don't reveal that someone else's request exists
        if (!r.getClientId().equals(client.getId())) throw notFound();
        return r;
    }

    private HelpRequest assigned(Long id, User volunteer) {
        HelpRequest r = requests.findById(id).orElseThrow(HelpService::notFound);
        if (!volunteer.getId().equals(r.getVolunteerId())) throw notFound();
        return r;
    }

    private static String displayName(User u) {
        String n = u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername();
        return n.length() > 100 ? n.substring(0, 100) : n;
    }

    private static String firstName(String name) {
        if (name == null || name.isBlank()) return "Cineva";
        return name.trim().split("\\s+")[0];
    }

    /** ~100 m precision: enough to judge the distance, not enough to find the door. */
    private static double roundCoord(double c) {
        return Math.round(c * 1000.0) / 1000.0;
    }

    private static ResponseStatusException conflict(String msg) {
        return new ResponseStatusException(HttpStatus.CONFLICT, msg);
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Cererea nu a fost găsită.");
    }
}
