import React, { useState } from 'react';
import ReportButton from './ReportButton';
import LocationInput from './LocationInput';
import { MapPin, Flag, RotateCcw, ChevronUp, ChevronDown, Camera, Eye, ShieldCheck } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { speechQueue, unlockAudioContext } from '../utils/speechQueue';
import { requestOrientationPermission } from '../utils/orientationPermission';

export default function Sidebar({
  profile,
  onProfileChange,
  onReportAdded,
  onClearRoute,
  start,
  destination,
  onSetStart,
  onSetDestination,
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
            {collapsed ? 'Planificator Asistiv' : 'Ascunde Planificatorul'}
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
          {/* Asistență Nevăzători: indicator mod activ & buton cameră */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(37, 99, 235, 0.25)',
                  border: '1px solid #3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#60a5fa',
                  flexShrink: 0,
                }}
              >
                <Eye size={20} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                  Mod Asistență Nevăzători
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                  Ghidare audio, menținere pe trotuar și evitare obstacole
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleCamera}
              style={{
                background: cameraOpen ? '#2563eb' : 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                border: cameraOpen ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <Camera size={15} />
              <span>{cameraOpen ? 'Cameră Activă' : 'Cameră AI'}</span>
            </button>
          </div>

          {/* Location inputs with live autocomplete */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Start location */}
            <LocationInput
              icon={MapPin}
              iconColor="#16a34a"
              iconBg="#dcfce7"
              point={start}
              placeholder="Punct de plecare — caută adresa"
              userLocation={userLocation}
              onSelect={(place) => {
                onSetStart({ lat: place.lat, lng: place.lng });
              }}
              onClear={() => onSetStart(null)}
            />

            {/* Destination */}
            <LocationInput
              icon={Flag}
              iconColor="#2563eb"
              iconBg="#dbeafe"
              point={destination}
              placeholder="Destinație — caută adresa"
              userLocation={userLocation}
              onSelect={(place) => {
                onSetDestination({ lat: place.lat, lng: place.lng });
              }}
              onClear={() => onSetDestination(null)}
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
              onClick={() => {
                requestOrientationPermission(); // must be first, inside the tap (iOS)
                unlockAudioContext();
                speechQueue.unlock(true);
                onToggleCamera();
              }}
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
