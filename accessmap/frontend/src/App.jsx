import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import RouteInfo from './components/RouteInfo';
import UserNav from './components/UserNav';
import AuthModal from './components/AuthModal';
import ProfileModal from './components/ProfileModal';
import VoiceButton from './components/VoiceButton';
import CameraObstacleDetector from './components/CameraObstacleDetector';
import NavigationGuidance from './components/NavigationGuidance';
import { useAuth } from './context/AuthContext';
import { getRoute, getReports } from './api/client';
import { useIsMobile } from './hooks/useIsMobile';
import {
  loadSavedDetours,
  saveDetour,
  findNearbyDetour,
  emitDetourAvailableEvent,
} from './utils/detourStore';
import {
  buildNavigationSteps,
  getLiveGuidanceStatus,
  getBearing,
  getDistanceMeters,
} from './utils/navigationEngine';
import { speechQueue } from './utils/speechQueue';
import { IS_IOS } from './utils/platform';
import { fetchCrossingsAlongRoute } from './utils/crossingStore';

// Wrong-way alerting: how long the user must keep walking against the route before
// being told, and how often the warning may repeat while they still are.
const WRONG_WAY_CONFIRM_MS = 3500;
const WRONG_WAY_REPEAT_MS = 12000;
// A live GPS normally delivers a fix every second or two; past this it has gone quiet
const GPS_STALE_MS = 15000;
// Worse than this and the fix cannot support walking guidance
const GPS_WEAK_ACCURACY_M = 75;
// Crossing warnings: first on approach, then at the kerb itself
const CROSSING_APPROACH_M = 35;
const CROSSING_IMMINENT_M = 10;

export default function App() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  const [profile, setProfile] = useState('low_vision');
  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [obstacles, setObstacles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stări noi pentru modul vocal și urgență
  const [voiceTriggered, setVoiceTriggered] = useState(false);
  const [emergencyActive, setEmergencyActive] = useState(false);

  // Stare pentru modalele de autentificare și profil
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login'); // 'login' | 'register'
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFullScreen, setCameraFullScreen] = useState(true);
  const [savedDetours, setSavedDetours] = useState(() => loadSavedDetours());
  const [nearbyDetour, setNearbyDetour] = useState(null);

  // Sincronizează profilul de deplasare când utilizatorul se autentifică
  useEffect(() => {
    if (user?.preferredProfile) {
      setProfile(user.preferredProfile);
    }
  }, [user?.preferredProfile]);

  // Live user location and map centering targets
  const [userLocation, setUserLocation] = useState(null);
  const [centerTarget, setCenterTarget] = useState(null);
  const [isLocating, setIsLocating] = useState(false);

  // Real-time Turn-by-Turn Navigation States
  const [isNavigating, setIsNavigating] = useState(false);
  const [navSteps, setNavSteps] = useState([]);
  const [liveGuidance, setLiveGuidance] = useState(null);
  const [followUser, setFollowUser] = useState(true);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const simIndexRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const wrongWayRef = useRef({ since: 0, spokenAt: 0 });
  const gpsWarnedRef = useRef(null);
  const requestGpsRef = useRef(null);
  const [isWrongWay, setIsWrongWay] = useState(false);
  const [gpsStatus, setGpsStatus] = useState({ state: 'unknown', message: '', fixes: 0 });
  const [crossings, setCrossings] = useState([]);
  const [crossingAhead, setCrossingAhead] = useState(null);
  // Which crossings have already been announced, and at which stage.
  // A plain object on purpose: `Map` in this file is the imported map component, so
  // `new Map()` would construct that component instead of a JavaScript Map.
  const spokenCrossingsRef = useRef({});

  // Re-ask for location access from a real tap, which is the only reliable way to raise
  // the prompt on iOS Safari.
  const handleRequestGps = useCallback(() => {
    if (requestGpsRef.current) {
      requestGpsRef.current();
      return;
    }
    // The watch never started (no geolocation support, or an insecure origin), so there
    // is nothing to retry and the banner message already explains why.
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => window.location.reload(),
      (err) => console.warn('GPS retry failed:', err.code, err.message),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, []);

  // Sincronizează starea vocii cu managerul de coadă audio
  useEffect(() => {
    speechQueue.setVoiceEnabled(voiceGuidanceEnabled);
  }, [voiceGuidanceEnabled]);

  // Deblochează automat audio și sinteza vocală pe telefon la prima atingere/click
  useEffect(() => {
    const handleUnlockAudio = () => {
      speechQueue.unlock();
    };
    window.addEventListener('touchstart', handleUnlockAudio, { capture: true, passive: true });
    window.addEventListener('touchend', handleUnlockAudio, { capture: true, passive: true });
    window.addEventListener('click', handleUnlockAudio, { capture: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', handleUnlockAudio, true);
      window.removeEventListener('touchend', handleUnlockAudio, true);
      window.removeEventListener('click', handleUnlockAudio, true);
    };
  }, []);

  // Load obstacle reports on mount
  useEffect(() => {
    getReports().then(setObstacles).catch((err) => console.error('Failed to load reports:', err));
  }, []);

  // Continuous real-time GPS tracking (always active, calculating smooth bearing/heading)
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus({ state: 'unsupported', message: 'Dispozitivul nu oferă GPS.', fixes: 0 });
      return;
    }
    // Browsers block geolocation outside a secure context, so a phone opening the dev
    // server over plain http://<ip>:3000 silently never receives a single fix.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setGpsStatus({
        state: 'insecure',
        message: 'GPS blocat: pagina nu este pe HTTPS. Deschide aplicația pe o adresă https.',
        fixes: 0,
      });
      return;
    }

    let watchId = null;
    let timeouts = 0;
    let highAccuracy = true;
    let stopped = false;
    let lastFixAt = 0;

    const handlePosition = (pos) => {
      timeouts = 0;
      lastFixAt = Date.now();
      const accuracy = Math.round(pos.coords.accuracy || 0);
      setGpsStatus((s) => ({
        // A wifi-derived fix of hundreds of meters is a real position but useless for
        // walking guidance, so it is reported rather than passed off as good tracking.
        state: accuracy > GPS_WEAK_ACCURACY_M ? 'weak' : 'live',
        message:
          accuracy > GPS_WEAK_ACCURACY_M
            ? `Semnal slab, precizie ±${accuracy} m. Ieși în aer liber pentru ghidare corectă.`
            : '',
        fixes: s.fixes + 1,
        accuracy,
        at: pos.timestamp,
      }));
      setUserLocation((prev) => {
        // iOS reports speed and heading as null when stationary, and some versions
        // report -1 rather than null, which would otherwise read as a real value.
        const rawSpeed = pos.coords.speed;
        const rawHeading = pos.coords.heading;
        const speed = rawSpeed == null || rawSpeed < 0 ? null : rawSpeed;
        const heading = rawHeading == null || rawHeading < 0 ? null : rawHeading;

        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: heading ?? prev?.heading ?? null,
          speed,
        };

        // Course over ground: the direction the user is actually walking, which is what
        // the wrong-way check needs. The compass only says where the phone points.
        if (heading != null && (speed ?? 0) >= 0.5) {
          next.course = heading;
          next.courseSpeed = speed;
        } else if (prev && !prev.isFallback) {
          const moved = getDistanceMeters(prev, next);
          const elapsed = (pos.timestamp - (prev.timestamp || pos.timestamp)) / 1000;
          // Require real displacement so GPS scatter while standing still is not a "course"
          if (moved >= Math.max(6, (pos.coords.accuracy || 15) * 0.5) && elapsed > 0) {
            next.course = Math.round(getBearing(prev, next));
            next.courseSpeed = moved / elapsed;
          } else {
            next.course = prev.course ?? null;
            next.courseSpeed = 0;
          }
        }
        if (heading == null && next.course != null) {
          next.heading = Math.round(next.course);
        }
        next.timestamp = pos.timestamp;
        return next;
      });
    };

    const handleError = (err) => {
      console.warn('GPS watch error:', err.code, err.message);

      // Repeated timeouts on iOS usually mean the high-accuracy fix never arrives.
      // Dropping to the coarse provider gets a position from wifi/cell instead of none.
      if (err.code === 3 && highAccuracy && ++timeouts >= 2) {
        highAccuracy = false;
        startWatch();
        return;
      }

      const messages = {
        1: IS_IOS
          ? 'Acces la locație refuzat. Apasă aici pentru a cere din nou. Dacă nu apare nicio întrebare: Reglaje > Confidențialitate > Servicii de localizare (pornit), apoi Reglaje > Safari > Locație: Întreabă.'
          : 'Acces la locație refuzat. Apasă aici pentru a cere din nou, sau permite locația din setările browserului.',
        2: IS_IOS
          ? 'Poziția nu este disponibilă. Verifică Serviciile de localizare și dezactivează Modul consum redus.'
          : 'Poziția nu este disponibilă. Semnal GPS slab.',
        3: 'GPS-ul nu a răspuns la timp.',
      };
      setGpsStatus((s) => ({
        ...s,
        state: s.fixes > 0 ? 'stale' : 'error',
        message: messages[err.code] || err.message,
      }));
    };

    function startWatch() {
      if (stopped) return;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
        enableHighAccuracy: highAccuracy,
        // iOS values kept at what demonstrably worked on these phones before. Setting
        // maximumAge to 0 made Safari answer TIMEOUT instead of handing over a fix.
        maximumAge: IS_IOS ? 1000 : 0,
        timeout: IS_IOS ? 20000 : 15000,
      });
    }

    // Exactly one geolocation request at startup. A second, concurrent request while the
    // permission prompt is still pending makes WebKit answer PERMISSION_DENIED for the
    // whole origin, which is what stopped iOS from ever getting a fix.
    startWatch();

    // Asking again from a tap, for after the user changes the setting in Reglaje. Runs the
    // one-shot and the watch in sequence, never at the same time, for the same reason.
    requestGpsRef.current = () => {
      timeouts = 0;
      highAccuracy = true;
      setGpsStatus((s) => ({ ...s, state: 'asking', message: 'Se cere accesul la locație...' }));
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          handlePosition(pos);
          startWatch();
        },
        (err) => {
          handleError(err);
          startWatch();
        },
        { enableHighAccuracy: true, maximumAge: IS_IOS ? 1000 : 0, timeout: IS_IOS ? 20000 : 15000 }
      );
    };

    // iOS suspends an active watch when the tab is hidden or the screen locks, and does
    // not always resume it, which leaves the position frozen. Re-arm it on return, but
    // only when the fix has actually gone stale: re-arming while the first permission
    // prompt is still pending would be a second concurrent request.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!lastFixAt || Date.now() - lastFixAt < GPS_STALE_MS) return;
      timeouts = 0;
      highAccuracy = true;
      startWatch();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopped = true;
      requestGpsRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Flag a GPS that has gone quiet. A frozen position looks identical to standing still,
  // so the age of the last fix is what distinguishes the two.
  useEffect(() => {
    if (gpsStatus.state !== 'live' && gpsStatus.state !== 'weak') return;
    const timer = setInterval(() => {
      setGpsStatus((s) => {
        if ((s.state !== 'live' && s.state !== 'weak') || !s.at) return s;
        if (Date.now() - s.at < GPS_STALE_MS) return s;
        return { ...s, state: 'stale', message: 'GPS-ul nu mai trimite poziții noi.' };
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [gpsStatus.state]);

  // Say once, out loud, that position tracking is not actually running. Without this the
  // route simply never advances and there is nothing on screen explaining why.
  useEffect(() => {
    if (!isNavigating) return;
    // Recovered: allow a later stall to be announced again
    if (gpsStatus.state === 'live') {
      gpsWarnedRef.current = null;
      return;
    }
    if (gpsStatus.state === 'unknown') return;
    if (gpsWarnedRef.current === gpsStatus.state) return;
    gpsWarnedRef.current = gpsStatus.state;
    if (voiceGuidanceEnabled) {
      speechQueue.speak(`Atenție. ${gpsStatus.message} Poziția nu se actualizează.`, {
        priority: 'urgent',
      });
    }
  }, [gpsStatus.state, gpsStatus.message, isNavigating, voiceGuidanceEnabled]);

  // Listen to mobile compass orientation to rotate user puck real-time.
  // Throttled on purpose: the event fires ~60x/s and every update used to replace the
  // userLocation object, which re-ran route projection and re-rendered the camera view
  // 60x/s and starved the GPS callback.
  useEffect(() => {
    let lastApplied = 0;
    let lastHeading = null;
    const handleOrientation = (e) => {
      const compass =
        e.webkitCompassHeading != null
          ? e.webkitCompassHeading
          : e.alpha != null
            ? (360 - e.alpha) % 360
            : null;
      if (compass == null) return;

      const now = Date.now();
      const rounded = Math.round(compass);
      const turned =
        lastHeading == null ? 999 : Math.abs(((rounded - lastHeading + 540) % 360) - 180);
      if (now - lastApplied < 200 || turned < 3) return;

      lastApplied = now;
      lastHeading = rounded;
      setUserLocation((prev) =>
        prev && prev.heading !== rounded ? { ...prev, heading: rounded } : prev
      );
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  // Când un traseu este calculat/ales: generează pașii, deschide automat camera pe full-screen și pornește navigarea
  useEffect(() => {
    if (routeData && routeData.coordinates && routeData.coordinates.length > 1) {
      const steps = buildNavigationSteps(routeData.coordinates);
      setNavSteps(steps);
      segmentIndexRef.current = 0;
      wrongWayRef.current = { since: 0, spokenAt: 0 };
      spokenCrossingsRef.current = {};
      setIsNavigating(true);
      setFollowUser(true);
      setCameraOpen(true);
      setCameraFullScreen(true);

      // Asigură poziție de pornire pentru utilizator dacă nu are deja una activă.
      // Marcată ca estimare: fără un fix GPS real, poziția rămâne blocată aici și
      // distanța rămasă nu s-ar mai schimba niciodată, deci trebuie semnalat.
      setUserLocation((prev) => {
        if (!prev) {
          const origin = routeData.coordinates[0];
          const next = routeData.coordinates[1] || origin;
          return {
            lat: origin[0],
            lng: origin[1],
            accuracy: null,
            isFallback: true,
            heading: Math.round(getBearing(origin, next)),
            speed: 0,
          };
        }
        return prev;
      });

      // Anunț vocal în limba română la activarea automată a camerei pe traseu (prin coada unificată)
      if (voiceGuidanceEnabled) {
        speechQueue.unlock();
        const dist = routeData.distanceMeters ? `${Math.round(routeData.distanceMeters)} metri` : '';
        const firstManeuver = steps[0]?.shortRo || steps[0]?.instructionRo || 'Înainte';
        const msg = `Traseu pornit, ${dist}. ${firstManeuver}.`;
        speechQueue.speak(msg, { priority: 'high' });
      }
    } else {
      setNavSteps([]);
      setLiveGuidance(null);
      setIsNavigating(false);
      setIsSimulating(false);
    }
  }, [routeData]);

  // Update live turn-by-turn guidance status as the user moves
  useEffect(() => {
    if (isNavigating && navSteps.length > 0 && routeData?.coordinates && userLocation) {
      const status = getLiveGuidanceStatus({
        userLocation,
        steps: navSteps,
        coordinates: routeData.coordinates,
        course: userLocation.course ?? null,
        courseSpeedMps: userLocation.courseSpeed ?? null,
        prevSegmentIndex: segmentIndexRef.current,
      });
      if (status) segmentIndexRef.current = status.segmentIndex;
      setLiveGuidance(status);
    }
  }, [userLocation, isNavigating, navSteps, routeData]);

  // Warn when the user is walking away from the route instead of along it.
  // Confirmed over a few seconds so a sidestep, a doorway detour or one noisy GPS
  // fix does not trigger it. Skipped entirely without trustworthy position tracking.
  useEffect(() => {
    if (!isNavigating || !liveGuidance || gpsStatus.state !== 'live') {
      wrongWayRef.current = { since: 0, spokenAt: 0 };
      setIsWrongWay(false);
      return;
    }

    const now = Date.now();
    const state = wrongWayRef.current;

    if (!liveGuidance.isWrongWay) {
      state.since = 0;
      setIsWrongWay(false);
      return;
    }

    if (!state.since) {
      state.since = now;
      return;
    }
    if (now - state.since < WRONG_WAY_CONFIRM_MS) return;

    setIsWrongWay(true);
    if (now - state.spokenAt < WRONG_WAY_REPEAT_MS) return;
    state.spokenAt = now;

    if (voiceGuidanceEnabled) {
      speechQueue.speak('Mergi în direcția opusă. Întoarce-te.', { priority: 'urgent' });
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }, [liveGuidance, isNavigating, voiceGuidanceEnabled, gpsStatus.state]);

  // Pedestrian crossings on the route, from OpenStreetMap. Fetched once per route so a
  // slow lookup never interferes with walking; failure leaves the list empty and the
  // camera heuristic stays the only source.
  useEffect(() => {
    const coords = routeData?.coordinates;
    if (!coords || coords.length < 2) {
      setCrossings([]);
      return;
    }
    let cancelled = false;
    fetchCrossingsAlongRoute(coords)
      .then((list) => {
        if (!cancelled) setCrossings(list);
      })
      .catch(() => {
        if (!cancelled) setCrossings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [routeData]);

  // Announce the crossing ahead: once on approach, then again right at the kerb.
  // Distance comes from route progress rather than the camera, so the warning arrives
  // before the crossing is in view.
  useEffect(() => {
    if (!isNavigating || !liveGuidance || crossings.length === 0) {
      setCrossingAhead(null);
      return;
    }

    const progress = liveGuidance.progressMeters;
    // Allow a few meters of slack so a crossing is not dropped by GPS jitter at the kerb
    const next = crossings.find((c) => c.distanceAlong > progress - 4);
    if (!next) {
      setCrossingAhead(null);
      return;
    }

    const distance = next.distanceAlong - progress;
    if (distance > CROSSING_APPROACH_M) {
      setCrossingAhead(null);
      return;
    }
    setCrossingAhead({ ...next, distanceMeters: Math.max(0, Math.round(distance)) });

    const spoken = spokenCrossingsRef.current;
    const stage = distance <= CROSSING_IMMINENT_M ? 'imminent' : 'approach';
    if (spoken[next.id] === stage || (stage === 'approach' && next.id in spoken)) {
      return;
    }
    spoken[next.id] = stage;

    if (voiceGuidanceEnabled) {
      const label = next.labelRo.charAt(0).toUpperCase() + next.labelRo.slice(1);
      const message =
        stage === 'imminent'
          ? next.hasSignals
            ? `${label}. Oprește și așteaptă semaforul verde.`
            : `${label}. Oprește și ascultă traficul înainte să treci.`
          : `${label} la ${Math.round(distance)} metri.`;
      speechQueue.speak(message, { priority: stage === 'imminent' ? 'danger' : 'high' });
    }
    if (stage === 'imminent' && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([250, 120, 250]);
    }
  }, [liveGuidance, isNavigating, crossings, voiceGuidanceEnabled]);

  // Demo walk simulation along route polyline (advance point-by-point in real time)
  useEffect(() => {
    if (!isSimulating || !routeData?.coordinates || routeData.coordinates.length < 2) {
      return;
    }

    const coords = routeData.coordinates;
    const interval = setInterval(() => {
      simIndexRef.current += 1;
      if (simIndexRef.current >= coords.length) {
        simIndexRef.current = coords.length - 1;
        setIsSimulating(false);
        return;
      }

      const curr = coords[simIndexRef.current];
      const next = coords[simIndexRef.current + 1] || curr;
      const heading = Math.round(getBearing(curr, next));

      setUserLocation({
        lat: curr[0],
        lng: curr[1],
        accuracy: 6,
        heading,
        speed: 1.25,
      });
    }, 700);

    return () => clearInterval(interval);
  }, [isSimulating, routeData]);

  // Check if user is approaching a previously recorded obstacle with a saved detour
  useEffect(() => {
    if (!userLocation) return;
    const match = findNearbyDetour(userLocation, savedDetours, 30);
    setNearbyDetour(match);
    if (match) {
      emitDetourAvailableEvent({
        detour: match.detour,
        distanceMeters: match.distanceMeters,
        messageRo: `Obstacol raportat la ${match.distanceMeters} metri. Urmează ocolirea.`,
        timestamp: Date.now(),
      });
    }
  }, [userLocation, savedDetours]);

  // Fetch route when both points are set
  useEffect(() => {
    if (!start || !destination) {
      setRouteData(null);
      return;
    }
    setLoading(true);
    setError(null);
    getRoute(start, destination, profile)
      .then((data) => {
        setRouteData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Route error:', err);
        setError('Nu s-a putut calcula ruta.');
        setLoading(false);
      });
  }, [start, destination, profile]);

  // Handler pentru destinația primită din VoiceButton
  const handleVoiceDestination = useCallback(
    (dest) => {
      setVoiceTriggered(true);
      setProfile('low_vision'); // Comută automat pe profilul pentru nevăzători
      
      const destCoords = { lat: dest.lat, lng: dest.lng };
      setDestination(destCoords);
      setCenterTarget({ lat: dest.lat, lng: dest.lng, zoom: 15 });

      // O comandă vocală ("Du-mă la ...") pornește mereu de la poziția curentă, dacă o știm
      if (userLocation) {
        setStart({ lat: userLocation.lat, lng: userLocation.lng });
      } else if (!start) {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const gpsCoords = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              };
              setUserLocation(gpsCoords);
              setStart(gpsCoords);
            },
            () => {
              // Fallback în centrul Timișoarei (Piața Victoriei) dacă GPS-ul e blocat în clădire la demo
              setStart({ lat: 45.7537, lng: 21.2257 });
            },
            { enableHighAccuracy: true, timeout: 5000 }
          );
        } else {
          setStart({ lat: 45.7537, lng: 21.2257 });
        }
      }
    },
    [start, userLocation]
  );

  // Center on user GPS position
  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      alert('Geolocația nu este suportată de browserul tău.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(coords);
        setCenterTarget({ lat: coords.lat, lng: coords.lng, zoom: 16 });
        setIsLocating(false);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setIsLocating(false);
        alert('Nu s-a putut obține permisiunea GPS sau locația ta. Asigură-te că permiți accesul la locație în browser.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // When an obstacle is reported, add it and fly map directly to it
  const handleReportAdded = (newObstacle) => {
    setObstacles((prev) => [newObstacle, ...prev]);
    if (newObstacle && newObstacle.lat && newObstacle.lng) {
      setCenterTarget({ lat: newObstacle.lat, lng: newObstacle.lng, zoom: 17 });
    }
  };

  const handleStartNavigation = useCallback(() => {
    if (!routeData || !routeData.coordinates || routeData.coordinates.length < 2) return;
    setIsNavigating(true);
    setFollowUser(true);
    setCameraOpen(true);
    setCameraFullScreen(true);

    if (!userLocation) {
      const origin = routeData.coordinates[0];
      const next = routeData.coordinates[1] || origin;
      setUserLocation({
        lat: origin[0],
        lng: origin[1],
        accuracy: 10,
        heading: Math.round(getBearing(origin, next)),
        speed: 0,
      });
      setCenterTarget({ lat: origin[0], lng: origin[1], zoom: 17 });
    } else {
      setCenterTarget({ lat: userLocation.lat, lng: userLocation.lng, zoom: 17 });
    }
  }, [routeData, userLocation]);

  const handleStopNavigation = useCallback(() => {
    setIsNavigating(false);
    setIsSimulating(false);
    setLiveGuidance(null);
    simIndexRef.current = 0;
    speechQueue.cancel();
  }, []);

  const handleToggleSimulation = useCallback(() => {
    if (!isSimulating) {
      simIndexRef.current = 0;
      setIsNavigating(true);
      setFollowUser(true);
      if (routeData?.coordinates?.length) {
        const first = routeData.coordinates[0];
        const second = routeData.coordinates[1] || first;
        setUserLocation({
          lat: first[0],
          lng: first[1],
          accuracy: 5,
          heading: Math.round(getBearing(first, second)),
          speed: 1.25,
        });
        setCenterTarget({ lat: first[0], lng: first[1], zoom: 17 });
      }
      setIsSimulating(true);
    } else {
      setIsSimulating(false);
    }
  }, [isSimulating, routeData]);

  const handleClearRoute = () => {
    setStart(null);
    setDestination(null);
    setRouteData(null);
    setError(null);
    handleStopNavigation();
  };

  return (
    <div style={{ height: '100dvh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
      {/* Full-screen map */}
      <Map
        start={start}
        destination={destination}
        routeData={routeData}
        obstacles={obstacles}
        savedDetours={savedDetours}
        nearbyDetour={nearbyDetour}
        userLocation={userLocation}
        onUserLocation={setUserLocation}
        centerTarget={centerTarget}
        onLocateMe={handleLocateMe}
        isLocating={isLocating}
        onUseAsStart={setStart}
        onStartChange={setStart}
        onDestinationChange={setDestination}
        profile={profile}
        followUser={followUser && isNavigating}
      />

      {/* GPS health banner. A frozen position makes the whole navigation silently wrong
          and nothing else on screen would show it, so this sits above everything.
          Placed at the bottom: the top strip belongs to the sign-in buttons, which this
          used to cover, and the bottom is also easier to reach with a thumb.
          Tappable, because on iOS the permission prompt only appears inside a gesture. */}
      {gpsStatus.state !== 'live' && gpsStatus.state !== 'unknown' && (
        <button
          type="button"
          aria-label={`Problemă GPS: ${gpsStatus.message} Apasă pentru a cere din nou accesul la locație.`}
          onClick={handleRequestGps}
          style={{
            position: 'absolute',
            bottom: isMobile ? 104 : 96,
            left: 8,
            right: 8,
            zIndex: 2000,
            padding: '10px 12px',
            borderRadius: 10,
            border: 'none',
            textAlign: 'left',
            background: 'rgba(185, 28, 28, 0.96)',
            color: '#fef2f2',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "'Inter', system-ui, sans-serif",
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            cursor: 'pointer',
            minHeight: 44,
            width: 'calc(100% - 16px)',
          }}
        >
          GPS: {gpsStatus.message}
        </button>
      )}

      {/* Live GPS readout while navigating, so a stalled fix is visible at a glance.
          Same strip as the banner above, which it never shares the screen with. */}
      {isNavigating && gpsStatus.state === 'live' && (
        <div
          style={{
            position: 'absolute',
            bottom: isMobile ? 104 : 96,
            left: 8,
            zIndex: 1990,
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.7)',
            color: '#86efac',
            fontSize: 11,
            fontFamily: 'monospace',
            pointerEvents: 'none',
          }}
        >
          GPS {gpsStatus.fixes} fix · ±{gpsStatus.accuracy}m
        </div>
      )}

      {/* Real-time Turn-by-Turn Navigation HUD */}
      <NavigationGuidance
        guidance={liveGuidance}
        isNavigating={isNavigating}
        isWrongWay={isWrongWay}
        onStopNavigation={handleStopNavigation}
        voiceEnabled={voiceGuidanceEnabled}
        onToggleVoice={() => setVoiceGuidanceEnabled((v) => !v)}
        followUser={followUser}
        onToggleFollowUser={() => {
          setFollowUser(true);
          if (userLocation) {
            setCenterTarget({ lat: userLocation.lat, lng: userLocation.lng, zoom: 17 });
          }
        }}
        isSimulating={isSimulating}
        onToggleSimulation={handleToggleSimulation}
        isCameraFullScreen={cameraOpen && cameraFullScreen}
        onOpenFullScreenCamera={() => {
          setCameraOpen(true);
          setCameraFullScreen(true);
        }}
      />

      {/* Top-right Navigation & User Account Bar */}
      <UserNav
        onOpenAuth={(selectedMode) => {
          setAuthModalMode(selectedMode || 'login');
          setAuthModalOpen(true);
        }}
        onOpenProfile={() => setProfileModalOpen(true)}
        currentProfile={profile}
        onProfileChange={setProfile}
      />

      {/* Banner de urgență activat prin comandă vocală ("Ajutor" / "112") */}
      {emergencyActive && (
        <div style={{
          position: 'absolute',
          top: isMobile ? 60 : 70,
          left: isMobile ? 12 : '50%',
          right: isMobile ? 12 : 'auto',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          zIndex: 1100,
          background: '#DC2626',
          color: 'white',
          padding: isMobile ? '12px 14px' : '16px 24px',
          borderRadius: 12,
          fontWeight: 'bold',
          boxShadow: '0 8px 24px rgba(220,38,38,0.5)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          fontFamily: 'system-ui, sans-serif',
          fontSize: isMobile ? 13 : 14,
        }}>
          <ShieldAlert size={18} />
          <span>URGENȚĂ ACTIVATĂ — Coordonate pregătite pentru apelul 112.</span>
          <a
            href="tel:112"
            style={{ background: 'white', color: '#DC2626', padding: '8px 14px', borderRadius: 8, textDecoration: 'none' }}
          >
            SUNĂ 112
          </a>
          <button
            onClick={() => setEmergencyActive(false)}
            style={{ background: 'transparent', color: 'white', border: '1px solid white', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
          >
            Închide
          </button>
        </div>
      )}

      {/* Route info bar */}
      {(routeData || loading || error) && (
        <RouteInfo
          routeData={routeData}
          loading={loading}
          error={error}
          onClear={handleClearRoute}
          onStartNavigation={handleStartNavigation}
          isNavigating={isNavigating}
        />
      )}

      {/* Butonul de comandă vocală. Rămâne montat mereu (ascultă atingerea dublă oriunde pe ecran);
          pe mobil doar se ascunde vizual când Planificatorul e deschis. */}
      {(
        <div style={{
          display: !isMobile || sidebarCollapsed ? 'block' : 'none',
          position: 'absolute',
          bottom: isMobile ? 36 : 24,
          right: isMobile ? 4 : 24,
          left: isMobile ? 4 : 'auto',
          zIndex: 999,
          width: isMobile ? 'auto' : 340,
        }}>
          <VoiceButton
            onDestinationSet={handleVoiceDestination}
            onEmergency={() => setEmergencyActive(true)}
            onCameraOpen={() => {
              setCameraOpen(true);
              setCameraFullScreen(true);
            }}
            onCameraClose={() => setCameraOpen(false)}
            onStartNavigation={handleStartNavigation}
            onCancelRoute={handleClearRoute}
            routeData={routeData}
            userLocation={userLocation}
          />
        </div>
      )}

      {/* Camera Obstacle Detector overlay */}
      <CameraObstacleDetector
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        userLocation={userLocation}
        nearbyDetour={nearbyDetour}
        onDetourSaved={(newDetour) => {
          const updated = saveDetour(newDetour);
          setSavedDetours(updated);
        }}
        isFullScreen={cameraFullScreen}
        onToggleFullScreen={setCameraFullScreen}
        isNavigating={isNavigating}
        guidance={liveGuidance}
        crossingAhead={crossingAhead}
        voiceEnabled={voiceGuidanceEnabled}
        onToggleVoice={() => setVoiceGuidanceEnabled((v) => !v)}
        isSimulating={isSimulating}
        onToggleSimulation={handleToggleSimulation}
        onStopNavigation={handleStopNavigation}
      />

      {/* Sidebar panel */}
      <Sidebar
        profile={profile}
        onProfileChange={setProfile}
        onReportAdded={handleReportAdded}
        onClearRoute={handleClearRoute}
        start={start}
        destination={destination}
        onSetStart={setStart}
        onSetDestination={setDestination}
        userLocation={userLocation}
        onRequestLocate={(coords) => {
          setUserLocation(coords);
          setCenterTarget({ lat: coords.lat, lng: coords.lng, zoom: 16 });
        }}
        cameraOpen={cameraOpen}
        onToggleCamera={() => {
          setCameraOpen((prev) => {
            const next = !prev;
            if (next) setCameraFullScreen(true);
            return next;
          });
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={setSidebarCollapsed}
      />

      {/* Auth Modal (Login / Register / Social OAuth) */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={(loggedUser) => {
          if (loggedUser?.preferredProfile) {
            setProfile(loggedUser.preferredProfile);
          }
        }}
      />

      {/* User Profile & Security Settings Modal */}
      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onProfileUpdated={(updatedUser) => {
          if (updatedUser?.preferredProfile) {
            setProfile(updatedUser.preferredProfile);
          }
        }}
      />
    </div>
  );
}