import React, { useState, useEffect } from 'react';
import Map from './components/Map';
import SearchBar from './components/Searchbar';
import ProfilePicker from './components/ProfilePicker';
import ReportButton from './components/ReportButton';
import { getRoute, getReports } from './api/client';

export default function App() {
  const [profile, setProfile] = useState('wheelchair');
  const [start, setStart] = useState({ lat: 45.7473, lng: 21.2319 });
  const [destination, setDestination] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [obstacles, setObstacles] = useState([]);

  useEffect(() => {
    getReports().then(setObstacles).catch(console.error);
  }, []);

  useEffect(() => {
    if (start && destination) {
      getRoute(start, destination, profile).then(setRouteData).catch(console.error);
    }
  }, [start, destination, profile]);

  const handleReportAdded = (newObstacle) => {
    setObstacles((prev) => [...prev, newObstacle]);
  };

  const floatingContainerStyle = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    pointerEvents: 'none',
  };

  const floatingPanelStyle = {
    padding: '16px',
    paddingBottom: '32px',
    background: 'linear-gradient(transparent, rgba(255,255,255,0.9) 20%, white)',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  };

  return (
    <>
      {/* MAP: the wrapper needs an explicit height, and Map must be inside it */}
      <div style={{ height: '100vh', width: '100vw' }}>
        <Map
          start={start}
          destination={destination}
          routeData={routeData}
          obstacles={obstacles}
        />
      </div>

      {/* FLOATING UI */}
      <div style={floatingContainerStyle}>
        <div style={floatingPanelStyle}>
          <ProfilePicker selected={profile} onSelect={setProfile} />
          <SearchBar onSelectStart={setStart} onSelectDestination={setDestination} />
          <ReportButton onReportAdded={handleReportAdded} />
        </div>
      </div>
    </>
  );
}