import React, { useState } from 'react';
import ReportButton from './ReportButton';
import LocationInput from './LocationInput';
import { MapPin, Flag, RotateCcw, ChevronUp, ChevronDown, Camera, Eye, ShieldCheck } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { palette, radius } from '../theme';
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
      fontFamily: 'inherit',
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
              background: 'white', border: '1px solid #E2E8F0', borderBottom: 'none',
              borderRadius: '12px 12px 0 0', padding: isMobile ? '7px 20px' : '5px 24px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#334155', fontSize: 13, fontWeight: 600,
              boxShadow: '0 -2px 10px rgba(15, 23, 42, 0.08)',
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
          border: '1px solid #E2E8F0',
          borderBottom: 'none',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 30px rgba(15, 23, 42, 0.12)',
          padding: isMobile ? '14px 14px calc(16px + env(safe-area-inset-bottom, 0px))' : '18px 24px 28px',
          maxHeight: isMobile ? '72dvh' : 'none',
          overflowY: isMobile ? 'auto' : 'visible',
        }}>
          {/* Active mode: one quiet info row (the camera is opened by the button below) */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: radius.md,
              background: palette.primarySoft,
              border: `1px solid ${palette.primarySoftBorder}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.sm,
                background: palette.primary,
                color: palette.white,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Eye size={19} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: palette.ink }}>
                Mod asistență nevăzători
              </div>
              <div style={{ fontSize: 12.5, color: palette.slate600, marginTop: 1, lineHeight: 1.35 }}>
                Ghidare vocală, menținere pe trotuar și avertizare la obstacole
              </div>
            </div>
          </div>

          {/* Location inputs with live autocomplete */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Start location */}
            <LocationInput
              icon={MapPin}
              iconColor="#15803D"
              iconBg="#F0FDF4"
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
              iconColor="#1D4ED8"
              iconBg="#EFF6FF"
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
                background: cameraOpen ? '#1D4ED8' : '#EFF6FF',
                color: cameraOpen ? '#FFFFFF' : '#1D4ED8',
                borderRadius: 12,
                border: '2px solid #1D4ED8',
                fontSize: 14,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                boxShadow: cameraOpen ? '0 4px 14px rgba(29, 78, 216, 0.35)' : 'none',
              }}
            >
              <Camera size={18} />
              {cameraOpen ? 'Închide Camera' : 'Cameră Obstacole'}
            </button>
            {(start || destination) && (
              <button
                onClick={onClearRoute}
                style={{
                  padding: '12px 20px', background: '#F1F5F9', color: '#334155',
                  borderRadius: 12, border: '2px solid #E2E8F0', fontSize: 14, fontWeight: 600,
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
