package com.accessmap.help;

import com.accessmap.auth.model.AccountType;
import com.accessmap.auth.model.User;
import com.accessmap.auth.repository.UserRepository;
import com.accessmap.auth.security.JwtUtil;
import com.accessmap.auth.security.SessionCookie;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Whole distress -> volunteer -> deed -> confirmation -> points flow through the real HTTP API,
 * security filters and JPA, on an in-memory H2 database (never the real Supabase one).
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:helpflow;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect",
        "mail.enabled=false",
        "jwt.secret=test-secret-test-secret-test-secret-0123456789",
})
class HelpFlowIntegrationTest {

    // Timișoara, Piața Victoriei and points around it
    static final double C_LAT = 45.7538, C_LNG = 21.2257;

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired HelpRequestRepository requests;
    @Autowired VolunteerPresenceRepository presences;
    @Autowired JwtUtil jwt;
    @Autowired ObjectMapper json;
    @Value("${spring.datasource.url}") String dbUrl;

    User client, volunteer, farVolunteer, otherClient;

    @BeforeEach
    void setUp() {
        assertTrue(dbUrl.startsWith("jdbc:h2:mem:"), "tests must never run against a real database");
        requests.deleteAll();
        presences.deleteAll();
        users.deleteAll();
        client = user("ana", "Ana Popescu", AccountType.CLIENT);
        otherClient = user("ion", "Ion Ionescu", AccountType.CLIENT);
        volunteer = user("vlad", "Vlad Voluntar", AccountType.VOLUNTEER);
        farVolunteer = user("dan", "Dan Departe", AccountType.VOLUNTEER);
    }

    @Test
    void fullFlowAwardsPointsOnlyAfterClientConfirms() throws Exception {
        // Volunteer ~600 m away goes on duty
        presence(volunteer, C_LAT + 0.0054, C_LNG, true).andExpect(status().isOk());

        // Client presses the distress button
        JsonNode created = body(postJson(client, "/api/help", "{\"latitude\":%s,\"longitude\":%s,\"note\":\"Nu gasesc intrarea\"}".formatted(C_LAT, C_LNG))
                .andExpect(status().isCreated()));
        long id = created.get("id").asLong();
        assertEquals("OPEN", created.get("status").asText());
        assertEquals(1, created.get("nearbyVolunteers").asInt(), "the on-duty volunteer is counted");

        // Pressing again returns the same request instead of a second alert
        assertEquals(id, body(postJson(client, "/api/help", "{\"latitude\":%s,\"longitude\":%s}".formatted(C_LAT, C_LNG))).get("id").asLong());

        // Volunteer sees it with only an approximate location and the client's first name
        JsonNode p = body(presence(volunteer, C_LAT + 0.0054, C_LNG, true));
        JsonNode nearby = p.get("nearby").get(0);
        assertEquals(id, nearby.get("id").asLong());
        assertEquals("Ana", nearby.get("clientFirstName").asText());
        assertTrue(nearby.get("distanceMeters").asInt() > 500 && nearby.get("distanceMeters").asInt() < 700);
        assertFalse(nearby.has("latitude"), "exact location is hidden before accepting");

        // Accept -> exact location + full name
        JsonNode job = body(postJson(volunteer, "/api/help/" + id + "/accept", "").andExpect(status().isOk()));
        assertEquals("ACCEPTED", job.get("status").asText());
        assertEquals(C_LAT, job.get("latitude").asDouble(), 1e-9);
        assertEquals("Ana Popescu", job.get("clientName").asText());

        // Client now sees who is coming and how far away they are
        JsonNode c = body(getAs(client, "/api/help/active")).get("asClient");
        assertEquals("ACCEPTED", c.get("status").asText());
        assertEquals("Vlad Voluntar", c.get("volunteerName").asText());
        assertNotNull(c.get("volunteerDistanceMeters"));

        // Client can't confirm before the volunteer reports the deed finished
        postJson(client, "/api/help/" + id + "/confirm", "{\"completed\":true}").andExpect(status().isConflict());

        // Deed finished -> client is asked; "no" sends it back to the volunteer, no points
        assertEquals("AWAITING_CONFIRMATION", body(postJson(volunteer, "/api/help/" + id + "/finish", "")).get("status").asText());
        JsonNode no = body(postJson(client, "/api/help/" + id + "/confirm", "{\"completed\":false}").andExpect(status().isOk()));
        assertEquals("ACCEPTED", no.get("status").asText());
        assertEquals(1, no.get("rejectedCount").asInt());
        assertEquals(0, users.findById(volunteer.getId()).orElseThrow().getDeedPoints());

        // Finished again, client says yes -> points (base 50 + fast 25 + 600 m / 50 = 12, no first-try bonus)
        postJson(volunteer, "/api/help/" + id + "/finish", "").andExpect(status().isOk());
        JsonNode yes = body(postJson(client, "/api/help/" + id + "/confirm", "{\"completed\":true}").andExpect(status().isOk()));
        assertEquals("COMPLETED", yes.get("status").asText());
        int awarded = yes.get("pointsAwarded").asInt();
        assertEquals(50 + 25 + 12, awarded);

        User v = users.findById(volunteer.getId()).orElseThrow();
        assertEquals(awarded, v.getDeedPoints());
        assertEquals(1, v.getDeedsCompleted());

        // Volunteer app gets the result with a breakdown, and no active job anymore
        JsonNode after = body(presence(volunteer, C_LAT, C_LNG, true));
        assertTrue(after.get("activeJob").isNull());
        assertEquals(awarded, after.get("recentResult").get("pointsAwarded").asInt());
        assertEquals(25, after.get("recentResult").get("breakdown").get("speed").asInt());
        assertEquals(awarded, after.get("deedPoints").asInt());

        // Confirming twice can't award points twice
        postJson(client, "/api/help/" + id + "/confirm", "{\"completed\":true}").andExpect(status().isConflict());
        assertEquals(awarded, users.findById(volunteer.getId()).orElseThrow().getDeedPoints());

        // Leaderboard
        JsonNode board = body(getAs(otherClient, "/api/volunteers/leaderboard"));
        assertEquals("Vlad Voluntar", board.get(0).get("name").asText());
        assertEquals(awarded, board.get(0).get("deedPoints").asInt());
    }

    @Test
    void onlyTheRightPeopleCanActOnARequest() throws Exception {
        presence(volunteer, C_LAT, C_LNG + 0.003, true);
        long id = body(postJson(client, "/api/help", "{\"latitude\":%s,\"longitude\":%s}".formatted(C_LAT, C_LNG))).get("id").asLong();

        // Not logged in
        mvc.perform(post("/api/help").contentType(MediaType.APPLICATION_JSON).content("{\"latitude\":1,\"longitude\":1}"))
                .andExpect(status().isUnauthorized());
        // A volunteer can't send a distress signal, a client can't accept one
        postJson(volunteer, "/api/help", "{\"latitude\":%s,\"longitude\":%s}".formatted(C_LAT, C_LNG)).andExpect(status().isForbidden());
        postJson(otherClient, "/api/help/" + id + "/accept", "").andExpect(status().isForbidden());
        // Someone else's request looks like it doesn't exist
        postJson(otherClient, "/api/help/" + id + "/cancel", "").andExpect(status().isNotFound());

        // Volunteer must be on duty
        presence(volunteer, C_LAT, C_LNG + 0.003, false);
        postJson(volunteer, "/api/help/" + id + "/accept", "").andExpect(status().isConflict());
        presence(volunteer, C_LAT, C_LNG + 0.003, true);
        postJson(volunteer, "/api/help/" + id + "/accept", "").andExpect(status().isOk());

        // Only the assigned volunteer can finish
        presence(farVolunteer, C_LAT, C_LNG, true);
        postJson(farVolunteer, "/api/help/" + id + "/finish", "").andExpect(status().isNotFound());
        // A second volunteer can't take an already accepted request
        postJson(farVolunteer, "/api/help/" + id + "/accept", "").andExpect(status().isConflict());

        // Bad coordinates are rejected
        postJson(otherClient, "/api/help", "{\"latitude\":200,\"longitude\":1}").andExpect(status().isBadRequest());
    }

    @Test
    void nearestVolunteersAreAlertedFirstAndTheCircleWidensOverTime() throws Exception {
        // 6 volunteers at 100..600 m, plus one 50 km away
        User[] v = new User[6];
        for (int i = 0; i < 6; i++) {
            v[i] = user("v" + i, "Voluntar " + i, AccountType.VOLUNTEER);
            presence(v[i], C_LAT + 0.0009 * (i + 1), C_LNG, true);
        }
        presence(farVolunteer, C_LAT + 0.45, C_LNG, true);

        long id = body(postJson(client, "/api/help", "{\"latitude\":%s,\"longitude\":%s}".formatted(C_LAT, C_LNG))).get("id").asLong();

        assertEquals(1, body(presence(v[0], C_LAT + 0.0009, C_LNG, true)).get("nearby").size(), "closest sees it");
        assertEquals(1, body(presence(v[4], C_LAT + 0.0045, C_LNG, true)).get("nearby").size(), "5th closest sees it");
        assertEquals(0, body(presence(v[5], C_LAT + 0.0054, C_LNG, true)).get("nearby").size(), "6th waits for the next wave");
        assertEquals(0, body(presence(farVolunteer, C_LAT + 0.45, C_LNG, true)).get("nearby").size(), "50 km is out of range");
        postJson(v[5], "/api/help/" + id + "/accept", "").andExpect(status().isConflict());

        // A minute without an answer: the next wave is alerted
        HelpRequest r = requests.findById(id).orElseThrow();
        r.setCreatedAt(Instant.now().minusSeconds(65));
        requests.save(r);
        assertEquals(1, body(presence(v[5], C_LAT + 0.0054, C_LNG, true)).get("nearby").size());
        assertEquals(0, body(presence(farVolunteer, C_LAT + 0.45, C_LNG, true)).get("nearby").size());
    }

    @Test
    void stalePresenceAndOldRequestsAreIgnored() throws Exception {
        presence(volunteer, C_LAT, C_LNG, true);
        VolunteerPresence p = presences.findById(volunteer.getId()).orElseThrow();
        p.setUpdatedAt(Instant.now().minusSeconds(600));
        presences.save(p);

        JsonNode created = body(postJson(client, "/api/help", "{\"latitude\":%s,\"longitude\":%s}".formatted(C_LAT, C_LNG)));
        assertEquals(0, created.get("nearbyVolunteers").asInt(), "volunteer who went silent 10 min ago isn't counted");

        HelpRequest r = requests.findById(created.get("id").asLong()).orElseThrow();
        r.setCreatedAt(Instant.now().minusSeconds(31 * 60));
        requests.save(r);
        assertTrue(body(getAs(client, "/api/help/active")).get("asClient").isNull(), "unanswered for 30 min -> expired");
        assertEquals(HelpStatus.EXPIRED, requests.findById(r.getId()).orElseThrow().getStatus());
    }

    @Test
    void registrationStoresAccountTypeAndProfileShowsPoints() throws Exception {
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"maria_v\",\"email\":\"maria@example.com\",\"password\":\"Parola123\",\"fullName\":\"Maria\",\"accountType\":\"VOLUNTEER\"}"))
                .andExpect(status().isCreated());
        User m = users.findByUsernameIgnoreCase("maria_v").orElseThrow();
        assertEquals(AccountType.VOLUNTEER, m.getAccountType());

        JsonNode me = body(getAs(m, "/api/auth/me"));
        assertEquals("VOLUNTEER", me.get("accountType").asText());
        assertEquals(0, me.get("deedPoints").asInt());
    }

    // ─── helpers ─────────────────────────────────────────────────────────────────

    private User user(String username, String fullName, AccountType type) {
        User u = new User();
        u.setUsername(username);
        u.setEmail(username + "@example.com");
        u.setFullName(fullName);
        u.setAccountType(type);
        u.setDeedPoints(0);
        u.setDeedsCompleted(0);
        return users.save(u);
    }

    private Cookie session(User u) {
        return new Cookie(SessionCookie.NAME, jwt.generateToken(u));
    }

    private ResultActions postJson(User u, String url, String body) throws Exception {
        return mvc.perform(post(url).cookie(session(u)).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions getAs(User u, String url) throws Exception {
        return mvc.perform(get(url).cookie(session(u)));
    }

    private ResultActions presence(User u, double lat, double lng, boolean onDuty) throws Exception {
        return postJson(u, "/api/volunteers/presence",
                "{\"latitude\":%s,\"longitude\":%s,\"onDuty\":%s}".formatted(lat, lng, onDuty));
    }

    private JsonNode body(ResultActions r) throws Exception {
        String s = r.andReturn().getResponse().getContentAsString();
        return s.isEmpty() ? json.nullNode() : json.readTree(s);
    }
}
