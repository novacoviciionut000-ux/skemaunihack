import React, { useState, useRef, useEffect } from 'react';
import {
  User as UserIcon,
  LogIn,
  LogOut,
  ChevronDown,
  Settings,
  Shield,
  Check,
  Sparkles,
  Accessibility,
  Eye
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

export default function UserNav({
  onOpenAuth,
  onOpenProfile,
  currentProfile,
  onProfileChange
}) {
  const { user, isAuthenticated, logout } = useAuth();
  const isMobile = useIsMobile();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Închide dropdown la click în exterior
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getProfileLabel = () => 'Asistență Nevăzători';

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: isMobile ? 12 : 16,
        right: isMobile ? 12 : 16,
        zIndex: 1002,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {!isAuthenticated ? (
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8 }}>
          <button
            onClick={() => onOpenAuth('login')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? 5 : 8,
              padding: isMobile ? '8px 12px' : '9px 18px',
              backgroundColor: '#ffffff',
              color: '#1e293b',
              border: '1.5px solid #e2e8f0',
              borderRadius: 30,
              fontSize: isMobile ? 12.5 : 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = '#2563eb';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(37,99,235,0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = '#e2e8f0';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
            }}
          >
            <LogIn size={isMobile ? 14 : 16} style={{ color: '#2563eb' }} />
            <span>Conectare</span>
          </button>

          <button
            onClick={() => onOpenAuth('register')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? 5 : 6,
              padding: isMobile ? '8px 12px' : '9px 18px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 30,
              fontSize: isMobile ? 12.5 : 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(37,99,235,0.3)',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#1d4ed8';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }}
          >
            <Sparkles size={15} />
            <span>Cont Nou</span>
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Buton utilizator conectat */}
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 14px 6px 6px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: 30,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              transition: 'all 0.2s ease',
            }}
          >
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Avatar"
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                border: '1.5px solid #bfdbfe'
              }}>
                {getInitials(user?.fullName || user?.username)}
              </div>
            )}

            <div style={{ textAlign: 'left', marginRight: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                {user?.fullName || user?.username}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                {getProfileLabel(currentProfile)}
              </div>
            </div>

            <ChevronDown size={15} style={{
              color: '#94a3b8',
              transform: dropdownOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s'
            }} />
          </button>

          {/* Meniu Dropdown */}
          {dropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 270,
                backgroundColor: '#ffffff',
                borderRadius: 18,
                boxShadow: '0 20px 40px -10px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)',
                padding: '8px',
                overflow: 'hidden',
                animation: 'fadeIn 0.15s ease-out',
              }}
            >
              {/* Header card utilizator */}
              <div style={{
                padding: '12px 14px',
                backgroundColor: '#f8fafc',
                borderRadius: 12,
                marginBottom: 8,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  {user?.fullName || user?.username}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, wordBreak: 'break-all' }}>
                  {user?.email}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    padding: '2px 8px',
                    borderRadius: 6,
                    backgroundColor: user?.provider === 'GOOGLE' ? '#e0f2fe' : user?.provider === 'FACEBOOK' ? '#e0e7ff' : '#f1f5f9',
                    color: user?.provider === 'GOOGLE' ? '#0369a1' : user?.provider === 'FACEBOOK' ? '#4338ca' : '#475569',
                  }}>
                    {user?.provider || 'LOCAL'}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 6,
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                  }}>
                    ✓ Verificat
                  </span>
                </div>
              </div>

              {/* Profil dedicat activ */}
              <div style={{
                margin: '4px 0 8px',
                padding: '10px 12px',
                borderRadius: 10,
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <Eye size={16} color="#2563eb" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>
                    Profil Nevăzători Activ
                  </div>
                  <div style={{ fontSize: 10.5, color: '#3b82f6' }}>
                    Ghidare vocală & alertă părăsire trotuar
                  </div>
                </div>
              </div>

              <div style={{ height: 1, backgroundColor: '#f1f5f9', margin: '8px 0' }} />

              {/* Buton Profil & Securitate */}
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  if (onOpenProfile) onOpenProfile();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 8,
                  backgroundColor: 'transparent',
                  color: '#334155',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <Settings size={16} style={{ color: '#64748b' }} />
                <span>Profil & Securitate</span>
              </button>

              {/* Buton Deconectare */}
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  logout();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 8,
                  backgroundColor: 'transparent',
                  color: '#ef4444',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <LogOut size={16} />
                <span>Deconectare</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
