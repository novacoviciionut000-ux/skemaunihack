import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Accessibility,
  ArrowRight,
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authGetOAuthConfig } from '../api/client';

// How long to wait for Google to insert its sign-in button before concluding that the
// address was rejected. It renders asynchronously, usually well inside this window.
const GOOGLE_BUTTON_GRACE_MS = 2500;

export default function AuthModal({ isOpen, onClose, initialMode = 'login', onAuthSuccess }) {
  const { login, register, loginWithOAuth, checkUsername, updateProfile } = useAuth();

  // Set right after a first-time Google sign-in: the new account's user, until they pick a role
  const [roleChoice, setRoleChoice] = useState(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState(null);

  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [preferredProfile, setPreferredProfile] = useState('low_vision');
  const [accountType, setAccountType] = useState('CLIENT'); // 'CLIENT' | 'VOLUNTEER'

  // Stare verificare unicitate username în timp real
  const [usernameStatus, setUsernameStatus] = useState('idle'); // 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  const [usernameMessage, setUsernameMessage] = useState('');

  // Stări Google Identity Services & OAuth
  const [googleClientId, setGoogleClientId] = useState(() => {
    return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  });
  // Whether the server has a real Google client ID, which decides if Google sign-in is
  // offered at all
  const [googleConfigured, setGoogleConfigured] = useState(false);
  // True once Google's official button is drawn; then our fallback button is hidden
  const [officialGoogleButton, setOfficialGoogleButton] = useState(false);
  // Holds the current address when Google refuses it as an unregistered origin
  const [googleOriginProblem, setGoogleOriginProblem] = useState(null);

  // Stare email și confirmare
  const [mailStatus, setMailStatus] = useState({ configured: false, deliveryMode: 'NONE' });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'google' | 'facebook' | null
  const [error, setError] = useState(null);
  // Errors are also raised as a dialog on top of the form. The inline notice sits at the
  // top of a long modal while the submit button is at the bottom, so pressing "create
  // account" with a bad password looked like nothing happened at all.
  const [errorPopup, setErrorPopup] = useState(null);
  const errorPopupButtonRef = useRef(null);
  const [success, setSuccess] = useState(null);
  const [emailSentInfo, setEmailSentInfo] = useState(null);

  const googleButtonRef = useRef(null);
  // Move focus onto the error dialog so a screen reader reads it out, and let Escape
  // dismiss it without touching the form behind.
  useEffect(() => {
    if (!errorPopup) return;
    errorPopupButtonRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setErrorPopup(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [errorPopup]);

  // 1. Încărcare setări OAuth și configurare de la backend
  useEffect(() => {
    let active = true;
    authGetOAuthConfig().then((cfg) => {
      if (!active || !cfg) return;
      const bClientId = cfg.googleClientId;
      const backendHasRealId = bClientId && bClientId !== 'mock-google-client-id';

      // The backend is the source of truth: it is the side that verifies the token with
      // Google, so a client ID that disagrees with it can never produce a working login.
      // An override typed into the panel that used to live here won forever and broke
      // sign-in with no way to find out why, so a leftover one is cleared.
      localStorage.removeItem('accessmap_google_client_id');
      if (backendHasRealId) {
        setGoogleClientId(bClientId);
      }
      setGoogleConfigured(backendHasRealId);
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
    let observer = null;
    let graceTimer = null;
    let buttonDrawn = false;
    const effectiveClientId = googleClientId || 'mock-google-client-id';

    // Start from a clean slate: a warning left over from an earlier client ID or from a
    // previous time the dialog was opened must not survive into this attempt.
    setGoogleOriginProblem(null);

    const setupGoogleId = () => {
      if (typeof window === 'undefined' || !window.google?.accounts?.id) {
        return false;
      }

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
          const container = googleButtonRef.current;
          container.innerHTML = '';
          window.google.accounts.id.renderButton(container, {
            type: 'standard',
            shape: 'pill',
            theme: 'outline',
            text: 'continue_with',
            size: 'large',
            logo_alignment: 'left',
            // Google's button has a fixed pixel width; 380 overflowed the dialog on phones
            width: Math.max(200, Math.min(400, Math.floor(container.clientWidth || 320))),
          });

          // Google inserts its button asynchronously, so the container is still empty on
          // the very next line. Reading the count straight away reported a failure every
          // single time and showed the warning below even when sign-in worked, so the
          // container is watched for a moment instead.
          const markDrawn = () => {
            buttonDrawn = true;
            setOfficialGoogleButton(true);
            setGoogleOriginProblem(null);
          };

          if (container.childElementCount > 0) {
            markDrawn();
          } else {
            observer = new MutationObserver(() => {
              if (container.childElementCount > 0) {
                observer.disconnect();
                clearTimeout(graceTimer);
                markDrawn();
              }
            });
            observer.observe(container, { childList: true, subtree: true });
            graceTimer = setTimeout(() => {
              observer?.disconnect();
              if (container.childElementCount > 0) {
                markDrawn();
                return;
              }
              // Nothing appeared: Google refuses addresses that are not registered as an
              // authorised JavaScript origin, and says nothing about it. That is why
              // sign-in works on localhost but not from a phone or a tunnel URL.
              setOfficialGoogleButton(false);
              setGoogleOriginProblem(window.location.origin);
            }, GOOGLE_BUTTON_GRACE_MS);
          }
        }

        // 2. Afișare One Tap (arată automat conturile Google de pe telefon / browser)
        if (effectiveClientId !== 'mock-google-client-id') {
          window.google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed()) {
              const reason = notification.getNotDisplayedReason();
              console.log('Google One Tap notification:', reason);
              // Only these two mean the address is rejected. The rest ("no session",
              // "opted out", "suppressed") are normal and say nothing about the setup.
              if (!buttonDrawn && (reason === 'invalid_client' || reason === 'unregistered_origin')) {
                setGoogleOriginProblem(window.location.origin);
              }
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
      if (graceTimer) clearTimeout(graceTimer);
      if (observer) observer.disconnect();
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
        accountType,
      });

      // A brand-new Google account has no role chosen yet: ask before closing the modal.
      if (user.newUser) {
        setSuccess(null);
        setRoleChoice(user);
        return;
      }

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
      setError('Conectarea cu Google nu este configurată pe server. Folosește email și parolă.');
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
              accountType,
            });

            if (user.newUser) {
              setSuccess(null);
              setRoleChoice(user);
              return;
            }

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
    if (!pass) return { score: 0, text: '', color: '#E2E8F0' };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 1;
    if (/\d/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    switch (score) {
      case 1:
        return { score: 25, text: 'Slabă', color: '#B91C1C' };
      case 2:
        return { score: 50, text: 'Medie', color: '#B45309' };
      case 3:
        return { score: 75, text: 'Bună', color: '#1D4ED8' };
      case 4:
        return { score: 100, text: 'Foarte sigură', color: '#15803D' };
      default:
        return { score: 10, text: 'Prea scurtă', color: '#B91C1C' };
    }
  };

  const strength = calculatePasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setErrorPopup(null);
    setSuccess(null);
    setEmailSentInfo(null);

    if (mode === 'register' && usernameStatus === 'taken') {
      setError('Numele de utilizator ales este deja folosit. Te rugăm să alegi altul.');
      setErrorPopup('Numele de utilizator ales este deja folosit. Te rugăm să alegi altul.');
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
          accountType,
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
      const message = err.message || 'A apărut o problemă la autentificare.';
      setError(message);
      setErrorPopup(message);
    } finally {
      setLoading(false);
    }
  };

  // Saves the role picked after a first Google sign-in, then finishes the login.
  const handleRoleChoice = async (type) => {
    if (!roleChoice || roleSaving) return;
    setRoleSaving(true);
    setRoleError(null);
    try {
      let finalUser = roleChoice;
      if (type !== roleChoice.accountType) {
        const updated = await updateProfile({ accountType: type });
        finalUser = { ...roleChoice, ...updated, accountType: type };
      }
      setRoleChoice(null);
      if (onAuthSuccess) onAuthSuccess(finalUser);
      onClose();
    } catch (err) {
      setRoleError(err.message || 'Nu am putut salva alegerea. Încearcă din nou.');
    } finally {
      setRoleSaving(false);
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
        fontFamily: 'inherit',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Role picker after a first Google sign-in: blind / needs help, or volunteer. */}
      {roleChoice && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10002,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-choice-title"
            style={{
              width: '100%',
              maxWidth: 420,
              background: '#ffffff',
              borderRadius: 18,
              padding: '22px 22px 18px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <h3 id="role-choice-title" style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
              Cum vrei să folosești AccessMap?
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
              Ești conectat ca {roleChoice.fullName || roleChoice.email}. Alege tipul de cont. Îl poți schimba mai târziu din profil.
            </p>
            {[
              { id: 'CLIENT', title: 'Sunt nevăzător / am nevoie de ajutor', sub: 'Buton de ajutor care cheamă voluntari' },
              { id: 'VOLUNTEER', title: 'Vreau să fiu voluntar', sub: 'Primești alerte și puncte de faptă bună' },
            ].map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                autoFocus={i === 0}
                disabled={roleSaving}
                onClick={() => handleRoleChoice(opt.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  marginBottom: 10,
                  minHeight: 56,
                  borderRadius: 14,
                  border: '2px solid #2563eb',
                  background: '#eff6ff',
                  cursor: roleSaving ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{opt.title}</div>
                <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{opt.sub}</div>
              </button>
            ))}
            {roleError && (
              <p role="alert" style={{ margin: '4px 0 0', color: '#b91c1c', fontSize: 13 }}>{roleError}</p>
            )}
          </div>
        </div>
      )}

      {/* Error dialog. Shown on top of the form so a rejected password cannot be missed,
          and announced to screen readers through role="alertdialog". */}
      {errorPopup && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setErrorPopup(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Eroare"
            style={{
              width: '100%',
              maxWidth: 380,
              background: '#FFFFFF',
              borderRadius: 18,
              padding: '20px 22px',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.4)',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: '#B91C1C',
                fontWeight: 800,
                fontSize: 15,
                marginBottom: 8,
              }}
            >
              <AlertCircle size={20} style={{ flexShrink: 0 }} />
              <span>Nu am putut continua</span>
            </div>
            <p style={{ margin: '0 0 16px', color: '#334155', fontSize: 13.5, lineHeight: 1.5 }}>
              {errorPopup}
            </p>
            <button
              ref={errorPopupButtonRef}
              type="button"
              onClick={() => setErrorPopup(null)}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: 10,
                border: 'none',
                background: '#1D4ED8',
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                minHeight: 44,
              }}
            >
              Am înțeles
            </button>
          </div>
        </div>
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? 'Conectare în cont' : 'Creare cont nou'}
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)',
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
          borderBottom: '1px solid #F1F5F9',
          flexShrink: 0
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, backgroundColor: '#EFF6FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1D4ED8'
              }}>
                <Accessibility size={20} />
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0F172A' }}>
                AccessMap
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
              {mode === 'login'
                ? 'Conectează-te pentru navigație personalizată și securitate cont'
                : 'Creează un cont securizat cu unicitate garantată a utilizatorilor'}
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Închide fereastra"
            style={{
              background: '#F8FAFC',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748B',
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
                backgroundColor: '#FEF2F2', border: '1px solid #FEF2F2',
                color: '#B91C1C', padding: '10px 14px', borderRadius: 10,
                fontSize: 13, lineHeight: '1.4', marginBottom: 10
              }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                backgroundColor: '#F0FDF4', border: '1px solid #F0FDF4',
                color: '#15803D', padding: '10px 14px', borderRadius: 10,
                fontSize: 13, lineHeight: '1.4', marginBottom: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                  <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
                  <span>{success}</span>
                </div>
                {emailSentInfo && (
                  <div style={{ fontSize: 12, color: '#15803D', paddingLeft: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Mail size={13} />
                    <span>Confirmare expediată la: <strong>{emailSentInfo.recipient}</strong> ({emailSentInfo.note})</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Secțiune Conectare Reală cu Google */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Container Buton Oficial Google Identity Services */}
            <div
              ref={googleButtonRef}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                minHeight: officialGoogleButton ? 42 : 0,
              }}
            />

            {/* Google rejected this address, which it does not announce anywhere */}
            {googleOriginProblem && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#FFFBEB',
                  border: '1px solid #FCD34D',
                  color: '#B45309',
                  fontSize: 11.5,
                  lineHeight: 1.5,
                }}
              >
                Google nu acceptă adresa de pe care rulează aplicația. Adaugă exact{' '}
                <code style={{ fontWeight: 700, wordBreak: 'break-all' }}>{googleOriginProblem}</code>{' '}
                la <strong>Authorized JavaScript origins</strong> în Google Cloud Console, la
                același Client ID, apoi reîncarcă pagina. Conectarea cu email și parolă
                funcționează între timp.
              </div>
            )}

            {/* Fallback only if Google's official button couldn't be drawn (SDK blocked or not configured) */}
            {!officialGoogleButton && (
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
                backgroundColor: '#FFFFFF',
                border: '1.5px solid #CBD5E1',
                borderRadius: 14,
                fontSize: 14,
                fontWeight: 600,
                color: '#0F172A',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#B91C1C';
                e.currentTarget.style.backgroundColor = '#FEF2F2';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#CBD5E1';
                e.currentTarget.style.backgroundColor = '#FFFFFF';
              }}
            >
              {socialLoading === 'google' ? (
                <Loader2 size={18} className="animate-spin" color="#B91C1C" />
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
            )}

          </div>

          {/* Separator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 18,
            color: '#94A3B8',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600
          }}>
            <div style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
            <span>sau cu utilizator și parolă</span>
            <div style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
          </div>

          {/* Switcher Tab: Conectare / Înregistrare */}
          <div style={{ marginTop: 14 }}>
            <div style={{
              display: 'flex',
              backgroundColor: '#F1F5F9',
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
                  backgroundColor: mode === 'login' ? '#FFFFFF' : 'transparent',
                  color: mode === 'login' ? '#0F172A' : '#64748B',
                  boxShadow: mode === 'login' ? '0 2px 6px rgba(15, 23, 42, 0.06)' : 'none',
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
                  backgroundColor: mode === 'register' ? '#FFFFFF' : 'transparent',
                  color: mode === 'register' ? '#0F172A' : '#64748B',
                  boxShadow: mode === 'register' ? '0 2px 6px rgba(15, 23, 42, 0.06)' : 'none',
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
                    <User size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
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
                        border: '1.5px solid #CBD5E1',
                        fontSize: 14,
                        color: '#0F172A',
                        backgroundColor: '#FFFFFF',
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
                    <Lock size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
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
                        border: '1.5px solid #CBD5E1',
                        fontSize: 14,
                        color: '#0F172A',
                        backgroundColor: '#FFFFFF',
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
                        color: '#94A3B8',
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
                          ? '1.5px solid #15803D'
                          : usernameStatus === 'taken'
                          ? '1.5px solid #B91C1C'
                          : usernameStatus === 'invalid'
                          ? '1.5px solid #B45309'
                          : '1.5px solid #CBD5E1',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        outline: 'none',
                        backgroundColor: usernameStatus === 'available' ? '#F0FDF4' : (usernameStatus === 'taken' ? '#FEF2F2' : '#FFFFFF'),
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
                          ? '#15803D'
                          : usernameStatus === 'taken'
                          ? '#B91C1C'
                          : '#B45309'
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
                        border: '1.5px solid #CBD5E1',
                        fontSize: 13,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                {/* Register: account type (client asks for help, volunteer helps) */}
                <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Tip de cont
                  </legend>
                  <div role="radiogroup" style={{ display: 'flex', gap: 8 }}>
                    {[
                      { id: 'CLIENT', title: 'Am nevoie de ajutor', sub: 'Buton de ajutor care cheamă voluntari' },
                      { id: 'VOLUNTEER', title: 'Vreau să ajut', sub: 'Primești alerte și puncte de faptă bună' },
                    ].map((opt) => {
                      const selected = accountType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setAccountType(opt.id)}
                          style={{
                            flex: 1,
                            textAlign: 'left',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: selected ? '2px solid #1D4ED8' : '1.5px solid #CBD5E1',
                            background: selected ? '#EFF6FF' : '#FFFFFF',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{opt.title}</div>
                          <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2, lineHeight: 1.3 }}>{opt.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Register: Email */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Adresă de Email * (vei primi confirmare pe email)
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
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
                        border: '1.5px solid #CBD5E1',
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
                          border: '1.5px solid #CBD5E1',
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
                          background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 2
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
                        border: `1.5px solid ${confirmPassword && confirmPassword !== password ? '#B91C1C' : '#CBD5E1'}`,
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
                      <span style={{ color: '#64748B' }}>Securitate parolă:</span>
                      <span style={{ fontWeight: 600, color: strength.color }}>{strength.text}</span>
                    </div>
                    <div style={{ height: 4, width: '100%', backgroundColor: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
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
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: 12,
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <Eye size={16} color="#1D4ED8" />
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
                  ? '#94A3B8'
                  : '#1D4ED8',
                color: '#FFFFFF',
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
                boxShadow: '0 4px 12px rgba(29, 78, 216, 0.25)',
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

          </form>
        </div>
      </div>
    </div>
  );
}
