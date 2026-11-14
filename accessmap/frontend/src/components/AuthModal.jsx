import React, { useState, useEffect, useRef } from 'react';
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
  ArrowRight,
  Sparkles,
  ChevronRight,
  Settings,
  ExternalLink,
  Smartphone
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authGetOAuthConfig } from '../api/client';

export default function AuthModal({ isOpen, onClose, initialMode = 'login', onAuthSuccess }) {
  const { login, register, loginWithOAuth, checkUsername } = useAuth();

  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [preferredProfile, setPreferredProfile] = useState('low_vision');

  // Stare verificare unicitate username în timp real
  const [usernameStatus, setUsernameStatus] = useState('idle'); // 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  const [usernameMessage, setUsernameMessage] = useState('');

  // Stări Google Identity Services & OAuth
  const [googleClientId, setGoogleClientId] = useState(() => {
    return localStorage.getItem('accessmap_google_client_id') ||
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      '';
  });
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);
  const [customClientIdInput, setCustomClientIdInput] = useState('');
  const [googleSdkReady, setGoogleSdkReady] = useState(false);

  // Stare email și confirmare
  const [mailStatus, setMailStatus] = useState({ configured: false, deliveryMode: 'NONE' });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'google' | 'facebook' | null
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [emailSentInfo, setEmailSentInfo] = useState(null);

  const googleButtonRef = useRef(null);

  // 1. Încărcare setări OAuth și configurare de la backend
  useEffect(() => {
    let active = true;
    authGetOAuthConfig().then((cfg) => {
      if (!active || !cfg) return;
      const bClientId = cfg.googleClientId;
      if (bClientId && bClientId !== 'mock-google-client-id' && !localStorage.getItem('accessmap_google_client_id')) {
        setGoogleClientId(bClientId);
      }
      setGoogleConfigured(cfg.googleConfigured || Boolean(localStorage.getItem('accessmap_google_client_id')));
      setMailStatus({
        configured: cfg.mailConfigured || false,
        deliveryMode: cfg.mailDeliveryMode || 'LOCAL_DEV_LOG'
      });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // 2. Inițializare Google Identity Services (GIS) & Google One Tap
  useEffect(() => {
    if (!isOpen) return;

    let checkInterval = null;
    const effectiveClientId = googleClientId || 'mock-google-client-id';

    const setupGoogleId = () => {
      if (typeof window === 'undefined' || !window.google?.accounts?.id) {
        return false;
      }

      setGoogleSdkReady(true);

      try {
        // Inițializare Google Identity Services cu handler oficial
        window.google.accounts.id.initialize({
          client_id: effectiveClientId,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          itp_support: true,
        });

        // 1. Randare buton oficial Google Sign-In dacă este configurat Client ID-ul
        if (googleButtonRef.current && effectiveClientId !== 'mock-google-client-id') {
          googleButtonRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(googleButtonRef.current, {
            type: 'standard',
            shape: 'pill',
            theme: 'outline',
            text: 'continue_with',
            size: 'large',
            logo_alignment: 'left',
            width: 380,
          });
        }

        // 2. Afișare One Tap (arată automat conturile Google de pe telefon / browser)
        if (effectiveClientId !== 'mock-google-client-id') {
          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed()) {
              console.log('Google One Tap notification:', notification.getNotDisplayedReason());
            }
          });
        }

        return true;
      } catch (err) {
        console.warn('Google Identity Services init warning:', err);
        return true;
      }
    };

    if (!setupGoogleId()) {
      checkInterval = setInterval(() => {
        if (setupGoogleId()) {
          clearInterval(checkInterval);
        }
      }, 300);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, [isOpen, googleClientId]);

  // Decodare sigură a Google JWT ID Token
  const parseGoogleJwt = (token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return {};
    }
  };

  // Callback oficial Google când utilizatorul alege un cont real din One Tap sau Butonul Google
  const handleGoogleCredentialResponse = async (response) => {
    if (!response || !response.credential) {
      setError('Nu s-au putut prelua datele de la Google.');
      return;
    }

    setError(null);
    setSocialLoading('google');

    try {
      const token = response.credential;
      const payload = parseGoogleJwt(token);

      const targetEmail = payload.email || '';
      const targetName = payload.name || targetEmail.split('@')[0];
      const targetAvatar = payload.picture || null;
      const targetSub = payload.sub || null;

      if (!targetEmail) {
        throw new Error('Contul Google selectat nu a furnizat o adresă de email.');
      }

      setSuccess(`Se verifică contul Google oficial: ${targetEmail}...`);

      const user = await loginWithOAuth('google', {
        token: token,
        email: targetEmail,
        name: targetName,
        providerId: targetSub,
        avatarUrl: targetAvatar,
      });

      const deliveryNote = user.emailDeliveryMode === 'LIVE_SMTP'
        ? 'Livrat live prin Gmail SMTP'
        : 'Dispecerat securizat';

      setSuccess(`Conectat cu succes ca ${user.fullName || targetName}!`);
      setEmailSentInfo({
        recipient: user.email || targetEmail,
        note: deliveryNote
      });

      setTimeout(() => {
        if (onAuthSuccess) onAuthSuccess(user);
        onClose();
      }, 900);
    } catch (err) {
      console.error('Eroare autentificare Google:', err);
      setError(err.message || 'Contul Google nu a putut fi verificat.');
    } finally {
      setSocialLoading(null);
    }
  };

  // Deschidere selector oficial Google (Popup Flow)
  const handleGooglePopupClick = () => {
    setError(null);
    setSuccess(null);

    // Dacă utilizatorul nu a configurat încă un Google Client ID real, îi oferim fereastra rapidă de setare
    if (!googleClientId || googleClientId === 'mock-google-client-id') {
      setShowGoogleConfig(true);
      return;
    }

    if (!window.google?.accounts?.oauth2) {
      setError('Librăria Google Identity Services se încarcă. Te rugăm să încerci din nou în 2 secunde.');
      return;
    }

    setSocialLoading('google');

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            setSocialLoading(null);
            if (tokenResponse.error !== 'popup_closed_by_user') {
              setError(`Eroare Google OAuth: ${tokenResponse.error}`);
            }
            return;
          }

          try {
            // Preluare profil verificat direct de la serverele Google
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
            });

            if (!userInfoRes.ok) {
              throw new Error('Nu s-au putut prelua detaliile de profil de la Google.');
            }

            const googleProfile = await userInfoRes.json();

            const user = await loginWithOAuth('google', {
              token: tokenResponse.access_token,
              email: googleProfile.email,
              name: googleProfile.name,
              avatarUrl: googleProfile.picture,
              providerId: googleProfile.sub,
            });

            setSuccess(`Conectat cu succes ca ${user.fullName || googleProfile.name}!`);
            setEmailSentInfo({
              recipient: user.email || googleProfile.email,
              note: user.emailDeliveryMode === 'LIVE_SMTP' ? 'Livrat live prin Gmail' : 'Dispecerat local'
            });

            setTimeout(() => {
              if (onAuthSuccess) onAuthSuccess(user);
              onClose();
            }, 800);
          } catch (fetchErr) {
            setError(fetchErr.message || 'Eroare la validarea profilului Google.');
          } finally {
            setSocialLoading(null);
          }
        },
      });

      client.requestAccessToken({ prompt: 'select_account' });
    } catch (popupErr) {
      setSocialLoading(null);
      setError(popupErr.message || 'Nu s-a putut deschide fereastra Google Sign-In.');
    }
  };

  // Salvare Google Client ID personalizat din UI
  const handleSaveGoogleClientId = (e) => {
    e.preventDefault();
    const clean = customClientIdInput.trim();
    if (!clean) {
      setError('Te rugăm să introduci un Google Client ID valid.');
      return;
    }
    localStorage.setItem('accessmap_google_client_id', clean);
    setGoogleClientId(clean);
    setGoogleConfigured(true);
    setShowGoogleConfig(false);
    setSuccess('Google Client ID configurat cu succes! Conectarea cu Google este acum activă.');
  };

  // Verificare unicitate username în timp real pe măsură ce utilizatorul tastează (debounced)
  useEffect(() => {
    if (mode !== 'register' || !username.trim()) {
      setUsernameStatus('idle');
      setUsernameMessage('');
      return;
    }

    const clean = username.trim().toLowerCase();
    if (clean.length < 3) {
      setUsernameStatus('invalid');
      setUsernameMessage('Minim 3 caractere');
      return;
    }

    if (!/^[a-z0-9_.-]+$/.test(clean)) {
      setUsernameStatus('invalid');
      setUsernameMessage('Doar litere, cifre, punct, linie și underscore');
      return;
    }

    setUsernameStatus('checking');
    setUsernameMessage('Se verifică disponibilitatea...');

    const timer = setTimeout(async () => {
      try {
        if (checkUsername) {
          const res = await checkUsername(clean);
          if (res && res.available) {
            setUsernameStatus('available');
            setUsernameMessage('Nume de utilizator disponibil');
          } else {
            setUsernameStatus('taken');
            setUsernameMessage(res?.message || 'Numele de utilizator este deja folosit');
          }
        }
      } catch (e) {
        setUsernameStatus('idle');
        setUsernameMessage('');
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [username, mode, checkUsername]);

  if (!isOpen) return null;

  // Calcul putere parolă
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
    setEmailSentInfo(null);

    if (mode === 'register' && usernameStatus === 'taken') {
      setError('Numele de utilizator ales este deja folosit. Te rugăm să alegi altul.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        if (!usernameOrEmail.trim() || !password) {
          throw new Error('Te rugăm să completezi toate câmpurile.');
        }
        const user = await login(usernameOrEmail.trim(), password);
        setSuccess('Autentificare realizată cu succes!');
        setEmailSentInfo({
          recipient: user.email,
          note: user.emailDeliveryMode === 'LIVE_SMTP' ? 'Livrat prin Gmail' : 'Dispecerat local'
        });
        setTimeout(() => {
          if (onAuthSuccess) onAuthSuccess(user);
          onClose();
        }, 800);
      } else {
        // Înregistrare cu date proprii
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
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName.trim() || username.trim(),
          preferredProfile,
        });

        setSuccess('Contul tău a fost creat cu succes!');
        setEmailSentInfo({
          recipient: user.email,
          note: user.emailDeliveryMode === 'LIVE_SMTP' ? 'Livrat prin Gmail' : 'Dispecerat local'
        });
        setTimeout(() => {
          if (onAuthSuccess) onAuthSuccess(user);
          onClose();
        }, 900);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err.message || 'A apărut o problemă la autentificare.');
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
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#ffffff',
          borderRadius: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          position: 'relative',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header cu logo și buton închidere */}
        <div style={{
          padding: '22px 28px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9',
          flexShrink: 0
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
                ? 'Conectează-te pentru navigație personalizată și securitate cont'
                : 'Creează un cont securizat cu unicitate garantată a utilizatorilor'}
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

        {/* Corp Scrollabil */}
        <div style={{ overflowY: 'auto', padding: '0 28px 24px', flex: 1 }}>

          {/* Notificări Eroare / Succes */}
          <div style={{ marginTop: 14 }}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                backgroundColor: '#fef2f2', border: '1px solid #fee2e2',
                color: '#b91c1c', padding: '10px 14px', borderRadius: 10,
                fontSize: 13, lineHeight: '1.4', marginBottom: 10
              }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                backgroundColor: '#f0fdf4', border: '1px solid #dcfce7',
                color: '#15803d', padding: '10px 14px', borderRadius: 10,
                fontSize: 13, lineHeight: '1.4', marginBottom: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                  <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                  <span>{success}</span>
                </div>
                {emailSentInfo && (
                  <div style={{ fontSize: 12, color: '#166534', paddingLeft: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mail size={13} />
                    <span>Confirmare expediată la: <strong>{emailSentInfo.recipient}</strong> ({emailSentInfo.note})</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Panou Configurare Google OAuth (când utilizatorul dorește să seteze Client ID-ul oficial) */}
          {showGoogleConfig ? (
            <div style={{
              marginTop: 10,
              padding: '16px',
              backgroundColor: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: 16,
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings size={18} color="#2563eb" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                    Configurare Google Sign-In Real
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGoogleConfig(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={16} />
                </button>
              </div>

              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                Pentru ca Google să verifice direct dacă conturile există și să sugereze conturile pe care le ai deja pe telefon sau calculator, introdu <strong>Google Client ID</strong> din Google Cloud Console:
              </p>

              <form onSubmit={handleSaveGoogleClientId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>
                    Google OAuth 2.0 Web Client ID
                  </label>
                  <input
                    type="text"
                    value={customClientIdInput}
                    onChange={(e) => setCustomClientIdInput(e.target.value)}
                    placeholder="ex: 123456789-abcdef.apps.googleusercontent.com"
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1.5px solid #cbd5e1',
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="submit"
                    style={{
                      flex: 1,
                      padding: '9px 14px',
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Salvează & Activează Google
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGoogleConfig(false)}
                    style={{
                      padding: '9px 14px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      fontSize: 13,
                      color: '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    Anulează
                  </button>
                </div>

                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
                  💡 <em>Origini permise în Google Console:</em> <code>http://localhost:3000</code> și <code>http://localhost</code>.
                </div>
              </form>
            </div>
          ) : null}

          {/* Secțiune Conectare Reală cu Google */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 600,
              color: '#475569'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color="#ea4335" />
                <span>Autentificare Oficială Google</span>
              </span>

              <button
                type="button"
                onClick={() => {
                  setCustomClientIdInput(googleClientId || '');
                  setShowGoogleConfig(!showGoogleConfig);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 6px',
                  borderRadius: 6
                }}
              >
                <Settings size={12} />
                <span>{googleConfigured ? 'Client ID activ' : 'Configurează Client ID'}</span>
              </button>
            </div>

            {/* Container Buton Oficial Google Identity Services */}
            <div
              ref={googleButtonRef}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                minHeight: googleConfigured ? 42 : 0,
              }}
            />

            {/* Buton Principal Google Sign-In cu Account Picker nativ */}
            <button
              type="button"
              disabled={loading || !!socialLoading}
              onClick={handleGooglePopupClick}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: '12px 18px',
                backgroundColor: '#ffffff',
                border: '1.5px solid #cbd5e1',
                borderRadius: 14,
                fontSize: 14,
                fontWeight: 600,
                color: '#0f172a',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#ea4335';
                e.currentTarget.style.backgroundColor = '#fef2f2';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#cbd5e1';
                e.currentTarget.style.backgroundColor = '#ffffff';
              }}
            >
              {socialLoading === 'google' ? (
                <Loader2 size={18} className="animate-spin" color="#ea4335" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              <span>
                {socialLoading === 'google'
                  ? 'Se conectează cu Google...'
                  : 'Continuă cu Contul Google'}
              </span>
            </button>

            {/* Informare despre verificarea existenței conturilor Google */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              backgroundColor: '#f8fafc',
              borderRadius: 10,
              fontSize: 11.5,
              color: '#64748b'
            }}>
              <Smartphone size={16} color="#059669" style={{ flexShrink: 0 }} />
              <span>
                Verificare Google autentică: sistemul solicită conturile reale salvate pe telefon/browser. Dacă un cont nu există, Google îl respinge automat.
              </span>
            </div>
          </div>

          {/* Separator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 18,
            color: '#94a3b8',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600
          }}>
            <div style={{ flex: 1, height: 1, backgroundColor: '#e2e8f0' }} />
            <span>sau cu utilizator și parolă</span>
            <div style={{ flex: 1, height: 1, backgroundColor: '#e2e8f0' }} />
          </div>

          {/* Switcher Tab: Conectare / Înregistrare */}
          <div style={{ marginTop: 14 }}>
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
                  fontSize: 13.5,
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
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: mode === 'register' ? '#ffffff' : 'transparent',
                  color: mode === 'register' ? '#0f172a' : '#64748b',
                  boxShadow: mode === 'register' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                Înregistrare cont nou
              </button>
            </div>
          </div>

          {/* Formular Principal (Login / Register) */}
          <form onSubmit={handleSubmit} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                      placeholder="utilizator sau adresa@gmail.com"
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
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                {/* Login: Parolă */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Parolă
                  </label>
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
                        boxSizing: 'border-box'
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
                {/* Register: Username & Nume complet */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                      Nume utilizator unic *
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
                        border: usernameStatus === 'available'
                          ? '1.5px solid #16a34a'
                          : usernameStatus === 'taken'
                          ? '1.5px solid #ef4444'
                          : usernameStatus === 'invalid'
                          ? '1.5px solid #f59e0b'
                          : '1.5px solid #cbd5e1',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        outline: 'none',
                        backgroundColor: usernameStatus === 'available' ? '#f0fdf4' : (usernameStatus === 'taken' ? '#fef2f2' : '#ffffff'),
                        boxSizing: 'border-box'
                      }}
                    />

                    {/* Indicator de validare în timp real a unicității username-ului */}
                    {username && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        color: usernameStatus === 'available'
                          ? '#16a34a'
                          : usernameStatus === 'taken'
                          ? '#dc2626'
                          : '#d97706'
                      }}>
                        {usernameStatus === 'checking' && <Loader2 size={12} className="animate-spin" />}
                        {usernameStatus === 'available' && <CheckCircle2 size={12} />}
                        {usernameStatus === 'taken' && <AlertCircle size={12} />}
                        {usernameStatus === 'invalid' && <AlertCircle size={12} />}
                        <span>{usernameMessage}</span>
                      </div>
                    )}
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
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                {/* Register: Email */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Adresă de Email * (vei primi confirmare pe email)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="adresa.ta@gmail.com"
                      style={{
                        width: '100%',
                        padding: '9px 12px 9px 36px',
                        borderRadius: 10,
                        border: '1.5px solid #cbd5e1',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
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
                          boxSizing: 'border-box'
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
                        boxSizing: 'border-box'
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

                {/* Profil Asistiv */}
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
                  <span>Contul include automat ghidarea dedicată pentru nevăzători & mobilitate urbană.</span>
                </div>
              </>
            )}

            {/* Buton Submit */}
            <button
              type="submit"
              disabled={loading || !!socialLoading || (mode === 'register' && (usernameStatus === 'taken' || usernameStatus === 'checking' || username.length < 3))}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '12px 20px',
                backgroundColor: (mode === 'register' && (usernameStatus === 'taken' || usernameStatus === 'checking' || username.length < 3))
                  ? '#94a3b8'
                  : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                cursor: (mode === 'register' && (usernameStatus === 'taken' || usernameStatus === 'checking' || username.length < 3))
                  ? 'not-allowed'
                  : 'pointer',
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
                  <span>{mode === 'login' ? 'Intră în cont' : 'Creează contul și trimite confirmarea'}</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {/* Notă Securitate Cont */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 4,
              color: '#64748b',
              fontSize: 11
            }}>
              <ShieldCheck size={14} style={{ color: '#16a34a' }} />
              <span>Protejat cu verificare token Google OAuth & Criptare BCrypt</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
