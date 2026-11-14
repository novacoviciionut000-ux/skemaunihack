import React from 'react';
import { Clock, Navigation, AlertCircle, X, ShieldCheck, AlertTriangle, Eye } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

export default function RouteInfo({
  routeData,
  loading,
  error,
  onClear,
  onStartNavigation,
  isNavigating,
}) {
  const isMobile = useIsMobile();

  if (isNavigating) return null; // Turn-by-turn guidance banner takes over in navigation mode

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
        boxShadow: '0 8px 30px rgba(15, 23, 42, 0.12)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'inherit',
      }}>
        <div style={{
          width: 20,
          height: 20,
          border: '3px solid #E2E8F0',
          borderTopColor: '#1D4ED8',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>
          Se calculează traseul accesibil...
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
        background: '#FEF2F2',
        border: '1px solid #FECACA',
        padding: '12px 16px',
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(15, 23, 42, 0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: isMobile ? 'none' : 360,
        fontFamily: 'inherit',
      }}>
        <AlertCircle size={20} color="#B91C1C" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: '#B91C1C', lineHeight: 1.4 }}>{error}</span>
        <button
          onClick={onClear}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            marginLeft: 'auto',
            color: '#B91C1C',
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
  const totalSeconds = routeData.timeSeconds || Math.round((distMeters / 1.15)); // ~4.1 km/h walking speed with cane
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
      boxShadow: '0 10px 35px rgba(15, 23, 42, 0.15)',
      padding: isMobile ? '12px 16px' : '16px 20px',
      minWidth: isMobile ? 0 : 260,
      fontFamily: 'inherit',
      border: '1px solid #E2E8F0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#15803D' }}>
          <Eye size={18} />
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Traseu Asistiv Nevăzători
          </span>
        </div>
        <button
          onClick={onClear}
          title="Închide traseul"
          style={{
            background: '#F1F5F9',
            border: 'none',
            borderRadius: '50%',
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#64748B',
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B', fontSize: 12 }}>
            <Clock size={14} />
            <span>Timp estimat</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
            {timeFormatted}
          </div>
        </div>

        <div style={{ width: 1, height: 36, background: '#E2E8F0' }} />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748B', fontSize: 12 }}>
            <Navigation size={14} />
            <span>Distanță</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
            {distFormatted}
          </div>
        </div>
      </div>

      {/* Start Turn-by-Turn Navigation Button */}
      {onStartNavigation && (
        <button
          onClick={onStartNavigation}
          style={{
            marginTop: 12,
            width: '100%',
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #1D4ED8 0%, #1D4ED8 100%)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 12,
            fontSize: 13.5,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 4px 14px rgba(29, 78, 216, 0.35)',
            transition: 'all 0.15s ease',
          }}
        >
          <Navigation size={16} />
          <span>Începe Navigarea Pas-cu-Pas</span>
        </button>
      )}

      {routeData.isFallback && (
        <div style={{
          marginTop: 10,
          padding: '6px 10px',
          background: '#FFFBEB',
          borderRadius: 8,
          fontSize: 11,
          color: '#B45309',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <AlertTriangle size={13} color="#B45309" />
          <span>Traseu estimat preview</span>
        </div>
      )}
    </div>
  );
}
