import React, { useState } from 'react';
import ProfilePicker from './ProfilePicker';
import ReportButton from './ReportButton';
import LocationInput from './LocationInput';
import { MapPin, Flag, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react';

export default function Sidebar({
  profile,
  onProfileChange,
  onReportAdded,
  onClearRoute,
  start,
  destination,
  onSetStart,
  onSetDestination,
  setPlacingMode,
  userLocation,
  onRequestLocate,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      pointerEvents: 'none',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: 680,
        pointerEvents: 'auto',
      }}>
        {/* Collapse toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -1 }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'white', border: '1px solid #e5e7eb', borderBottom: 'none',
              borderRadius: '12px 12px 0 0', padding: '5px 24px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#6b7280', fontSize: 13, fontWeight: 600,
              boxShadow: '0 -2px 10px rgba(0,0,0,0.06)',
            }}
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {collapsed ? 'Show Route Planner' : 'Hide Controls'}
          </button>
        </div>

        {/* Main panel */}
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.12)',
          transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease',
          transform: collapsed ? 'translateY(100%)' : 'translateY(0)',
          opacity: collapsed ? 0 : 1,
          padding: collapsed ? 0 : '18px 24px 28px',
          overflow: 'visible',
        }}>
          {/* Profile picker */}
          <ProfilePicker selected={profile} onSelect={onProfileChange} />

          {/* Location inputs with live autocomplete */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Start location */}
            <LocationInput
              icon={MapPin}
              iconColor="#16a34a"
              iconBg="#dcfce7"
              point={start}
              placeholder="Starting point — type to search or click map"
              onSelect={(place) => {
                onSetStart({ lat: place.lat, lng: place.lng });
                setPlacingMode('end');
              }}
              onClear={() => onSetStart(null)}
              onFocus={() => setPlacingMode('start')}
            />

            {/* Destination */}
            <LocationInput
              icon={Flag}
              iconColor="#2563eb"
              iconBg="#dbeafe"
              point={destination}
              placeholder="Destination — type to search or click map"
              onSelect={(place) => {
                onSetDestination({ lat: place.lat, lng: place.lng });
                setPlacingMode(null);
              }}
              onClear={() => onSetDestination(null)}
              onFocus={() => setPlacingMode('end')}
            />
          </div>

          {/* Action buttons */}
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <ReportButton
              onReportAdded={onReportAdded}
              userLocation={userLocation}
              onRequestLocate={onRequestLocate}
            />
            {(start || destination) && (
              <button
                onClick={onClearRoute}
                style={{
                  padding: '12px 20px', background: '#f3f4f6', color: '#374151',
                  borderRadius: 12, border: '2px solid #e5e7eb', fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                <RotateCcw size={16} /> Clear Route
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
