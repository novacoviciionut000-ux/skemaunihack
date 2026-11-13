import React from 'react';
import { Clock, Navigation, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

export default function RouteInfo({ routeData, loading, error, onClear }) {
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <div style={{
        position: 'absolute',
        top: isMobile ? 60 : 72,
        right: isMobile ? 12 : 20,
        left: isMobile ? 12 : 'auto',
        zIndex: 1000,
        background: 'white',
        padding: isMobile ? '12px 16px' : '14px 20px',
        borderRadius: 16,
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{
          width: 20,
          height: 20,
          border: '3px solid #e5e7eb',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
          Calculating accessible route...
        </span>
      </div>
    );
  }

  if (error && !routeData) {
    return (
      <div style={{
        position: 'absolute',
        top: isMobile ? 60 : 72,
        right: isMobile ? 12 : 20,
        left: isMobile ? 12 : 'auto',
        zIndex: 1000,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        padding: '12px 16px',
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: isMobile ? 'none' : 360,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#991b1b', lineHeight: 1.4 }}>{error}</span>
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            marginLeft: 'auto',
            color: '#dc2626',
          }}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  if (!routeData) return null;

  // Format distance
  const distMeters = routeData.distanceMeters || 0;
  const distFormatted = distMeters >= 1000
    ? `${(distMeters / 1000).toFixed(2)} km`
    : `${Math.round(distMeters)} m`;

  // Format duration
  const totalSeconds = routeData.timeSeconds || Math.round((distMeters / 1.1)); // ~4 km/h wheelchair / walking speed
  const mins = Math.max(1, Math.round(totalSeconds / 60));
  const timeFormatted = mins >= 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins} min`;

  return (
    <div style={{
      position: 'absolute',
      top: isMobile ? 60 : 72,
      right: isMobile ? 12 : 20,
      left: isMobile ? 12 : 'auto',
      zIndex: 1000,
      background: 'white',
      borderRadius: 16,
      boxShadow: '0 10px 35px rgba(0,0,0,0.15)',
      padding: isMobile ? '12px 16px' : '16px 20px',
      minWidth: isMobile ? 0 : 260,
      fontFamily: "'Inter', system-ui, sans-serif",
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#16a34a' }}>
          <ShieldCheck size={18} />
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Accessible Path
          </span>
        </div>
        <button
          onClick={onClear}
          title="Clear route"
          style={{
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '50%',
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#6b7280',
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 12 }}>
            <Clock size={14} />
            <span>Estimated time</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginTop: 2 }}>
            {timeFormatted}
          </div>
        </div>

        <div style={{ width: 1, height: 36, background: '#e5e7eb' }} />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 12 }}>
            <Navigation size={14} />
            <span>Distance</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginTop: 2 }}>
            {distFormatted}
          </div>
        </div>
      </div>

      {routeData.isFallback && (
        <div style={{
          marginTop: 10,
          padding: '6px 10px',
          background: '#fef3c7',
          borderRadius: 8,
          fontSize: 11,
          color: '#92400e',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span>⚠️ GraphHopper preview path</span>
        </div>
      )}
    </div>
  );
}
