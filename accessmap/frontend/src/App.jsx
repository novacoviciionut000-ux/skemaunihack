import React, { useState, useEffect, useCallback } from 'react';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import RouteInfo from './components/RouteInfo';
import UserNav from './components/UserNav';
import AuthModal from './components/AuthModal';
import ProfileModal from './components/ProfileModal';
import CameraObstacleDetector from './components/CameraObstacleDetector';
import { useAuth } from './context/AuthContext';
import { getRoute, getReports } from './api/client';

export default function App() {
  const { user } = useAuth();

  const [profile, setProfile] = useState('wheelchair');
  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [obstacles, setObstacles] = useState([]);
  const [placingMode, setPlacingMode] = useState('start'); // 'start' | 'end' | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Stare pentru modalele de autentificare și profil
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login'); // 'login' | 'register'
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

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
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden' }}>
      {/* Full-screen map */}
      <Map
        start={start}
        destination={destination}
        routeData={routeData}
        obstacles={obstacles}
        onMapClick={handleMapClick}
        onStartChange={setStart}
        onDestinationChange={setDestination}
        placingMode={placingMode}
        userLocation={userLocation}
        centerTarget={centerTarget}
        isLocating={isLocating}
        onLocateMe={handleLocateMe}
        onUseAsStart={(coords) => {
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

      {/* Top instruction banner (re-centered taking care not to overlap UserNav) */}
      {placingMode && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 999, background: placingMode === 'start' ? '#2563eb' : '#16a34a',
          color: 'white', padding: '10px 24px', borderRadius: 12,
          fontSize: 14, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          pointerEvents: 'none', fontFamily: 'system-ui, sans-serif',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>{placingMode === 'start' ? '📍' : '🏁'}</span>
          {placingMode === 'start' ? 'Apasă pe hartă pentru punctul de plecare' : 'Apasă pe hartă pentru destinație'}
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

      {/* Camera Obstacle Detector overlay */}
      <CameraObstacleDetector
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
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
