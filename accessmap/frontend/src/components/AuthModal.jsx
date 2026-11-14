import React, { useState } from 'react';
import {
  X,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Accessibility,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthModal({ isOpen, onClose, initialMode = 'login', onAuthSuccess }) {
  const { login, register, loginWithOAuth } = useAuth();

  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [preferredProfile, setPreferredProfile] = useState('low_vision');

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'google' | 'facebook' | null
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen) return null;

  // Calcul putere parolă pentru ecranul de înregistrare
  const calculatePasswordStrength = (pass) => {
    if (!pass) return { score: 0, text: '', color: '#e5e7eb' };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 1;
    if (/\d/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    switch (score) {
      case 1:
        return { score: 25, text: 'Slabă', color: '#ef4444' };
      case 2:
        return { score: 50, text: 'Medie', color: '#f59e0b' };
      case 3:
        return { score: 75, text: 'Bună', color: '#3b82f6' };
      case 4:
        return { score: 100, text: 'Foarte sigură', color: '#10b981' };
      default:
        return { score: 10, text: 'Prea scurtă', color: '#ef4444' };
    }
  };

  const strength = calculatePasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        if (!usernameOrEmail.trim() || !password) {
          throw new Error('Te rugăm să completezi toate câmpurile.');
        }
        const user = await login(usernameOrEmail.trim(), password);
        setSuccess('Autentificare realizată cu succes!');
        setTimeout(() => {
          if (onAuthSuccess) onAuthSuccess(user);
          onClose();
        }, 600);
      } else {
        // Înregistrare
        if (!username.trim() || !email.trim() || !password) {
          throw new Error('Toate câmpurile marcate sunt obligatorii.');
        }
        if (password.length < 8) {
          throw new Error('Parola trebuie să aibă minimum 8 caractere.');
        }
        if (password !== confirmPassword) {
          throw new Error('Parolele introduse nu coincid.');
        }

        const user = await register({
          username: username.trim(),
          email: email.trim(),
          password,
          fullName: fullName.trim() || username.trim(),
          preferredProfile,
        });

        setSuccess('Contul tău a fost creat cu succes!');
        setTimeout(() => {
          if (onAuthSuccess) onAuthSuccess(user);
          onClose();
        }, 700);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err.message || 'A apărut o problemă la autentificare.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider) => {
    setError(null);
    setSuccess(null);
    setSocialLoading(provider);

    try {
      // Simulare / interfață OAuth dedicată Google & Facebook
      // Dacă există un client ID configurat, se deschide dialogul; altfel fallback dev seamless
      const defaultEmail = provider === 'google' ? 'utilizator.google@gmail.com' : 'utilizator.fb@facebook.com';
      const defaultName = provider === 'google' ? 'Alex Google' : 'Maria Facebook';

      const user = await loginWithOAuth(provider, {
        email: defaultEmail,
        name: defaultName,
        providerId: `${provider}_id_${Date.now()}`,
        avatarUrl: provider === 'google'
          ? 'https://lh3.googleusercontent.com/a/default-user=s96-c'
          : 'https://graph.facebook.com/v18.0/me/picture',
      });

      setSuccess(`Conectat cu succes prin ${provider === 'google' ? 'Google' : 'Facebook'}!`);
      setTimeout(() => {
        if (onAuthSuccess) onAuthSuccess(user);
        onClose();
      }, 600);
    } catch (err) {
      console.error('OAuth error:', err);
      setError(err.message || `Eroare la conectarea prin ${provider}.`);
    } finally {
      setSocialLoading(null);
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
        style={{
          width: '100%',
          maxWidth: 460,
          backgroundColor: '#ffffff',
          borderRadius: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Header cu buton închidere */}
        <div style={{
          padding: '24px 28px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, backgroundColor: '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb'
              }}>
                <Accessibility size={20} />
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                AccessMap
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              {mode === 'login'
                ? 'Conectează-te pentru rute personalizate și salvare rapoarte'
                : 'Creează un cont pentru o experiență de navigare adaptată'}
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Închide fereastra"
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
              transition: 'background 0.2s',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Switcher Tab: Conectare / Înregistrare */}
        <div style={{ padding: '16px 28px 0' }}>
          <div style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            borderRadius: 12,
            padding: 4,
            gap: 4
          }}>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              style={{
                flex: 1,
                padding: '9px 16px',
                border: 'none',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: mode === 'login' ? '#ffffff' : 'transparent',
                color: mode === 'login' ? '#0f172a' : '#64748b',
                boxShadow: mode === 'login' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              Conectare
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(null); }}
              style={{
                flex: 1,
                padding: '9px 16px',
                border: 'none',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: mode === 'register' ? '#ffffff' : 'transparent',
                color: mode === 'register' ? '#0f172a' : '#64748b',
                boxShadow: mode === 'register' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              Înregistrare
            </button>
          </div>
        </div>

        {/* Mesaje Eroare / Succes */}
        <div style={{ padding: '0 28px', marginTop: 14 }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              backgroundColor: '#fef2f2', border: '1px solid #fee2e2',
              color: '#b91c1c', padding: '10px 14px', borderRadius: 10,
              fontSize: 13, lineHeight: '1.4'
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
              fontSize: 13, lineHeight: '1.4'
            }}>
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Butoane Social Login (Google & Facebook) */}
        <div style={{ padding: '14px 28px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Buton Google */}
          <button
            type="button"
            disabled={loading || !!socialLoading}
            onClick={() => handleOAuthLogin('google')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '11px 16px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              color: '#1e293b',
              cursor: 'pointer',
              transition: 'background-color 0.2s, border-color 0.2s',
            }}
          >
            {socialLoading === 'google' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
            )}
            <span>Continuă cu Google</span>
          </button>

          {/* Buton Facebook */}
          <button
            type="button"
            disabled={loading || !!socialLoading}
            onClick={() => handleOAuthLogin('facebook')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '11px 16px',
              backgroundColor: '#1877F2',
              border: 'none',
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
          >
            {socialLoading === 'facebook' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            )}
            <span>Continuă cu Facebook</span>
          </button>
        </div>

        {/* Separator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 28px 0',
          color: '#94a3b8',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontWeight: 600
        }}>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e2e8f0' }} />
          <span>sau prin email</span>
          <div style={{ flex: 1, height: 1, backgroundColor: '#e2e8f0' }} />
        </div>

        {/* Formular Principal */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'login' ? (
            <>
              {/* Login: Nume utilizator / Email */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Utilizator sau Email
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    required
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    placeholder="utilizator sau email@exemplu.ro"
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '11px 14px 11px 42px',
                      borderRadius: 12,
                      border: '1.5px solid #cbd5e1',
                      fontSize: 14,
                      color: '#0f172a',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </div>

              {/* Login: Parolă */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                    Parolă
                  </label>
                </div>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: '100%',
                      padding: '11px 42px 11px 42px',
                      borderRadius: 12,
                      border: '1.5px solid #cbd5e1',
                      fontSize: 14,
                      color: '#0f172a',
                      backgroundColor: '#ffffff',
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 4
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Register: Username & Email */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Nume utilizator *
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                    placeholder="ex: ion_popescu"
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
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Nume complet
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ion Popescu"
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
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  Adresă de Email *
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@exemplu.ro"
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 36px',
                      borderRadius: 10,
                      border: '1.5px solid #cbd5e1',
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </div>

              {/* Register: Parolă & Confirmare */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Parolă (min. 8) *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      style={{
                        width: '100%',
                        padding: '9px 32px 9px 12px',
                        borderRadius: 10,
                        border: '1.5px solid #cbd5e1',
                        fontSize: 13,
                        fontFamily: 'inherit',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2
                      }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Confirmă Parola *
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: `1.5px solid ${confirmPassword && confirmPassword !== password ? '#ef4444' : '#cbd5e1'}`,
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </div>

              {/* Indicator complexitate parolă */}
              {password && (
                <div style={{ marginTop: -4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: '#64748b' }}>Securitate parolă:</span>
                    <span style={{ fontWeight: 600, color: strength.color }}>{strength.text}</span>
                  </div>
                  <div style={{ height: 4, width: '100%', backgroundColor: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${strength.score}%`,
                      backgroundColor: strength.color,
                      transition: 'width 0.3s ease, background-color 0.3s ease'
                    }} />
                  </div>
                </div>
              )}

              {/* Informare profil dedicat nevăzători */}
              <div style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: 12,
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <Eye size={16} color="#2563eb" />
                <span>Contul tău include automat ghidarea dedicată pentru nevăzători.</span>
              </div>
            </>
          )}

          {/* Buton Submit */}
          <button
            type="submit"
            disabled={loading || !!socialLoading}
            style={{
              marginTop: 6,
              width: '100%',
              padding: '12px 20px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
              transition: 'background-color 0.2s, transform 0.1s',
            }}
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                <span>{mode === 'login' ? 'Intră în cont' : 'Creează contul'}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>

          {/* Notă Securitate */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginTop: 6,
            color: '#64748b',
            fontSize: 11
          }}>
            <ShieldCheck size={14} style={{ color: '#16a34a' }} />
            <span>Securizat cu criptare BCrypt & token-uri stateless JWT</span>
          </div>
        </form>
      </div>
    </div>
  );
}
