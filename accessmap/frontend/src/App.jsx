import React, { useState, useEffect, useCallback } from 'react';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import RouteInfo from './components/RouteInfo';
import UserNav from './components/UserNav';
import AuthModal from './components/AuthModal';
import ProfileModal from './components/ProfileModal';
import VoiceButton from './components/VoiceButton';
import CameraObstacleDetector from './components/CameraObstacleDetector';
import { useAuth } from './context/AuthContext';
import { getRoute, getReports } from './api/client';
import { useIsMobile } from './hooks/useIsMobile';
import {
  loadSavedDetours,
  saveDetour,
  findNearbyDetour,
  emitDetourAvailableEvent,
} from './utils/detourStore';

export default function App() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  const [profile, setProfile] = useState('wheelchair');
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

  // Load obstacle reports on mount
  useEffect(() => {
    getReports().then(setObstacles).catch((err) => console.error('Failed to load reports:', err));
  }, []);

  // Watch GPS continuously while camera is open so detours can be recorded & matched
  useEffect(() => {
    if (!cameraOpen || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => console.warn('GPS watch warning:', err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [cameraOpen]);

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

  // Citește vocal detaliile rutei când traseul a fost cerut prin comandă vocală
  useEffect(() => {
    if (voiceTriggered && routeData && 'speechSynthesis' in window) {
      const dist = routeData.distanceMeters ?? '';
      const mins = routeData.timeSeconds ? Math.max(1, Math.round(routeData.timeSeconds / 60)) : '';
      const warning = routeData.warnings?.length > 0 ? ` Atenție: ${routeData.warnings[0]}` : '';
      
      const message = `Traseu calculat. Distanța este de ${dist} metri, aproximativ ${mins} minute.${warning}`;
      
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = 'ro-RO';
      window.speechSynthesis.speak(utterance);

      setVoiceTriggered(false);
    }
  }, [routeData, voiceTriggered]);

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

  const handleClearRoute = () => {
    setStart(null);
    setDestination(null);
    setRouteData(null);
    setError(null);
    setPlacingMode('start');
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
      {placingMode && (
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
          <span style={{ fontSize: isMobile ? 15 : 18 }}>{placingMode === 'start' ? '📍' : '🏁'}</span>
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
          <span>🚨 URGENȚĂ ACTIVATĂ! Coordonate pregătite pentru 112.</span>
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