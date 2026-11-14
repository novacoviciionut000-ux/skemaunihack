import React, { useState } from 'react';
import {
  X,
  User,
  Mail,
  Shield,
  Key,
  Check,
  AlertCircle,
  Loader2,
  Calendar,
  Accessibility,
  Eye
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function ProfileModal({ isOpen, onClose, onProfileUpdated }) {
  const { user, updateProfile } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [preferredProfile, setPreferredProfile] = useState(user?.preferredProfile || 'low_vision');
  const [accountType, setAccountType] = useState(user?.accountType || 'CLIENT');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen || !user) return null;

  const isLocal = user.provider === 'LOCAL';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const payload = {
        fullName: fullName.trim(),
        preferredProfile,
        accountType,
      };

      if (isLocal && newPassword) {
        if (!currentPassword) {
          throw new Error('Te rugăm să introduci parola curentă pentru a schimba parola.');
        }
        if (newPassword.length < 8) {
          throw new Error('Noua parolă trebuie să aibă minimum 8 caractere.');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('Parolele noi nu coincid.');
        }
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      const updated = await updateProfile(payload);
      setSuccess('Profilul a fost actualizat cu succes!');
      if (onProfileUpdated) onProfileUpdated(updated);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      console.error('Update profile error:', err);
      setError(err.message || 'Eroare la actualizarea profilului.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Setări profil"
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#ffffff',
          borderRadius: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '22px 28px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb'
            }}>
              <User size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                Profil & Securitate
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Gestionează-ți contul și preferințele de navigare
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Închide"
            style={{
              background: '#f8fafc',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Notificări */}
        <div style={{ padding: '0 28px', marginTop: 14 }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: '#fef2f2', border: '1px solid #fee2e2',
              color: '#b91c1c', padding: '10px 14px', borderRadius: 10,
              fontSize: 13
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: '#f0fdf4', border: '1px solid #dcfce7',
              color: '#15803d', padding: '10px 14px', borderRadius: 10,
              fontSize: 13
            }}>
              <Check size={18} style={{ flexShrink: 0 }} />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Formular */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Informații statice despre cont */}
          <div style={{
            padding: '12px 14px',
            backgroundColor: '#f8fafc',
            borderRadius: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13
          }}>
            <div>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600 }}>UTILIZATOR & EMAIL</div>
              <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 2 }}>@{user.username}</div>
              <div style={{ color: '#475569', fontSize: 12 }}>{user.email}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600 }}>METODĂ LOGIN</div>
              <span style={{
                display: 'inline-block',
                marginTop: 3,
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 6,
                backgroundColor: '#e2e8f0',
                color: '#334155'
              }}>
                {user.provider || 'LOCAL'}
              </span>
            </div>
          </div>

          {/* Nume Afișat */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
              Nume complet afișat
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Numele tău"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1.5px solid #cbd5e1',
                fontSize: 14,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Tip de cont + puncte de faptă bună */}
          <div style={{ padding: '12px 14px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Tip de cont</div>
            <div role="radiogroup" style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'CLIENT', label: 'Am nevoie de ajutor' },
                { id: 'VOLUNTEER', label: 'Voluntar' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={accountType === opt.id}
                  onClick={() => setAccountType(opt.id)}
                  style={{
                    flex: 1,
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: accountType === opt.id ? '2px solid #2563eb' : '1.5px solid #cbd5e1',
                    background: accountType === opt.id ? '#eff6ff' : '#ffffff',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {(user.accountType === 'VOLUNTEER' || user.deedPoints > 0) && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#334155' }}>
                Puncte de faptă bună: <strong>{user.deedPoints || 0}</strong> · {user.deedsCompleted || 0} fapte confirmate
              </div>
            )}
          </div>

          {/* Profil preferat */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <Eye size={18} color="#2563eb" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>
                Profil: Asistență Nevăzători
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Configurat automat pentru sinteză vocală în limba română și monitorizare trotuar.
              </div>
            </div>
          </div>

          {/* Schimbare Parolă (doar dacă e cont LOCAL) */}
          {isLocal && (
            <div style={{
              borderTop: '1px solid #f1f5f9',
              paddingTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                Schimbare Parolă (opțional)
              </div>

              <div>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Parola curentă"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1.5px solid #cbd5e1',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Noua parolă (min. 8)"
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1.5px solid #cbd5e1',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmă noua parolă"
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1.5px solid #cbd5e1',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          )}

          {/* Buton Salvare */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '12px 20px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Salvează Modificările'}
          </button>
        </form>
      </div>
    </div>
  );
}
