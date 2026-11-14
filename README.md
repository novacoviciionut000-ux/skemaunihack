# unihack-spaimaterminalelor

AccessMap — Documentație Tehnică
Repository: novacoviciionut000-ux/skemaunihack Commit documentat: f47d0439b3bc28ceaab8112f2af445ff0d0482d9 (14 noiembrie 2026, 82 commit-uri)

1. Introducere
AccessMap este o aplicație web de navigare pietonală destinată persoanelor cu dizabilități (nevăzători/slab-văzători, utilizatori de scaun cu rotile, mobilitate limitată), construită în cadrul hackathon-ului UniHack la Timișoara. Combină:

hartă interactivă cu rutare pietonală accesibilă (evită obstacole raportate de comunitate),
asistent vocal în limba română pentru comenzi de navigare ("Du-mă la Kaufland"),
detectare de obstacole, semafoare și treceri de pietoni în timp real prin camera telefonului, folosind TensorFlow.js,
un sistem de "semnal de ajutor" prin care un utilizator poate chema un voluntar din apropiere, cu puncte de recompensă ("Deed points") pentru voluntari.
Proiectul este format din două jumătăți independente:

Partea	Tehnologie	Locație
Backend API	Java 17, Spring Boot 3.3.5	accessmap/backend/
Frontend	React 18 + Vite	accessmap/frontend/
Motor de rutare	GraphHopper (în Docker)	accessmap/routing/, accessmap/data/
Există și un folder backend/ la rădăcina repo-ului (în afara lui accessmap/) care este un schelet Spring Boot complet gol (BackendApplication.java fără cod), rămas probabil dintr-o configurare inițială — nu face parte din aplicația reală, care trăiește exclusiv în accessmap/.

2. Structura repository-ului
skemaunihack/
├── backend/                     ← schelet Spring Boot gol, neutilizat
├── accessmap/                   ← aplicația reală
│   ├── backend/                 ← API Java/Spring Boot
│   │   └── src/main/java/com/accessmap/
│   │       ├── auth/            ← autentificare, JWT, OAuth Google
│   │       ├── common/          ← utilitare (Coordinate, ClientIp)
│   │       ├── config/          ← CORS, rate limiting
│   │       ├── crossing/        ← treceri de pietoni (OSM)
│   │       ├── geocode/         ← geocodare adrese
│   │       ├── help/            ← sistem voluntari / "Deed points"
│   │       ├── report/          ← raportare obstacole
│   │       ├── route/           ← rutare (GraphHopper + fallback OSRM)
│   │       └── tts/             ← proxy text-to-speech
│   ├── frontend/                ← SPA React + Vite
│   │   └── src/
│   │       ├── api/             ← client HTTP către backend
│   │       ├── components/      ← componente UI (Map, Camera, Voice, Help...)
│   │       ├── context/         ← AuthContext
│   │       ├── hooks/           ← useVoiceAssistant, useIsMobile
│   │       └── utils/           ← logica "inteligentă" (voce, viziune, navigare)
│   ├── routing/models/          ← profiluri custom GraphHopper (JSON)
│   ├── data/config.yml          ← configurare server GraphHopper
│   ├── docs/api.md              ← exemple JSON de request/response
│   └── docker-compose.yml       ← PostGIS + GraphHopper
├── cloudflared                  ← binar precompilat (tunel Cloudflare pentru acces mobil)
├── start.sh / start.bat         ← scripturi de pornire all-in-one
└── README.md
3. Stack tehnologic
Backend (accessmap/backend/pom.xml):

Spring Boot 3.3.5, Java 17
Spring Web, Spring Data JPA, Spring Security
PostgreSQL (driver org.postgresql) — baza de date reală este Supabase (Postgres + PostGIS, găzduit), conectat prin connection pooler
JJWT 0.12.6 pentru token-uri JWT
H2 (doar pentru teste de integrare, în memorie)
Lombok
Frontend (accessmap/frontend/package.json):

React 18 + Vite 4
react-leaflet + leaflet — hartă
@tensorflow/tfjs + @tensorflow-models/coco-ssd — detectare obiecte prin cameră
axios — prezent ca dependință, dar neutilizat direct (stratul HTTP e scris manual peste fetch)
lucide-react — iconițe
Infrastructură:

Docker Compose: PostGIS 16-3.4 + GraphHopper 8.0 (motor de rutare open-source, descarcă harta României de pe Geofabrik la prima pornire)
Cloudflare Tunnel (binar cloudflared inclus în repo) — pentru testare pe telefon mobil real fără HTTPS local
4. Backend (Spring Boot)
4.1 Punct de intrare
accessmap/backend/src/main/java/com/accessmap/AccessMapApplication.java este un @SpringBootApplication standard, fără configurare suplimentară — toată logica e în componentele de mai jos, auto-descoperite prin scanare de pachete.

Configurarea centrală e în application.yml, care citește totul din variabile de mediu / fișier .env (niciun secret nu e scris în cod):

# accessmap/backend/src/main/resources/application.yml
spring:
  config:
    import: "optional:file:.env[.properties],optional:file:../.env[.properties],optional:file:../../.env[.properties]"
  datasource:
    # 6543 = Supabase transaction pooler (5432 session pooler e limitat la 15 clienti in total)
    url: "${DB_URL}"
    username: "${DB_USERNAME}"
    password: "${DB_PASSWORD}"
Observație: hibernate.ddl-auto: update — schema bazei de date e generată/actualizată automat din entitățile JPA la fiecare pornire, tipic pentru viteza unui hackathon, dar riscant într-un mediu de producție (poate altera schema fără migrare controlată).

4.2 Securitate și autentificare (auth/)
4.2.1 Configurarea de securitate
auth/security/SecurityConfig.java definește un lanț de filtre Spring Security complet stateless (fără sesiuni server-side — starea e doar în JWT):

// SecurityConfig.java
.csrf(AbstractHttpConfigurer::disable)   // sigur: cookie-ul de sesiune e SameSite=Strict
.cors(cors -> cors.configurationSource(corsConfigurationSource()))
.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
.authorizeHttpRequests(auth -> auth
        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login",
                "/api/auth/oauth", "/api/auth/oauth/*", "/api/auth/logout").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/v1/**").permitAll()          // rutare, TTS
        .requestMatchers("/api/geocode/**").permitAll()
        .requestMatchers(HttpMethod.GET, "/api/reports").permitAll()
        .requestMatchers("/api/auth/me", "/api/auth/profile").authenticated()
        .requestMatchers("/api/help", "/api/help/**", "/api/volunteers/**").authenticated()
        .anyRequest().denyAll()                                            // whitelist strict
)
.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);
Politica este whitelist explicită (anyRequest().denyAll()): orice rută nouă adăugată de un dezvoltator trebuie listată manual aici, altfel e refuzată automat — previne scurgeri accidentale de endpoint-uri neprotejate.

Parolele sunt hash-uite cu BCrypt, factor 12:

@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
}
Notă (cod duplicat/neutilizat): există și config/CorsConfig.java, o configurare CORS separată bazată pe WebMvcConfigurer, care permite doar localhost:3000/5173. Aceasta este efectiv suprascrisă/irelevantă, fiindcă Spring Security interceptează cererile mai întâi și folosește CORS-ul definit în SecurityConfig.corsConfigurationSource() (mai permisiv, acceptă și tunelul Cloudflare). Fișierul CorsConfig.java pare un rest dintr-o versiune anterioară și poate fi șters în siguranță.

4.2.2 JWT — generare și validare
auth/security/JwtUtil.java semnează token-urile HMAC-SHA256 cu o cheie din JWT_SECRET:

public JwtUtil(@Value("${jwt.secret:}") String secret, @Value("${jwt.expiration-ms:86400000}") long expirationMs) {
    byte[] keyBytes = secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
    if (keyBytes.length == 0) {
        // Fără secret configurat: cheie aleatorie per-proces, ca token-urile să nu poată
        // fi contrafăcute cu o valoare din codul sursă. Token-urile devin invalide la restart.
        keyBytes = new byte[48];
        new SecureRandom().nextBytes(keyBytes);
        log.warn("JWT_SECRET is not set; using a random key...");
    } else if (keyBytes.length < 32) {
        throw new IllegalStateException("JWT_SECRET must be at least 32 bytes (256 bits) long.");
    }
    this.key = Keys.hmacShaKeyFor(keyBytes);
}
Fail-safe inteligent: dacă variabila JWT_SECRET nu e setată, aplicația nu refuză să pornească — generează o cheie aleatoare în memorie, astfel încât token-urile rămân valide doar până la următorul restart, dar nu pot fi niciodată forjate folosind o cheie hardcodată găsită în surse.

Token-ul transportă userId, email, role, fullName, preferredProfile, provider ca claims și e citit fie din header Authorization: Bearer, fie — cazul principal pentru browser — dintr-un cookie HttpOnly (auth/security/SessionCookie.java), extras în JwtAuthenticationFilter:

// JwtAuthenticationFilter.java
private String resolveToken(HttpServletRequest request) {
    String cookieToken = SessionCookie.read(request);     // sesiuni browser
    if (StringUtils.hasText(cookieToken)) return cookieToken;
    String bearerToken = request.getHeader("Authorization"); // clienți non-browser
    if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
        return bearerToken.substring(7);
    }
    return null;
}
Această alegere (cookie HttpOnly + SameSite=Strict în loc de token în localStorage) înseamnă că scripturile din pagină nu pot citi niciodată JWT-ul — protecție directă împotriva XSS care ar fura sesiunea. Pe frontend, api/client.js chiar șterge explicit la încărcare orice JWT rămas în localStorage dintr-o versiune mai veche a aplicației.

4.2.3 Login, înregistrare, OAuth Google (AuthService.java)
Punctele notabile de securitate din register()/login():

Verificare unicitate username/email case-insensitive înainte de creare.
Parolă: regex ^(?=.*[A-Za-z])(?=.*\d).{8,}$ (minim 8 caractere, literă + cifră).
Timing attack mitigation: la un username inexistent, codul tot rulează o comparație BCrypt față de un hash "momeală" (dummyPasswordHash, generat random la pornirea serviciului), ca timpul de răspuns să nu dea de gol dacă un cont există sau nu:
if (userOpt.isEmpty()) {
    passwordEncoder.matches(request.getPassword(), dummyPasswordHash);
    recordFailure(clientIp, identifier);
    throw new BadCredentialsException("Nume de utilizator/email sau parolă incorectă.");
}
Rate limiting pe login, cu chei compuse per IP+cont (vezi RateLimitingService mai jos) — nu mai poate un atacator bloca un cont victimă doar trimițând parole greșite de pe altă adresă IP, pentru că cheia combină ambele.
OAuth Google verifică token-ul server-side, nu are încredere în nimic trimis de client:

private void verifyGoogleToken(OAuthRequest request) {
    ...
    HttpRequest httpReq = HttpRequest.newBuilder()
            .uri(URI.create("https://oauth2.googleapis.com/tokeninfo?" + param + "=" + ...))
            .build();
    HttpResponse<String> resp = HTTP.send(httpReq, HttpResponse.BodyHandlers.ofString());
    ...
    // Token-ul trebuie emis pentru clientul NOSTRU, altfel un token de pe orice alt site
    // Google ar putea fi "replay-uit" aici.
    String aud = info.path("aud").asText("");
    String azp = info.path("azp").asText("");
    if (!googleClientId.equals(aud) && !googleClientId.equals(azp)) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token-ul Google nu a fost emis pentru această aplicație.");
    }
}
Identitatea (email, nume, poză) e luată exclusiv din răspunsul verificat de Google, niciodată din body-ul request-ului client — altfel oricine ar putea pretinde orice email. La prima legare a unui cont Google de un cont existent găsit prin email, parola locală veche e ștearsă (setPasswordHash(null)), pentru că cineva s-ar fi putut pre-înregistra cu adresa de email a victimei înainte ca aceasta să vină cu Google; dovada Google e mai de încredere.

Observație: Facebook OAuth e definit în enum (AuthProvider.FACEBOOK) dar explicit respins la runtime ("Doar autentificarea Google este suportată.") — cod pregătit dar neterminat, lăsat intenționat dezactivat din motive de securitate (nu exista verificare server-side pentru el).

4.2.4 Rate limiting (două straturi diferite)
Există două mecanisme de limitare a ratei, cu scopuri diferite:

auth/security/RateLimitingService.java — specific pentru brute-force pe login: fereastră glisantă de 5 minute, blocare temporară (lockout-duration-minutes: 15) după max-attempts: 5 greșeli pe aceeași cheie.
public void recordFailedAttempt(String key, int threshold) {
    attemptsCache.compute(key, (k, current) -> {
        Instant now = Instant.now();
        if (current == null || current.isWindowExpired(now)) {
            return new AttemptInfo(1, now.plusSeconds(300), null);
        }
        int count = current.count + 1;
        Instant lockedUntil = current.lockedUntil;
        if (count >= threshold) lockedUntil = now.plusSeconds(lockoutDurationSeconds);
        return new AttemptInfo(count, current.windowExpiry, lockedUntil);
    });
}
config/ApiRateLimitFilter.java — limitare generală per-IP, per minut, aplicată la nivel de filtru HTTP (ordine HIGHEST_PRECEDENCE + 10, rulează înaintea oricărei alte logici), cu reguli diferite per endpoint:
private static final List<Rule> RULES = List.of(
        new Rule("tts", "GET", "/api/v1/tts", 60),
        new Rule("route", "GET", "/api/v1/route", 30),
        new Rule("geocode", null, "/api/geocode", 60),      // costă bani (Google Maps)
        new Rule("report", "POST", "/api/reports", 20),
        new Rule("help-create", "POST", "/api/help$", 20),
        new Rule("presence", "POST", "/api/volunteers/presence", 90), // heartbeat la ~8s
        new Rule("register", "POST", "/api/auth/register", 5)
);
Scopul principal al acestui filtru nu e securitatea contului, ci protejarea costurilor (geocodarea Google Maps e plătită per apel) și prevenirea abuzului pe endpoint-uri publice (rapoarte, TTS, rutare) care nu cer autentificare.

4.3 Rutare (route/)
RouteController expune /api/v1/route, validează coordonatele și profilul de deplasare, apoi delegă la GraphHopperClient:

// RouteController.java
private static final Set<String> ALLOWED_PROFILES =
        Set.of("wheelchair", "low_vision", "limited_mobility", "foot", "pedestrian");

@GetMapping("/route")
public ResponseEntity<?> getRoute(@RequestParam double startLat, @RequestParam double startLng,
                                   @RequestParam double endLat, @RequestParam double endLng,
                                   @RequestParam(defaultValue = "wheelchair") String profile) {
    if (!isValidCoordinate(startLat, startLng) || !isValidCoordinate(endLat, endLng))
        return ResponseEntity.badRequest().body("Coordonate invalide.");
    if (!ALLOWED_PROFILES.contains(profile))
        return ResponseEntity.badRequest().body("Profil de deplasare necunoscut.");
    RouteResponse route = graphHopperClient.fetchRoute(startLat, startLng, endLat, endLng, profile,
            blockedAreaProvider.getBlockedAreas());
    return ResponseEntity.ok(route);
}
GraphHopperClient implementează un lanț de fallback în trei trepte pentru robustețe maximă la o demonstrație live:

GraphHopper local (Docker, portul 8989), cu modul flexibil (ch.disable=true, necesar pentru a putea trimite block_area) și zonele blocate injectate direct în query:
UriComponentsBuilder builder = UriComponentsBuilder.fromUriString(graphHopperUrl)
        .queryParam("point", startLat + "," + startLon)
        .queryParam("point", endLat + "," + endLon)
        .queryParam("profile", profile)
        .queryParam("ch.disable", "true");
if (blockedAreas != null && !blockedAreas.isEmpty()) {
    String blockAreaParam = blockedAreas.stream()
            .map(BlockedArea::toGraphHopperParam)   // "lat,lon,raza"
            .collect(Collectors.joining(";"));
    builder.queryParam("block_area", blockAreaParam);
}
Dacă GraphHopper nu răspunde (containerul nu a pornit / nu a terminat de indexat harta): fallback la OSRM public (routing.openstreetmap.de/routed-foot), un ruter de pietoni real pe OpenStreetMap.
Dacă ambele eșuează: RouteResponse gol (listă de puncte vidă, distanță 0) — frontend-ul are propriul lanț de fallback suplimentar (vezi §5.2), inclusiv o linie dreaptă haversine ca ultimă soluție.
Obstacolele blocate (BlockedAreaProvider, interfață) sunt alimentate din rapoartele active ale comunității prin ReportBlockedAreaProvider:

// ReportBlockedAreaProvider.java
@Override
public List<BlockedArea> getBlockedAreas() {
    return reportService.getActiveReports().stream()
            .map(report -> new BlockedArea(report.getLatitude(), report.getLongitude(), 20.0))
            .collect(Collectors.toList());
}
Fiecare raport activ (trotuar blocat, lift stricat etc.) devine un cerc de 20 m rază pe care GraphHopper îl evită la calcularea rutei — astfel rutarea "accesibilă" nu e doar teoretică (profil wheelchair/low_vision), ci reacționează dinamic la obstacole raportate de utilizatori.

Există și o clasă RouteService.java cu aceeași logică de bază (calculateRoute), dar care nu este folosită de RouteController (controller-ul apelează direct GraphHopperClient) — pare un rest de refactorizare, cod mort dar inofensiv.

Profilurile custom GraphHopper (routing/models/wheelchair.json, limited_mobility.json, low_vision.json) sunt fișiere de configurare JSON care spun motorului GraphHopper cum să pondereze tipurile de drum/suprafață/pantă pentru fiecare profil de mobilitate — montate în container prin docker-compose.yml (./routing/models:/models:ro) și referite din data/config.yml:

# accessmap/data/config.yml
profiles:
  - name: wheelchair
    vehicle: wheelchair
    custom_model_files: [wheelchair.json]
  - name: limited_mobility
    vehicle: foot
    custom_model_files: [limited_mobility.json]
  - name: low_vision
    vehicle: foot
    custom_model_files: [low_vision.json]
4.4 Geocodare (geocode/)
GeocodeController expune trei rute (/api/geocode, /suggest, /batch), toate cu validare de lungime a interogării și, pentru batch, o limită hard de 10 adrese per request:

@PostMapping("/batch")
public List<GeocodeResult> many(@RequestBody List<String> addresses) {
    // Fiecare adresă e un apel plătit la Google Maps API; limităm batch-ul ca o
    // singură cerere să nu poată consuma cota.
    if (addresses == null || addresses.size() > MAX_BATCH) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Maxim " + MAX_BATCH + " adrese per cerere.");
    }
    return service.geocodeAll(addresses.stream().map(GeocodeController::clip).toList());
}
4.5 Treceri de pietoni (crossing/)
CrossingController (GET /api/crossings?south=..&west=..&north=..&east=..) returnează trecerile de pietoni cunoscute (din OpenStreetMap) într-un bounding box — consumat de frontend prin crossingStore.js pentru a anunța vocal "trecere de pietoni la X metri" înainte ca utilizatorul să ajungă la ea (§5.3).

4.6 Rapoarte de obstacole (report/)
ReportService implementează un sistem de votare comunitară pentru a decide dacă un obstacol raportat încă există:

// ReportService.java
public synchronized NotThereResult markNotThere(Long id, String clientIp) {
    Report report = repository.findById(id).orElse(null);
    if (report == null || !report.isActive()) { ... }
    if (votes.putIfAbsent("gone:" + id + ":" + clientIp, Boolean.TRUE) == null) {
        report.setNotThereVotes(report.getNotThereVotes() + 1);
        // Pragul e 3 voturi "a disparut" ȚI mai multe decât cele care l-au confirmat,
        // ca o singură persoană să nu poată șterge un obstacol real pe care alții îl confirmă.
        if (report.getNotThereVotes() >= NOT_THERE_THRESHOLD
                && report.getNotThereVotes() > report.getUpvotes()) {
            report.setActive(false);
        }
        repository.save(report);
    }
    return new NotThereResult(!report.isActive(), report.getNotThereVotes());
}
Votarea e limitată o dată per IP per raport printr-o hartă "reportId:ip" → Boolean ținută în memorie, mărginită la 10.000 de intrări (MAX_TRACKED_VOTES) cu eviction LRU — suficient pentru scara unui hackathon, dar se resetează la restart și nu scalează pe mai multe instanțe de backend (nu e partajată, de ex., prin Redis).

4.7 Sistem de ajutor / voluntari (help/) — cea mai complexă componentă de business logic
HelpService modelează un sistem de tip "SOS către cei din apropiere", documentat explicit în javadoc-ul clasei:

/**
 * Semnale de ajutor de la clienți, răspunse de cei mai apropiați voluntari.
 *
 * Cine vede o cerere: doar voluntarii activi (poziție trimisă în ultimele
 * {@link #PRESENCE_FRESH}) și în raza {@link #MAX_RADIUS_M}. La început doar cei mai
 * apropiați {@link #FIRST_WAVE} o văd; la fiecare {@link #WAVE_INTERVAL} fără răspuns,
 * cercul se mărește cu un alt "val". Coordonatele exacte ale clientului sunt dezvăluite
 * doar voluntarului care acceptă.
 */
static final double MAX_RADIUS_M = 15_000;
static final int FIRST_WAVE = 5;
static final Duration WAVE_INTERVAL = Duration.ofSeconds(60);
Logica de vizibilitate progresivă (isVisibleTo) e esența designului: nu trimite cererea la toți voluntarii din oraș deodată, ci o arată mai întâi celor 5 cei mai apropiați, și lărgește cercul la fiecare minut de inactivitate:

boolean isVisibleTo(HelpRequest r, VolunteerPresence p, List<VolunteerPresence> onDuty) {
    double d = DeedPoints.haversine(r.getLatitude(), r.getLongitude(), p.getLatitude(), p.getLongitude());
    if (d > MAX_RADIUS_M) return false;
    long waves = 1 + Math.max(0, Duration.between(r.getCreatedAt(), Instant.now()).getSeconds()) / WAVE_INTERVAL.getSeconds();
    long allowed = FIRST_WAVE * waves;
    long closer = onDuty.stream()
            .filter(o -> !o.getUserId().equals(p.getUserId()) && !o.getUserId().equals(r.getClientId()))
            .filter(o -> DeedPoints.haversine(r.getLatitude(), r.getLongitude(), o.getLatitude(), o.getLongitude()) < d)
            .count();
    return closer < allowed;   // vizibil doar dacă e printre cei "allowed" cei mai apropiați
}
Fluxul de stare al unei cereri (enum HelpStatus): OPEN → ACCEPTED → AWAITING_CONFIRMATION → COMPLETED (sau CANCELLED/EXPIRED/înapoi la OPEN dacă voluntarul eliberează cererea). Confirmarea finală e cerută de la client, nu doar declarată de voluntar, ca să nu poată un voluntar să-și acorde puncte fără ca fapta să fie confirmată:

@Transactional
public ClientView confirm(String username, Long id, boolean completed) {
    ...
    if (!completed) {
        r.setStatus(HelpStatus.ACCEPTED);        // înapoi la "în lucru"
        r.setRejectedCount(r.getRejectedCount() + 1);
        return clientView(save(r));
    }
    DeedPoints.Breakdown points = breakdown(r);
    r.setStatus(HelpStatus.COMPLETED);
    r.setPointsAwarded(points.total());
    save(r);
    ...
}
Calculul punctelor (DeedPoints.java) e transparent și documentat ca formulă:

/**
 *   bază                          50
 *   răspuns rapid (<= 1 min)     +25   (<= 3 min: +10)
 *   distanță      1 per 50 m     +50 max, de la locul de unde voluntarul a acceptat
 *   din prima      (clientul a zis "da" prima dată)  +10
 */
public static Breakdown compute(Instant createdAt, Instant acceptedAt, double travelMeters, int rejectedCount) {
    int speed = seconds <= 60 ? FAST_BONUS : seconds <= 180 ? QUICK_BONUS : 0;
    int distance = (int) Math.min(MAX_DISTANCE_BONUS, Math.max(0, Math.floor(travelMeters / 50.0)));
    int firstTry = rejectedCount == 0 ? FIRST_TRY_BONUS : 0;
    return new Breakdown(BASE, speed, distance, firstTry);
}
Nivelurile de voluntar ("Începător" → "Bronz" → "Argint" → "Aur" → "Platină" → "Înger păzitor") sunt praguri simple pe punctele acumulate, afișate pe un leaderboard (GET /api/volunteers/leaderboard, top 10).

HelpController expune toate aceste operații ca REST API protejat (toate rutele sub /api/help și /api/volunteers cer autentificare, conform SecurityConfig), cu validare jakarta.validation pe coordonate (@DecimalMin/@DecimalMax -90..90 / -180..180) direct în body-urile de request:

public record LocationBody(
        @NotNull @DecimalMin("-90.0") @DecimalMax("90.0") Double latitude,
        @NotNull @DecimalMin("-180.0") @DecimalMax("180.0") Double longitude,
        @Size(max = 200) String note) {}
4.8 Text-to-Speech proxy (tts/)
TtsController (GET /api/v1/tts?text=..&lang=ro) e un proxy simplu către endpoint-ul neoficial translate.google.com/translate_tts, cu un cache LRU în memorie (max 200 intrări) ca aceeași frază să nu fie cerută de la Google de mai multe ori:

HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(url))
        .header("User-Agent", "Mozilla/5.0 ...")   // necesar, altfel Google respinge cererea
        .header("Referer", "https://translate.google.com/")
        .build();
Acest proxy e folosit de frontend ca fallback pe iOS când speechSynthesis din Web Speech API e mut în timp ce camera e activă (vezi §5.4, speechQueue.js).

4.9 Teste backend
Pachetul src/test/java/com/accessmap/ conține teste pentru AuthServiceTest, DeedPointsTest, HelpFlowIntegrationTest, ReportServiceTest, rulate pe o bază de date H2 în memorie (niciodată pe Supabase real) — vezi dependința h2 cu scope: test în pom.xml. GeocodingServeTest.java și RouteServiceTest.java existau ca fișiere dar erau goale (0 bytes) la acest commit — teste planificate, nescrise încă.

5. Frontend (React + Vite)
5.1 Bootstrap și orchestrare
main.jsx montează aplicația sub un singur AuthProvider (nu există Redux/Zustand — toată starea e useState/useRef locală în App.jsx plus câteva evenimente CustomEvent pentru comunicare între componente îndepărtate):

// main.jsx
ReactDOM.createRoot(document.getElementById('root')).render(
    <AuthProvider>
        <App />
    </AuthProvider>
)
App.jsx (~800 linii) este orchestratorul central — nu există router, totul e o singură hartă full-screen cu overlay-uri comutate prin stare (authModalOpen, cameraOpen, sidebarCollapsed etc.). Fiecare responsabilitate majoră e un useEffect separat:

Urmărire GPS continuă, cu tratament special pentru iOS (coboară la precizie redusă după 2 timeout-uri consecutive, se re-armează la visibilitychange):

// App.jsx
const handleError = (err) => {
    // Timeout-uri repetate pe iOS înseamnă de obicei că fix-ul de înaltă precizie nu
    // ajunge niciodată. Trecerea la providerul "coarse" dă o poziție din wifi/celular
    // în loc de nimic.
    if (err.code === 3 && highAccuracy && ++timeouts >= 2) {
        highAccuracy = false;
        startWatch();
        return;
    }
    ...
};
Codul distinge explicit între heading-ul busolei (unde arată telefonul) și "course over ground" (direcția reală de mers, derivată din deplasarea GPS), pentru că detectorul de "mers în direcție greșită" are nevoie de a doua, nu de prima:

if (heading != null && (speed ?? 0) >= 0.5) {
    next.course = heading;
    next.courseSpeed = speed;
} else if (prev && !prev.isFallback) {
    const moved = getDistanceMeters(prev, next);
    if (moved >= Math.max(6, (pos.coords.accuracy || 15) * 0.5) && elapsed > 0) {
        next.course = Math.round(getBearing(prev, next));
        next.courseSpeed = moved / elapsed;
    }
}
Avertizare "mers în direcție greșită", confirmată peste WRONG_WAY_CONFIRM_MS = 3500 ms (ca o devansare laterală sau un fix GPS zgomotos să nu declanșeze fals alarma), repetată la fiecare 12 secunde cât timp persistă:

if (!state.since) { state.since = now; return; }
if (now - state.since < WRONG_WAY_CONFIRM_MS) return;
setIsWrongWay(true);
if (now - state.spokenAt < WRONG_WAY_REPEAT_MS) return;
speechQueue.speak('Mergi în direcția opusă. Întoarce-te.', { priority: 'urgent' });
navigator.vibrate([200, 100, 200, 100, 200]);
Anunțuri de treceri de pietoni: la 35 m distanță anunță "trecere de pietoni la X metri", la 10 m anunță imperativ să se oprească și să asculte traficul / să aștepte verde — distanța vine din progresul pe rută (GPS), nu din cameră, ca avertismentul să ajungă înainte ca trecerea să fie vizibilă:

const message = stage === 'imminent'
    ? next.hasSignals
        ? `${label}. Oprește și așteaptă semaforul verde.`
        : `${label}. Oprește și ascultă traficul înainte să treci.`
    : `${label} la ${Math.round(distance)} metri.`;
speechQueue.speak(message, { priority: stage === 'imminent' ? 'danger' : 'high' });
Simulare de mers pentru demo: isSimulating avansează un punct de-a lungul rutei la fiecare 700ms — util pentru prezentarea proiectului la hackathon fără a merge fizic cu telefonul.

5.2 Stratul API (api/client.js)
Nu există o instanță axios (deși e listat ca dependență) — stratul HTTP e scris manual peste fetch, cu autentificare exclusiv prin cookie (nu header Bearer):

// api/client.js
const request = async (url, options = {}) => {
    const headers = { 'Accept': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    const text = await res.text();
    let data = text ? JSON.parse(text) : text;
    if (!res.ok) {
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return data;
};
getRoute() implementează același lanț de fallback în 3 trepte ca backend-ul, dar la nivel de client (dacă backend-ul însuși nu răspunde deloc, nu doar dacă GraphHopper e jos):

// 1. Backend Spring Boot (/api/v1/route)
// 2. OSRM public (2 oglinzi încercate în secvență)
// 3. Linie dreaptă haversine, marcată isFallback: true
const osrmEndpoints = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${...}`,
    `https://router.project-osrm.org/route/v1/foot/${...}`,
];
Timpul estimat e scalat pe baza profilului de mobilitate: wheelchair ×1.1, limited_mobility ×1.25.

findClosestPlace() este motorul din spatele destinațiilor vocale ("du-mă la Kaufland"): combină o listă hard-codată de ~30 repere din Timișoara (TIMISOARA_LANDMARKS) cu rezultate live de la Nominatim și geocodarea backend-ului, scorează candidații prin potrivire fuzzy de nume (distanță Levenshtein), filtrează tipuri OSM irelevante (construction, disused, ...), și — dintre candidații cu scor egal — alege pe cel mai apropiat geografic de utilizator.

5.3 Harta (components/Map.jsx)
Bazată pe react-leaflet, cu 5 stiluri de hartă gratuite fără cheie API (OSM standard, satelit Esri, CyclOSM pentru trotuare, OpenTopoMap, Humanitarian OSM contrast ridicat):

export const MAP_STYLES = {
  osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', ... },
  satellite: { url: 'https://server.arcgisonline.com/.../World_Imagery/...', ... },
  accessibility: { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', ... },
  ...
};
Marcatorul utilizatorului (createUserPuckIcon) e un L.divIcon animat (inel pulsatoriu + con de direcție) care se rotește după heading-ul telefonului. Ruta e desenată ca două Polyline suprapuse (contur întunecat + linie albastră deasupra), iar deturnările salvate de alți utilizatori apar ca linii verzi punctate.

5.4 Asistent vocal (utils/voiceCommands.js + hooks/useVoiceAssistant.js)
voiceCommands.js este un modul pur (fără React, fără rețea), special ca să poată fi testat unitar — scopul lui e să transforme text imprecis din recunoaștere vocală în comenzi clare. Fiecare funcție e documentată cu motivul ei:

/**
 * Transformă ce a auzit recunoașterea vocală într-o comandă.
 *
 * Recunoașterea vocală e imprecisă: "Du-mă la Kaufland" poate apărea ca "Dumă la Kaufland",
 * "du mi la kaufland", "Du-mă la Cofland" sau "Du-mă la Kaufland-ul de pe Gheorghe Lazăr".
 */
Corectarea foneticã a mărcilor comerciale (correctPlaceName/matchKnownPlace) foloseşte o cheie fonetică simplificată (c/k/q→k, ph→f, w→v) plus distanță de editare, ca "Cofland" sau "Carfur" să fie recunoscute ca "Kaufland"/"Carrefour":

function matchKnownPlace(v) {
  const hit = PLACE_KEYS.find((p) => {
    const tolerance = p.key.length >= 8 ? 2 : p.key.length >= 6 ? 1 : 0;
    return Math.abs(p.key.length - v.length) <= tolerance && editDistance(p.key, v) <= tolerance;
  });
  return hit || null;
}
parseVoiceCommand() recunoaște ~20 de tipuri de intenții (destinație, urgență, camera, start/stop navigare, sistemul de ajutor, control microfon) cu reguli de prioritate explicite — de exemplu, o comandă "du-mă la ..." câștigă în fața cuvintelor de urgență conținute în denumirea unui loc ("du-mă la spitalul de urgență" navighează, nu declanșează alarma 112), și contextul (ctx.isClient) schimbă ce înseamnă un simplu "ajutor":

// Un client autentificat spunând doar "ajutor" cheamă un voluntar, nu ecranul 112
if (BARE_HELP.includes(text) || hasPhrase(text, BARE_HELP)) {
    return result(ctx.isClient ? 'call-volunteer' : 'emergency');
}
Acest fișier este acoperit integral de teste (tests/voiceCommands.test.mjs, ~60 de cazuri tabelare), rulate cu node + esbuild (fără Jest/Vitest — proiectul folosește scripturi simple Node, nu un framework de testare).

useVoiceAssistant.js e wrapper-ul React peste Web Speech API: pornește recunoaşterea, colectează toate alternativele oferite de motor, și le trimite către pickBestCommand() din modulul pur, care alege alternativa cea mai utilă (o destinație cu nume cunoscut câștigă în fața unei destinații generice, care câștigă în fața oricărei alte comenzi).

5.5 Detectare obstacole prin cameră (utils/obstacleDetector.js + components/CameraObstacleDetector.jsx)
Cea mai elaborată subcomponentă tehnică a proiectului. Modelul TensorFlow (COCO-SSD, varianta lite_mobilenet_v2) e importat dinamic, nu static, exact ca să nu îngreuneze încărcarea inițială a hărții pentru utilizatorii care nu deschid niciodată camera:

// obstacleDetector.js
export async function loadObstacleModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [tf, cocoSsd] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/coco-ssd'),
      ]);
      await tf.ready();
      return cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return modelPromise;
}
Estimarea distanței față de un obiect detectat foloseşte un model de cameră pinhole (înălțimea reală cunoscută a clasei de obiect împărțită la raportul dintre înălțimea cutiei de detecție și cadru), cu netezire adaptivă (coeficient EMA mai mare când obiectul se apropie rapid):

function estimateDistanceMeters(cls, width, height, boxBottom, frameHeight) {
  const objectHeight = CLASS_HEIGHT_M[cls] ?? DEFAULT_HEIGHT_M;
  const heightRatio = height / frameHeight;
  let distance = objectHeight / (FOV_SCALE * heightRatio);
  // O persoană foarte apropiată are picioarele în afara cadrului: cutia vizibilă e scurtă
  // și o estimare bazată doar pe înălțime ar plasa-o mai departe decât e în realitate.
  const isClipped = boxBottom >= frameHeight - 2;
  if (cls === 'person' && isClipped && width > 0) {
    const fromWidth = PERSON_WIDTH_M / (FOV_SCALE * (width / frameHeight));
    distance = Math.min(distance, fromWidth);
  }
  return Math.max(0.4, Math.min(MAX_DISTANCE_M, distance));
}
Culoarea semaforului se determină prin analiza pixelilor direct din video la rezoluție nativă (nu din cadrul redus folosit pentru restul analizei — altfel un semafor de 5% din înălțimea cadrului ar avea doar ~6 pixeli, insuficient pentru a distinge roșu de verde), iar tipul de semafor (pietonal vs. auto) se deduce din raportul de aspect al cutiei (COCO-SSD are o singură clasă "traffic light" pentru ambele):

const PED_LIGHT_MAX_ASPECT = 2.2; // h/w sub acest prag = semafor pietonal
const CAR_LIGHT_MIN_ASPECT = 2.6; // h/w peste acest prag = semafor auto
Detectarea trecerii de pietoni (detectCrosswalk) scanează partea inferioară a cadrului pentru benzi alternante clar/întunecat (zebră), cu praguri deliberat stricte și confirmate pe 4 cadre consecutive — pentru că, în cuvintele comentariului din cod, "a rata o trecere e eroarea mai sigură" decât a anunța fals una unde nu există și a trimite un utilizator nevăzător în carosabil. Camera anunță trecerea doar când harta (din crossingStore.js) nu are deja informații despre acel loc, ca să nu dubleze anunțul.

Detectarea marginii trotuarului (analyzeSidewalkPath) compară cromaticitate (invariantă la umbre), luminanță, textură și gradientul de bordură între centru și laturile cadrului, cu histerezis, pentru a ghida steering-ul ("ține-te mai la stânga/dreapta") — ținând cont și de obstacolele confirmate din apropiere, ca o corecție să nu direcționeze niciodată utilizatorul spre alt pericol.

5.6 Context de autentificare (context/AuthContext.jsx)
Un singur AuthContext, care la montare apelează authGetMe() pentru a rezolva sesiunea din cookie-ul HttpOnly (un 401 e tratat silențios ca "neautentificat", nu ca eroare), și expune { user, isAuthenticated, login, register, loginWithOAuth, logout, updateProfile } prin hook-ul useAuth().

5.7 Sistem de ajutor pe frontend (components/HelpCenter.jsx)
Randă ClientPanel sau VolunteerPanel în funcție de user.accountType. ClientPanel apasă un buton de distress, votează statusul din 4 în 4 secunde, anunță vocal reperele de distanță (DISTANCE_MILESTONES = [1000, 500, 200, 50] metri) pe măsură ce voluntarul se apropie, și la final întreabă prin voce "A fost rezolvat? Da/Nu". VolunteerPanel trimite heartbeat GPS, listă cereri din apropiere, și arată clasamentul.

5.8 Temă și accesibilitate (theme.js)
Un singur obiect palette cu o singură culoare de brand (#1D4ED8) și o scară de gri neutru, documentat explicit cu raporturile de contrast WCAG AA (≥4.5:1) pentru fiecare combinație — importantă pentru utilizatorii cu vedere slabă:

/**
 *   primary on white  6.7:1    white on primary   6.7:1
 *   danger  on white  6.5:1    success on white   5.0:1    warning on white   5.0:1
 */
Această regulă nu e doar documentație — tests/palette.test.mjs eșuează build-ul dacă vreo componentă folosește o culoare hex/rgb care nu e listată în theme.js, scanând toate fișierele .jsx cu regex:

// palette.test.mjs
for (const m of line.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = ...;
    if (!allowedHex.has(hex.toUpperCase())) problems.push(`${file}:${i + 1} ${m[0]}`);
}
if (problems.length) { console.log(`FAIL ${problems.length} color(s)...`); process.exit(1); }
5.9 Build și configurare (vite.config.js)
// vite.config.js
build: {
    rollupOptions: { output: { manualChunks: {
        react: ['react', 'react-dom'],
        map: ['leaflet', 'react-leaflet'],
        icons: ['lucide-react'],
        // TensorFlow e deja un chunk separat fiindcă e importat dinamic
    }}}
},
server: {
    host: '0.0.0.0',      // testare pe telefon mobil real în rețeaua locală
    proxy: { '/api': { target: 'http://localhost:8080', xfwd: true } } // IP real pt. rate limiting
}
5.10 Teste frontend
Nu se folosește Jest/Vitest — npm test rulează direct două scripturi Node (tests/voiceCommands.test.mjs, tests/palette.test.mjs) care compilează modulul vizat cu esbuild într-un fișier temporar și îl importă direct, verificând rezultatele cu console.log/process.exit(1) manual, fără librărie de assertions.

6. Infrastructură
6.1 Docker Compose (accessmap/docker-compose.yml)
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: accessmap
      POSTGRES_PASSWORD: password   # doar pentru dezvoltare locală — vezi nota de mai jos
    ports: ["5432:5432"]

  graphhopper:
    image: eclipse-temurin:17-jdk
    ports: ["8989:8989"]
    volumes:
      - ./data:/data
      - ./routing/models:/models:ro
    command: >
      sh -c "... wget graphhopper-web-8.0.jar ...
      wget romania-latest.osm.pbf ...
      java -Ddw.graphhopper.datareader.file=romania.osm.pbf -jar graphhopper.jar server config.yml"
La prima pornire, containerul graphhopper descarcă harta completă a României (OpenStreetMap, prin Geofabrik) și construiește indexul de rutare local — un proces care poate dura 10–20 de minute, documentat explicit în start.sh.

Notă de securitate: parola bazei de date din docker-compose.yml (password) e hard-codată, dar aceasta e doar pentru containerul PostGIS local/dezvoltare — baza de date de producție reală e Supabase, ale cărei credențiale vin separat din .env (DB_URL, DB_USERNAME, DB_PASSWORD), conform application.yml.

6.2 Scripturi de pornire
start.sh (Linux) / start.bat (Windows) pornesc tot stack-ul într-o singură comandă: verifică Java/Node/Docker, pornesc GraphHopper (docker compose up -d graphhopper), apoi backend-ul (./mvnw spring-boot:run) și frontend-ul (npm run dev), fiecare cu logging în fișiere și opțiuni --stop/--status/--logs/--no-docker.

6.3 Tunel Cloudflare (cloudflared)
Un binar executabil precompilat (Go, ELF 64-bit, ~linkuit static) e inclus direct în repository la rădăcină. E folosit pentru a expune localhost:3000/8080 printr-un URL public *.trycloudflare.com, necesar pentru testarea aplicației pe un telefon real (geolocația și camera cer un context securizat HTTPS, pe care localhost simplu nu îl oferă pe un alt dispozitiv din rețea).

Observație: a include un binar compilat direct în git (în loc de a-l descărca la nevoie printr-un script sau a-l documenta ca dependență externă) mărește inutil dimensiunea repository-ului și depinde de arhitectura CPU/SO pe care a fost compilat (aici: Linux x86-64) — nu va funcționa, de exemplu, pe un Mac Apple Silicon fără emulare.

7. Variabile de mediu
Niciun fișier .env real nu există în repository (verificat explicit) — există doar șabloane .env.example (rădăcina accessmap/, accessmap/frontend/), corect ignorate de .gitignore. Documentăm aici doar denumirile și rolul, fără valori:

Variabilă	Unde	Rol
DB_URL, DB_USERNAME, DB_PASSWORD	backend	Conexiune Postgres/Supabase (pooler port 6543)
JWT_SECRET	backend	Cheie HMAC pentru semnarea token-urilor (min. 32 bytes)
GOOGLE_MAPS_API_KEY	backend	Geocodare adrese
GOOGLE_CLIENT_ID	backend	Verificare server-side a token-urilor OAuth Google
VITE_GOOGLE_CLIENT_ID	frontend	ID public pentru butonul "Sign in with Google" (Google Identity Services)
SMTP_HOST/PORT/USERNAME/PASSWORD/FROM, MAIL_ENABLED	backend	Trimitere email-uri de confirmare (Gmail SMTP sau alt server)
APP_PUBLIC_URL / CLOUDFLARE_TUNNEL_URL	backend	Origine publică permisă pentru CORS
Toate aceste variabile sunt citite fie din .env (local), fie din variabile de mediu reale la deploy — niciuna nu are o valoare implicită sensibilă hard-codată în cod (cele cu mock-* sunt explicit tratate ca "neconfigurat" și dezactivează funcționalitatea, nu o lasă nesecurizată).

8. Observații și posibile îmbunătățiri
Câteva lucruri remarcate la citirea codului, utile pentru mentenanță viitoare:

config/CorsConfig.java este cod mort — suprascris efectiv de CORS-ul definit în SecurityConfig. Poate fi șters pentru claritate.
route/RouteService.java nu este folosit — RouteController apelează GraphHopperClient direct. Pare un rest de refactorizare.
Teste backend neterminate: GeocodingServeTest.java și RouteServiceTest.java existau ca fișiere goale la acest commit.
hibernate.ddl-auto: update — convenabil în dezvoltare, dar riscant pentru o bază de date de producție fără migrări controlate (ex. Flyway/Liquibase).
Votarea pe rapoarte (ReportService) și limiturile de rată (ApiRateLimitFilter) sunt ținute doar în memorie — se resetează la fiecare restart al backend-ului și nu sunt partajate dacă ar exista vreodată mai multe instanțe în paralel.
Binarul cloudflared e inclus direct în git — ar fi mai portabil documentat ca pas de instalare separat.
Folderul backend/ de la rădăcina repo (în afara accessmap/) e un schelet Spring Boot complet gol — candidat sigur pentru ștergere dacă nu mai e nevoie de el.
9. Index fișiere cheie (pentru referință rapidă)
Backend:

accessmap/backend/src/main/java/com/accessmap/auth/security/SecurityConfig.java — whitelist de rute, CORS, BCrypt
accessmap/backend/src/main/java/com/accessmap/auth/security/JwtUtil.java — emitere/validare JWT
accessmap/backend/src/main/java/com/accessmap/auth/service/AuthService.java — login, register, OAuth Google
accessmap/backend/src/main/java/com/accessmap/route/GraphHopperClient.java — rutare + fallback OSRM
accessmap/backend/src/main/java/com/accessmap/help/HelpService.java — sistem voluntari / distress
accessmap/backend/src/main/java/com/accessmap/help/DeedPoints.java — formula de puncte
accessmap/backend/src/main/java/com/accessmap/report/ReportService.java — votare obstacole
accessmap/backend/src/main/resources/application.yml — configurare centrală
Frontend:

accessmap/frontend/src/App.jsx — orchestrator central (GPS, navigare, stare globală)
accessmap/frontend/src/api/client.js — strat HTTP + fallback-uri de rutare/geocodare
accessmap/frontend/src/utils/voiceCommands.js — parser NLU comenzi vocale (RO), testat unitar
accessmap/frontend/src/utils/obstacleDetector.js — viziune computerizată (distanță, semafor, trecere, trotuar)
accessmap/frontend/src/components/CameraObstacleDetector.jsx — bucla de detecție live + UI cameră
accessmap/frontend/src/components/Map.jsx — hartă Leaflet, stiluri, marcatori
accessmap/frontend/src/theme.js — paletă de culori WCAG AA, impusă prin test

