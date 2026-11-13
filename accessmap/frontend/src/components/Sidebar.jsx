import React, { useState } from 'react';
import ProfilePicker from './ProfilePicker';
import ReportButton from './ReportButton';
import LocationInput from './LocationInput';
import { MapPin, Flag, RotateCcw, ChevronUp, ChevronDown, Camera } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

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
  cameraOpen,
  onToggleCamera,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
}) {
  const isMobile = useIsMobile();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const toggleCollapsed = () => {
    if (onToggleCollapsed) onToggleCollapsed(!collapsed);
    else setInternalCollapsed(!collapsed);
  };

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
            onClick={toggleCollapsed}
            style={{
              background: 'white', border: '1px solid #e5e7eb', borderBottom: 'none',
              borderRadius: '12px 12px 0 0', padding: isMobile ? '7px 20px' : '5px 24px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#374151', fontSize: 13, fontWeight: 600,
              boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
            }}
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {collapsed ? (isMobile ? 'Planificator & Cameră' : 'Show Route Planner') : (isMobile ? 'Ascunde' : 'Hide Controls')}
          </button>
        </div>

        {/* Main panel */}
        {!collapsed && (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.12)',
          padding: isMobile ? '14px 14px calc(16px + env(safe-area-inset-bottom, 0px))' : '18px 24px 28px',
          maxHeight: isMobile ? '72dvh' : 'none',
          overflowY: isMobile ? 'auto' : 'visible',
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
          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ReportButton
              onReportAdded={onReportAdded}
              userLocation={userLocation}
              onRequestLocate={onRequestLocate}
            />
            <button
              type="button"
              onClick={onToggleCamera}
              aria-pressed={cameraOpen}
              style={{
                padding: '12px 18px',
                background: cameraOpen ? '#1d4ed8' : '#eff6ff',
                color: cameraOpen ? '#ffffff' : '#1d4ed8',
                borderRadius: 12,
                border: '2px solid #2563eb',
                fontSize: 14,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                boxShadow: cameraOpen ? '0 4px 14px rgba(37, 99, 235, 0.35)' : 'none',
              }}
            >
              <Camera size={18} />
              {cameraOpen ? 'Închide Camera' : 'Cameră Obstacole'}
            </button>
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
        )}
      </div>
    </div>
  );
}
