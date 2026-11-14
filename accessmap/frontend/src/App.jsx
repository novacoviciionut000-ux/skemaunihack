import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Flag, ShieldAlert } from 'lucide-react';
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
} from './utils/navigationEngine';

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
  const [placingMode, setPlacingMode] = useState('start'); // 'start' | 'end' | null
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

  // Load obstacle reports on mount
  useEffect(() => {
    getReports().then(setObstacles).catch((err) => console.error('Failed to load reports:', err));
  }, []);

  // Continuous real-time GPS tracking (always active, calculating smooth bearing/heading)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation((prev) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? prev?.heading ?? null,
            speed: pos.coords.speed ?? null,
          };

          // If GPS hardware doesn't provide heading directly, infer it from delta motion
          if (pos.coords.heading == null && prev) {
            const dLat = next.lat - prev.lat;
            const dLng = next.lng - prev.lng;
            if (Math.hypot(dLat, dLng) > 0.00003) {
              const brng = getBearing(prev, next);
              next.heading = Math.round(brng);
            }
          }
          return next;
        });
      },
      (err) => console.warn('Continuous GPS watch warning:', err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Listen to mobile compass orientation to rotate user puck real-time
  useEffect(() => {
    const handleOrientation = (e) => {
      const compass =
        e.webkitCompassHeading != null
          ? e.webkitCompassHeading
          : e.alpha != null
            ? (360 - e.alpha) % 360
            : null;
      if (compass != null) {
        setUserLocation((prev) => (prev ? { ...prev, heading: Math.round(compass) } : prev));
      }
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  // Când un traseu este calculat/ales: generează pașii, deschide automat camera pe full-screen și pornește navigarea
  useEffect(() => {
    if (routeData && routeData.coordinates && routeData.coordinates.length > 1) {
      const steps = buildNavigationSteps(routeData.coordinates);
      setNavSteps(steps);
      setIsNavigating(true);
      setFollowUser(true);
      setCameraOpen(true);
      setCameraFullScreen(true);

      // Asigură poziție de pornire pentru utilizator dacă nu are deja una activă
      setUserLocation((prev) => {
        if (!prev) {
          const origin = routeData.coordinates[0];
          const next = routeData.coordinates[1] || origin;
          return {
            lat: origin[0],
            lng: origin[1],
            accuracy: 8,
            heading: Math.round(getBearing(origin, next)),
            speed: 0,
          };
        }
        return prev;
      });

      // Anunț vocal în limba română la activarea automată a camerei pe traseu
      if ('speechSynthesis' in window && voiceGuidanceEnabled) {
        const dist = routeData.distanceMeters ? `${Math.round(routeData.distanceMeters)} metri` : '';
        const mins = routeData.timeSeconds ? Math.max(1, Math.round(routeData.timeSeconds / 60)) : '';
        const firstManeuver = steps[0]?.instructionRo || 'Porniți drept înainte pe traseu';
        const msg = `Traseu pregătit, distanță ${dist}, aproximativ ${mins} minute. Am deschis camera pe tot ecranul pentru asistență și ghidare. ${firstManeuver}.`;
        try {
          window.speechSynthesis.cancel();
          const utt = new SpeechSynthesisUtterance(msg);
          utt.lang = 'ro-RO';
          utt.rate = 1.05;
          window.speechSynthesis.speak(utt);
        } catch {}
      }
    } else {
      setNavSteps([]);
      setLiveGuidance(null);
      setIsNavigating(false);
      setIsSimulating(false);
      setCameraFullScreen(false);
    }
  }, [routeData]);

  // Update live turn-by-turn guidance status as the user moves
  useEffect(() => {
    if (isNavigating && navSteps.length > 0 && routeData?.coordinates && userLocation) {
      const status = getLiveGuidanceStatus({
        userLocation,
        steps: navSteps,
        coordinates: routeData.coordinates,
      });
      setLiveGuidance(status);
    }
  }, [userLocation, isNavigating, navSteps, routeData]);

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
        messageRo: `Atenție, obstacol raportat anterior la ${match.distanceMeters} metri. Urmează traseul de ocolire salvat.`,
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
      setPlacingMode(null);
      setCenterTarget({ lat: dest.lat, lng: dest.lng, zoom: 15 });

      // Dacă utilizatorul nu a pus manual un punct de plecare, îl luăm automat din GPS
      if (!start) {
        if (userLocation) {
          setStart(userLocation);
        } else if (navigator.geolocation) {
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

  const handleMapClick = useCallback(
    (latlng) => {
      if (placingMode === 'start') {
        setStart(latlng);
        setPlacingMode('end');
      } else if (placingMode === 'end') {
        setDestination(latlng);
        setPlacingMode(null);
      } else {
        // If both are placed, clicking again resets start
        setStart(latlng);
        setDestination(null);
        setRouteData(null);
        setPlacingMode('end');
      }
    },
    [placingMode]
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
    setCameraFullScreen(false);
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
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
    setPlacingMode('start');
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
        onMapClick={handleMapClick}
        placingMode={placingMode}
        userLocation={userLocation}
        onUserLocation={setUserLocation}
        centerTarget={centerTarget}
        onLocateMe={handleLocateMe}
        isLocating={isLocating}
        onSetStart={(coords) => {
          setStart(coords);
          setPlacingMode('end');
        }}
        profile={profile}
        followUser={followUser && isNavigating}
      />

      {/* Real-time Turn-by-Turn Navigation HUD */}
      <NavigationGuidance
        guidance={liveGuidance}
        isNavigating={isNavigating}
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

      {/* Top instruction banner */}
      {!isNavigating && placingMode && (
        <div style={{
          position: 'absolute',
          top: isMobile ? 60 : 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999,
          background: placingMode === 'start' ? '#2563eb' : '#16a34a',
          color: 'white',
          padding: isMobile ? '8px 14px' : '10px 24px',
          borderRadius: 12,
          fontSize: isMobile ? 12.5 : 14,
          fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          pointerEvents: 'none',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: isMobile ? 'calc(100vw - 24px)' : 'none',
          whiteSpace: isMobile ? 'normal' : 'nowrap',
          textAlign: 'center',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {placingMode === 'start' ? <MapPin size={16} /> : <Flag size={16} />}
          </span>
          {placingMode === 'start' ? 'Apasă pe hartă pentru punctul de plecare' : 'Apasă pe hartă pentru destinație'}
        </div>
      )}

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

      {/* Butonul de comandă vocală (pe mobil se ascunde când Planificatorul e deschis ca să nu se suprapună) */}
      {(!isMobile || sidebarCollapsed) && (
        <div style={{
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
            onCameraOpen={() => setCameraOpen(true)}
            onCameraClose={() => setCameraOpen(false)}
            onStartNavigation={handleStartNavigation}
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
        onSetDestination={(dest) => {
          setDestination(dest);
          setPlacingMode(null);
        }}
        setPlacingMode={setPlacingMode}
        userLocation={userLocation}
        onRequestLocate={(coords) => {
          setUserLocation(coords);
          setCenterTarget({ lat: coords.lat, lng: coords.lng, zoom: 16 });
        }}
        cameraOpen={cameraOpen}
        onToggleCamera={() => setCameraOpen((prev) => !prev)}
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