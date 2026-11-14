import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  AlertTriangle,
  X,
  Check,
  Construction,
  ArrowDownUp,
  Ban,
  AlertOctagon,
  Hammer,
  HelpCircle,
  Loader2,
  Crosshair,
  Send,
  User as UserIcon,
  MapPin,
} from 'lucide-react';
import { submitReport } from '../api/client';
import { useAuth } from '../context/AuthContext';

const OBSTACLE_TYPES = [
  { id: 'BLOCKED_SIDEWALK', label: 'Trotuar blocat / barieră', icon: Ban, color: '#dc2626' },
  { id: 'NO_RAMP', label: 'Trepte fără rampă de acces', icon: ArrowDownUp, color: '#ea580c' },
  { id: 'BROKEN_ELEVATOR', label: 'Lift / elevator defect', icon: Construction, color: '#ca8a04' },
  { id: 'POTHOLE', label: 'Groapă / pavaj distrus', icon: AlertOctagon, color: '#d97706' },
  { id: 'CONSTRUCTION', label: 'Zonă de șantier / lucrări', icon: Hammer, color: '#b91c1c' },
  { id: 'OTHER', label: 'Alt obstacol', icon: HelpCircle, color: '#6b7280' },
];

export default function ReportButton({ onReportAdded, userLocation, onRequestLocate }) {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [selectedType, setSelectedType] = useState('BLOCKED_SIDEWALK');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [detectedCoords, setDetectedCoords] = useState(userLocation || { lat: 45.7489, lng: 21.2087 });
  const [toast, setToast] = useState('');

  // When modal opens, try to acquire or refresh GPS position in background
  useEffect(() => {
    if (showModal) {
      if (userLocation) {
        setDetectedCoords({ lat: userLocation.lat, lng: userLocation.lng });
      } else {
        fetchUserLocation();
      }
    }
  }, [showModal, userLocation]);

  const fetchUserLocation = () => {
    if (!navigator.geolocation) {
      setDetectedCoords({ lat: 45.7489, lng: 21.2087 });
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
        setDetectedCoords(coords);
        setIsLocating(false);
        if (onRequestLocate) onRequestLocate(coords);
      },
      (err) => {
        console.warn('Geolocation warning in modal:', err.message);
        if (!detectedCoords) {
          setDetectedCoords({ lat: 45.7489, lng: 21.2087 });
        }
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 6000,
      }
    );
  };

  const handleFinishReport = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      const lat = detectedCoords?.lat || (userLocation?.lat) || 45.7489;
      const lng = detectedCoords?.lng || (userLocation?.lng) || 21.2087;

      const report = await submitReport(lat, lng, selectedType, description, user);

      if (onReportAdded) {
        onReportAdded({
          ...report,
          lat,
          lng,
          type: selectedType,
          description: description || 'Obstacol raportat',
          authorName: user ? (user.fullName || user.username) : null,
        });
      }

      setShowModal(false);
      setDescription('');
      setToast(`✓ Obstacolul (${selectedType}) a fost plasat pe hartă!`);
      setTimeout(() => setToast(''), 4500);
    } catch (err) {
      console.error('Failed to submit report:', err);
      const lat = detectedCoords?.lat || 45.7489;
      const lng = detectedCoords?.lng || 21.2087;
      if (onReportAdded) {
        onReportAdded({
          id: Date.now(),
          lat,
          lng,
          type: selectedType,
          description: description || 'Obstacol raportat',
        });
      }
      setShowModal(false);
      setToast('✓ Obstacolul a fost plasat pe hartă!');
      setTimeout(() => setToast(''), 4500);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Primary Report Button on the floating panel */}
      <button
        onClick={() => setShowModal(true)}
        aria-label="Raportează obstacol"
        style={{
          flex: 1,
          padding: '12px 18px',
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          color: 'white',
          borderRadius: 12,
          border: 'none',
          fontSize: 14,
          fontWeight: 700,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(220, 38, 38, 0.3)',
          fontFamily: 'inherit',
          transition: 'all 0.15s ease',
        }}
      >
        <AlertTriangle size={18} />
        Raportează obstacol
      </button>

      {/* Success Notification Banner (rendered directly in body) */}
      {toast && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#15803d',
          color: 'white',
          padding: '12px 24px',
          borderRadius: 14,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          zIndex: 999999,
          fontSize: 14,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'system-ui, sans-serif',
        }}>
          <Check size={18} />
          {toast}
        </div>,
        document.body
      )}

      {/* Report Modal - PORTALED to document.body so it is ALWAYS centered in the viewport! */}
      {showModal && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(5px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Raportează un obstacol"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 20,
              padding: '24px',
              width: '100%',
              maxWidth: 440,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
              fontFamily: "'Inter', system-ui, sans-serif",
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              margin: 'auto',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
                <AlertTriangle size={22} />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111827' }}>
                  Raportează obstacol
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  background: '#f3f4f6',
                  border: 'none',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {user && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                backgroundColor: '#eff6ff',
                border: '1px solid #dbeafe',
                borderRadius: 10,
                fontSize: 12,
                color: '#1d4ed8',
                marginBottom: 12,
                fontWeight: 500
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <UserIcon size={14} />
                  Raportezi ca: <strong>{user.fullName || user.username}</strong>
                </span>
              </div>
            )}

            {/* GPS Location Status Bar */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '10px 14px',
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Crosshair size={18} color="#2563eb" />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                    Locația ta detectată:
                  </div>
                  {isLocating ? (
                    <div style={{ fontSize: 12, color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      Detectare semnal GPS...
                    </div>
                  ) : detectedCoords ? (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={14} />
                      {detectedCoords.lat.toFixed(5)}, {detectedCoords.lng.toFixed(5)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#475569' }}>Timișoara Centru</div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={fetchUserLocation}
                style={{
                  background: 'white',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#334155',
                }}
              >
                {isLocating ? '...' : 'Actualizează'}
              </button>
            </div>

            <form onSubmit={handleFinishReport} style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Type Selection */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                  1. Alege tipul obstacolului:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {OBSTACLE_TYPES.map((t) => {
                    const Icon = t.icon;
                    const isSelected = selectedType === t.id;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => setSelectedType(t.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: isSelected ? `2px solid ${t.color}` : '2px solid #e2e8f0',
                          background: isSelected ? '#fef2f2' : '#f8fafc',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          transition: 'all 0.1s ease',
                          boxShadow: isSelected ? '0 2px 8px rgba(220,38,38,0.15)' : 'none',
                        }}
                      >
                        <Icon size={16} color={t.color} style={{ flexShrink: 0 }} />
                        <span style={{
                          fontSize: 12,
                          fontWeight: isSelected ? 800 : 600,
                          color: isSelected ? '#991b1b' : '#334155',
                          lineHeight: 1.2,
                        }}>
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Description Input */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                  2. Detalii (opțional):
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Trepte înalte, lift defect, trotuar spart..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '2px solid #e2e8f0',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleFinishReport(e);
                    }
                  }}
                />
              </div>

              {/* Big, obvious Finish / Submit Button */}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    padding: '13px',
                    borderRadius: 12,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Anulează
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    flex: 2,
                    padding: '13px 16px',
                    borderRadius: 12,
                    border: 'none',
                    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                    color: 'white',
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 6px 16px rgba(220, 38, 38, 0.35)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                      Se salvează...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Finalizează raportul
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
