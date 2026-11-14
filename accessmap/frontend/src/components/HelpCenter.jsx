import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LifeBuoy, HeartHandshake, Trophy, Award, Navigation, CheckCircle2, XCircle, Users, Loader2, Power, X, Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  helpCreate, helpActive, helpCancel, helpConfirm, volunteerPresence, helpAccept, helpRelease, helpFinish,
  volunteerLeaderboard,
} from '../api/client';
import { speechQueue, playAlarmBeep } from '../utils/speechQueue';
import { listenOnce } from '../utils/listenOnce';
import { pickBestCommand } from '../utils/voiceCommands';
import { helpConfirmBridge, HELP_COMMAND_EVENT } from '../utils/helpVoiceBridge';

const CLIENT_POLL_MS = 4000;
const VOLUNTEER_POLL_MS = 8000;
const DISTANCE_MILESTONES = [1000, 500, 200, 50];

function say(text, opts = {}) {
  speechQueue.speak(text, { priority: 'urgent', ...opts });
}

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

function spokenMeters(m) {
  if (m == null) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} kilometri`;
  return `${Math.max(10, Math.round(m / 10) * 10)} de metri`;
}

function shortMeters(m) {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function getPosition(known) {
  if (known && known.lat != null) return Promise.resolve({ lat: known.lat, lng: known.lng });
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Telefonul nu oferă localizare.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Nu am putut afla unde ești. Permite accesul la locație.')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * Distress signal (clients) and good deeds with Deed points (volunteers).
 * Rendered for logged-in users only; the account type decides which side is shown.
 */
export default function HelpCenter(props) {
  const { user } = useAuth();
  if (!user) return null;
  return user.accountType === 'VOLUNTEER' ? <VolunteerPanel {...props} /> : <ClientPanel {...props} />;
}

// ════════════════════════════════════════════════════════════════════════════
// Client: distress button, live status, voice confirmation
// ════════════════════════════════════════════════════════════════════════════

function ClientPanel({ userLocation }) {
  const isMobile = useIsMobile();
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [thanks, setThanks] = useState(null); // { points, volunteer }
  const prevRef = useRef(null);
  const milestoneRef = useRef(Infinity);
  const answeringRef = useRef(false);
  const closedByMeRef = useRef(false);

  const answer = useCallback(async (yes) => {
    const r = prevRef.current;
    if (!r || answeringRef.current) return;
    answeringRef.current = true;
    helpConfirmBridge.clear();
    setAsking(false);
    try {
      const res = await helpConfirm(r.id, yes);
      if (yes) {
        closedByMeRef.current = true;
        setThanks({ points: res.pointsAwarded, volunteer: r.volunteerName });
        say(`Mulțumim! ${r.volunteerName || 'Voluntarul'} a primit ${res.pointsAwarded} de puncte pentru fapta bună.`, { interrupt: true });
        setRequest(null);
        prevRef.current = null;
      } else {
        say('Am anunțat voluntarul că încă nu e gata. Te ajută în continuare.', { interrupt: true });
        setRequest(res);
        prevRef.current = res;
      }
    } catch (e) {
      setError(e.message);
      say('Nu am putut trimite răspunsul. Încearcă din nou.', { interrupt: true });
    } finally {
      answeringRef.current = false;
    }
  }, []);

  // Volunteer pressed "deed finished": ask by voice, keep big Da / Nu buttons as backup
  const askConfirmation = useCallback((r) => {
    setAsking(true);
    helpConfirmBridge.ask(answer); // a double tap + "da" / "nu" also answers
    vibrate([200, 100, 200]);
    const question = `${r.volunteerName || 'Voluntarul'} spune că te-a ajutat. A fost rezolvat? Spune Da sau Nu.`;
    say(question, {
      interrupt: true,
      onEnd: async () => {
        if (!helpConfirmBridge.isAwaiting()) return; // already answered by tap / double tap
        const heard = await listenOnce({ timeoutMs: 7000 });
        if (!helpConfirmBridge.isAwaiting()) return;
        const cmd = pickBestCommand(heard, { awaitingConfirmation: true });
        if (cmd.type === 'confirm-yes') answer(true);
        else if (cmd.type === 'confirm-no') answer(false);
        else say('Nu am înțeles. Apasă Da sau Nu pe ecran, sau atinge de două ori și spune Da sau Nu.');
      },
    });
  }, [answer]);

  // React to status changes: speak what happened
  const applyUpdate = useCallback((next) => {
    const prev = prevRef.current;
    prevRef.current = next;
    setRequest(next);

    if (!next) {
      if (prev && !closedByMeRef.current) {
        say('Cererea ta de ajutor s-a încheiat fără răspuns. Poți trimite alta oricând.', { interrupt: true });
      }
      closedByMeRef.current = false;
      helpConfirmBridge.clear();
      setAsking(false);
      return;
    }
    if (next.status === 'ACCEPTED' && prev?.status === 'OPEN') {
      milestoneRef.current = Infinity;
      vibrate([150, 80, 150]);
      say(`${next.volunteerName} a acceptat și vine spre tine${next.volunteerDistanceMeters != null ? `, la ${spokenMeters(next.volunteerDistanceMeters)}` : ''}.`, { interrupt: true });
    }
    if (next.status === 'ACCEPTED' && next.volunteerDistanceMeters != null) {
      const m = DISTANCE_MILESTONES.find((x) => next.volunteerDistanceMeters <= x && x < milestoneRef.current);
      if (m != null && prev?.status === 'ACCEPTED') {
        milestoneRef.current = m;
        say(m <= 50 ? `${next.volunteerName} a ajuns aproape de tine.` : `${next.volunteerName} este la ${spokenMeters(next.volunteerDistanceMeters)}.`);
      }
    }
    if (next.status === 'AWAITING_CONFIRMATION' && prev?.status !== 'AWAITING_CONFIRMATION') {
      askConfirmation(next);
    }
  }, [askConfirmation]);

  // Resume after reload, then poll while a request is active
  useEffect(() => {
    let alive = true;
    helpActive().then((r) => alive && applyUpdate(r)).catch(() => {});
    return () => { alive = false; };
  }, [applyUpdate]);

  useEffect(() => {
    if (!request) return undefined;
    const t = setInterval(() => {
      helpActive().then(applyUpdate).catch(() => {});
    }, CLIENT_POLL_MS);
    return () => clearInterval(t);
  }, [request?.id, applyUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendDistress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setThanks(null);
    vibrate([300, 100, 300]);
    say('Trimit semnalul de ajutor.', { interrupt: true });
    try {
      const pos = await getPosition(userLocation);
      const r = await helpCreate(pos.lat, pos.lng);
      prevRef.current = r;
      setRequest(r);
      say(r.nearbyVolunteers > 0
        ? `Semnal trimis. Am anunțat ${r.nearbyVolunteers === 1 ? 'un voluntar' : `${r.nearbyVolunteers} voluntari`} din apropiere. Te anunț când vine cineva.`
        : 'Semnal trimis. Acum nu e niciun voluntar în serviciu aproape. Cererea rămâne activă și anunț imediat ce apare cineva.');
    } catch (e) {
      setError(e.message);
      say(`Nu am putut trimite semnalul. ${e.message}`, { interrupt: true });
    } finally {
      setBusy(false);
    }
  }, [busy, userLocation]);

  const cancel = useCallback(async () => {
    const r = prevRef.current;
    if (!r) return;
    try {
      closedByMeRef.current = true;
      await helpCancel(r.id);
      prevRef.current = null;
      setRequest(null);
      say('Am anulat cererea de ajutor.', { interrupt: true });
    } catch (e) {
      closedByMeRef.current = false;
      setError(e.message);
    }
  }, []);

  // Voice: "cheamă un voluntar", "anulează cererea"
  useEffect(() => {
    const onCmd = (e) => {
      if (e.detail.type === 'call-volunteer') sendDistress();
      if (e.detail.type === 'cancel-help') {
        if (prevRef.current) cancel();
        else say('Nu ai nicio cerere de ajutor activă.');
      }
    };
    window.addEventListener(HELP_COMMAND_EVENT, onCmd);
    return () => window.removeEventListener(HELP_COMMAND_EVENT, onCmd);
  }, [sendDistress, cancel]);

  useEffect(() => () => helpConfirmBridge.clear(), []);

  const statusText = !request ? '' : {
    OPEN: request.nearbyVolunteers > 0
      ? `Căutăm un voluntar... ${request.nearbyVolunteers} ${request.nearbyVolunteers === 1 ? 'voluntar anunțat' : 'voluntari anunțați'}`
      : 'Niciun voluntar în serviciu aproape. Cererea rămâne activă.',
    ACCEPTED: `${request.volunteerName} vine spre tine${request.volunteerDistanceMeters != null ? ` · ${shortMeters(request.volunteerDistanceMeters)}` : ''}`,
    AWAITING_CONFIRMATION: `${request.volunteerName} spune că a terminat. A fost rezolvat?`,
  }[request.status] || request.status;

  return (
    <>
      {!request && (
        <button
          type="button"
          onClick={sendDistress}
          disabled={busy}
          aria-label="Semnal de ajutor: anunță cei mai apropiați voluntari"
          style={{ ...launcherStyle(isMobile), background: '#dc2626', borderColor: '#fecaca', minWidth: isMobile ? 148 : 170 }}
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : <LifeBuoy size={20} />}
          <span>{busy ? 'Se trimite...' : 'Cer ajutor'}</span>
        </button>
      )}

      {(request || thanks || error) && (
        <div role="alert" aria-live="assertive" style={sheetStyle(isMobile, request?.status === 'AWAITING_CONFIRMATION' ? '#f59e0b' : '#dc2626')}>
          <div style={sheetHeader}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
              <LifeBuoy size={18} color="#f87171" />
              {thanks ? 'Fapta bună confirmată' : 'Semnal de ajutor'}
            </span>
            {!request && (
              <button type="button" aria-label="Închide" style={iconBtn} onClick={() => { setThanks(null); setError(''); }}>
                <X size={16} />
              </button>
            )}
          </div>

          {request && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>
              {request.status === 'OPEN' && <Loader2 size={18} className="animate-spin" style={{ flexShrink: 0 }} />}
              {request.status === 'ACCEPTED' && <Navigation size={18} color="#4ade80" style={{ flexShrink: 0 }} />}
              <span>{statusText}</span>
            </div>
          )}
          {request?.rejectedCount > 0 && request.status === 'ACCEPTED' && (
            <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 6 }}>Ai spus că nu e gata încă; voluntarul continuă.</div>
          )}

          {asking && request?.status === 'AWAITING_CONFIRMATION' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={() => answer(true)} style={{ ...bigBtn, background: '#16a34a' }} aria-label="Da, a fost rezolvat">
                <CheckCircle2 size={22} /> Da
              </button>
              <button type="button" onClick={() => answer(false)} style={{ ...bigBtn, background: '#475569' }} aria-label="Nu, încă nu e rezolvat">
                <XCircle size={22} /> Nu
              </button>
            </div>
          )}

          {request && (request.status === 'OPEN' || request.status === 'ACCEPTED') && (
            <button type="button" onClick={cancel} style={{ ...smallBtn, marginTop: 14 }}>Anulează cererea</button>
          )}

          {thanks && (
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>
              Mulțumim! <strong>{thanks.volunteer || 'Voluntarul'}</strong> a primit <strong>{thanks.points}</strong> puncte de faptă bună.
            </div>
          )}
          {error && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Volunteer: on duty toggle, incoming requests, route to the client, Deed points
// ════════════════════════════════════════════════════════════════════════════

const ON_DUTY_KEY = 'accessmap_volunteer_on_duty';

function VolunteerPanel({ userLocation, onNavigateTo, onClearRoute }) {
  const isMobile = useIsMobile();
  const { user, refreshUser } = useAuth();
  const [onDuty, setOnDuty] = useState(() => {
    try { return localStorage.getItem(ON_DUTY_KEY) === '1'; } catch { return false; }
  });
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [celebration, setCelebration] = useState(null);
  const [board, setBoard] = useState(null);
  const seenRef = useRef(new Set());
  const jobRef = useRef(null);
  const resultSeenRef = useRef(new Set());
  const routedJobRef = useRef(null);
  const locRef = useRef(userLocation);
  locRef.current = userLocation;
  // Callbacks from App change on every render; read them through refs so the heartbeat
  // interval is not torn down and restarted each time
  const navigateRef = useRef(onNavigateTo);
  navigateRef.current = onNavigateTo;
  const clearRouteRef = useRef(onClearRoute);
  clearRouteRef.current = onClearRoute;
  const clearRoute = () => clearRouteRef.current && clearRouteRef.current();

  const points = data?.deedPoints ?? user.deedPoints ?? 0;
  const level = data?.level || '';
  const job = data?.activeJob || null;

  const routeTo = useCallback((j) => {
    if (!j || !navigateRef.current) return;
    routedJobRef.current = j.id;
    navigateRef.current({ lat: j.latitude, lng: j.longitude, name: j.clientName });
  }, []);

  const handlePresence = useCallback((p) => {
    const prevJob = jobRef.current;
    jobRef.current = p.activeJob;
    setData(p);

    // New requests nearby: alarm, vibration, voice and a system notification
    const fresh = (p.nearby || []).filter((r) => !seenRef.current.has(r.id));
    fresh.forEach((r) => seenRef.current.add(r.id));
    if (fresh.length && !p.activeJob) {
      const r = fresh[0];
      playAlarmBeep();
      vibrate([400, 150, 400, 150, 400]);
      setOpen(true);
      const msg = `Cerere de ajutor de la ${r.clientFirstName}, la ${spokenMeters(r.distanceMeters)}.${r.note ? ` Mesaj: ${r.note}.` : ''}`;
      say(msg, { interrupt: true });
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker?.getRegistration().then((reg) => {
          const opts = { body: msg, tag: `help-${r.id}`, icon: '/icons/icon-192.png', vibrate: [400, 150, 400], renotify: true };
          if (reg) reg.showNotification('Cineva are nevoie de ajutor', opts);
          else new Notification('Cineva are nevoie de ajutor', opts); // eslint-disable-line no-new
        }).catch(() => {});
      }
    }

    // Client answered "no": keep helping
    if (p.activeJob && prevJob && p.activeJob.id === prevJob.id && p.activeJob.rejectedCount > prevJob.rejectedCount) {
      vibrate([200, 100, 200]);
      say(`${p.activeJob.clientName} spune că încă nu e gata. Mai ajut-o puțin, apoi apasă din nou Fapta e gata.`, { interrupt: true });
    }

    // Deed confirmed: celebrate once
    const res = p.recentResult;
    if (res && !resultSeenRef.current.has(res.id)) {
      resultSeenRef.current.add(res.id);
      if (prevJob && prevJob.id === res.id) {
        // Stop the route first: stopping navigation clears the speech queue
        clearRoute();
        setCelebration(res);
        setOpen(true);
        vibrate([100, 60, 100, 60, 300]);
        say(`Felicitări! ${res.clientName} a confirmat fapta bună. Ai primit ${res.pointsAwarded} de puncte.`, { interrupt: true });
        refreshUser();
      }
    }

    // Job vanished without a result: client cancelled or it expired
    if (prevJob && !p.activeJob && !(res && res.id === prevJob.id)) {
      if (routedJobRef.current === prevJob.id) clearRoute();
      routedJobRef.current = null;
      say(`Cererea lui ${prevJob.clientName} a fost anulată.`, { interrupt: true });
    }
  }, [refreshUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const beat = useCallback(async (duty) => {
    const loc = locRef.current;
    if (!loc || loc.lat == null) return;
    try {
      handlePresence(await volunteerPresence(loc.lat, loc.lng, duty));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [handlePresence]);

  // Heartbeat: always once (to resume an active job), then every few seconds while on duty or busy
  const hasLocation = Boolean(userLocation && userLocation.lat != null);
  useEffect(() => {
    if (!hasLocation) return undefined;
    beat(onDuty);
    if (!onDuty && !jobRef.current) return undefined;
    const t = setInterval(() => beat(onDuty), VOLUNTEER_POLL_MS);
    return () => clearInterval(t);
  }, [onDuty, hasLocation, Boolean(job), beat]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDuty = () => {
    const next = !onDuty;
    setOnDuty(next);
    try { localStorage.setItem(ON_DUTY_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    if (next) {
      setOpen(true);
      // Asked from the tap, as browsers require; used for alerts while the app is in the background
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      say(hasLocation ? 'Ești în serviciu. Te anunț când cineva din apropiere are nevoie de ajutor.' : 'Ești în serviciu. Aștept semnalul GPS.', { interrupt: true });
    } else {
      say('Ai ieșit din serviciu.', { interrupt: true });
    }
  };

  const accept = async (r) => {
    setBusy(`accept-${r.id}`);
    try {
      const j = await helpAccept(r.id);
      jobRef.current = j;
      setData((d) => ({ ...d, activeJob: j, nearby: [] }));
      say(`Ai acceptat. Pornesc ruta către ${j.clientName}, la ${spokenMeters(j.distanceMeters)}.`, { interrupt: true });
      routeTo(j);
    } catch (e) {
      setError(e.message);
      say(e.message, { interrupt: true });
      beat(onDuty);
    } finally {
      setBusy('');
    }
  };

  const finish = async () => {
    if (!job) return;
    setBusy('finish');
    try {
      const j = await helpFinish(job.id);
      jobRef.current = j;
      setData((d) => ({ ...d, activeJob: j }));
      say(`Am întrebat-o pe ${j.clientName} dacă a fost rezolvat. Primești punctele după confirmare.`, { interrupt: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const release = async () => {
    if (!job) return;
    setBusy('release');
    try {
      await helpRelease(job.id);
      jobRef.current = null;
      setData((d) => ({ ...d, activeJob: null }));
      clearRoute();
      say('Am trimis cererea altor voluntari.', { interrupt: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  // Voice: "fapta e gata"
  useEffect(() => {
    const onCmd = (e) => {
      if (e.detail.type !== 'deed-finished') return;
      if (jobRef.current?.status === 'ACCEPTED') finish();
      else say('Nu ai nicio faptă în desfășurare.');
    };
    window.addEventListener(HELP_COMMAND_EVENT, onCmd);
    return () => window.removeEventListener(HELP_COMMAND_EVENT, onCmd);
  }); // re-bound every render so finish() sees the current job

  const openBoard = async () => {
    setBoard({ loading: true, rows: [] });
    try {
      setBoard({ loading: false, rows: await volunteerLeaderboard() });
    } catch (e) {
      setBoard({ loading: false, rows: [], error: e.message });
    }
  };

  const nearby = data?.nearby || [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Panou voluntar. ${onDuty ? 'În serviciu' : 'În afara serviciului'}. ${points} puncte.`}
        style={{ ...launcherStyle(isMobile), background: onDuty ? '#15803d' : '#1e293b', borderColor: onDuty ? '#86efac' : '#475569' }}
      >
        <HeartHandshake size={19} />
        <span>{points} pct</span>
        {(nearby.length > 0 || job) && <span style={badgeDot} aria-hidden="true" />}
      </button>

      {open && (
        <div style={sheetStyle(isMobile, job ? '#22c55e' : nearby.length ? '#dc2626' : '#334155')} role="region" aria-label="Panou voluntar">
          <div style={sheetHeader}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
              <HeartHandshake size={18} color="#4ade80" /> Voluntar
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" aria-label="Clasament voluntari" style={iconBtn} onClick={openBoard}><Trophy size={16} /></button>
              <button type="button" aria-label="Închide panoul" style={iconBtn} onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
          </div>

          {/* Points and level */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Award size={30} color="#facc15" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{points} <span style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1' }}>puncte de faptă bună</span></div>
              <div style={{ fontSize: 12.5, color: '#cbd5e1' }}>
                {level}{data?.nextLevelAt ? ` · încă ${data.nextLevelAt - points} până la nivelul următor` : ''}
                {data ? ` · ${data.deedsCompleted} fapte` : ''}
              </div>
              {data?.nextLevelAt > 0 && (
                <div style={{ height: 6, borderRadius: 3, background: '#334155', marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (points / data.nextLevelAt) * 100)}%`, background: '#facc15' }} />
                </div>
              )}
            </div>
          </div>

          {celebration && (
            <div style={{ background: '#14532d', border: '1px solid #22c55e', borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>+{celebration.pointsAwarded} puncte! {celebration.clientName} a confirmat.</div>
              {celebration.breakdown && (
                <div style={{ fontSize: 12.5, color: '#bbf7d0', lineHeight: 1.5 }}>
                  Bază {celebration.breakdown.base}
                  {celebration.breakdown.speed > 0 && ` · răspuns rapid +${celebration.breakdown.speed}`}
                  {celebration.breakdown.distance > 0 && ` · distanță +${celebration.breakdown.distance}`}
                  {celebration.breakdown.firstTry > 0 && ` · din prima +${celebration.breakdown.firstTry}`}
                </div>
              )}
              <button type="button" style={{ ...smallBtn, marginTop: 8 }} onClick={() => setCelebration(null)}>Super</button>
            </div>
          )}

          {/* Active job */}
          {job ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                {job.status === 'ACCEPTED' ? `Mergi la ${job.clientName}` : `Așteptăm confirmarea lui ${job.clientName}...`}
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>
                {job.distanceMeters != null && `${shortMeters(job.distanceMeters)} până la persoană`}
                {job.note && ` · „${job.note}”`}
              </div>
              {job.status === 'ACCEPTED' && (
                <>
                  <button type="button" onClick={finish} disabled={busy === 'finish'} style={{ ...bigBtn, background: '#16a34a', width: '100%' }}>
                    {busy === 'finish' ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={22} />} Fapta e gata
                  </button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" style={{ ...smallBtn, flex: 1 }} onClick={() => routeTo(job)}><Navigation size={14} /> Arată ruta</button>
                    <button type="button" style={{ ...smallBtn, flex: 1 }} onClick={release} disabled={busy === 'release'}>Nu mai pot ajunge</button>
                  </div>
                </>
              )}
              {job.status === 'AWAITING_CONFIRMATION' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#fde68a' }}>
                  <Loader2 size={16} className="animate-spin" /> Persoana este întrebată vocal dacă a fost rezolvat.
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleDuty}
                aria-pressed={onDuty}
                style={{ ...bigBtn, width: '100%', background: onDuty ? '#15803d' : '#2563eb' }}
              >
                <Power size={20} /> {onDuty ? 'În serviciu · apasă ca să ieși' : 'Intră în serviciu'}
              </button>
              {onDuty && !hasLocation && <div style={{ fontSize: 12.5, color: '#fde68a', marginTop: 8 }}>Aștept semnalul GPS...</div>}

              {onDuty && hasLocation && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#cbd5e1', marginBottom: 6 }}>
                    {nearby.length ? <Bell size={14} color="#f87171" /> : <Users size={14} />}
                    {nearby.length ? 'Cereri de ajutor aproape de tine' : 'Nicio cerere aproape de tine acum.'}
                  </div>
                  {nearby.map((r) => (
                    <div key={r.id} style={requestCard}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>{r.clientFirstName} · {shortMeters(r.distanceMeters)}</div>
                        <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                          acum {Math.max(1, Math.round(r.ageSeconds / 60))} min{r.note ? ` · „${r.note}”` : ''}
                        </div>
                      </div>
                      <button type="button" onClick={() => accept(r)} disabled={Boolean(busy)} style={{ ...bigBtn, padding: '10px 14px', background: '#dc2626' }}>
                        {busy === `accept-${r.id}` ? <Loader2 size={18} className="animate-spin" /> : 'Ajut'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {board && (
        <div style={modalBackdrop} onClick={() => setBoard(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Clasamentul voluntarilor">
            <div style={sheetHeader}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Trophy size={18} color="#facc15" /> Clasament voluntari</span>
              <button type="button" aria-label="Închide" style={iconBtn} onClick={() => setBoard(null)}><X size={16} /></button>
            </div>
            {board.loading && <Loader2 size={20} className="animate-spin" />}
            {board.error && <div style={{ color: '#fca5a5' }}>{board.error}</div>}
            {!board.loading && !board.rows.length && !board.error && <div style={{ color: '#cbd5e1' }}>Încă nu are nimeni puncte. Fii primul!</div>}
            {board.rows.map((r) => (
              <div key={r.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ width: 24, fontWeight: 900, color: r.rank <= 3 ? '#facc15' : '#94a3b8' }}>{r.rank}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{r.name}<span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', fontWeight: 500 }}>{r.level} · {r.deedsCompleted} fapte</span></span>
                <span style={{ fontWeight: 900 }}>{r.deedPoints}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const launcherStyle = (isMobile) => ({
  position: 'fixed',
  top: isMobile ? 64 : 76,
  left: isMobile ? 12 : 20,
  zIndex: 1005,
  minHeight: 48,
  padding: '0 16px',
  borderRadius: 24,
  border: '2px solid',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
  fontFamily: 'system-ui, sans-serif',
});

const sheetStyle = (isMobile, accent) => ({
  position: 'fixed',
  left: isMobile ? 10 : 20,
  right: isMobile ? 10 : 'auto',
  top: isMobile ? 120 : 132,
  width: isMobile ? 'auto' : 380,
  maxHeight: isMobile ? 'calc(100dvh - 140px)' : 'calc(100dvh - 160px)',
  overflowY: 'auto',
  zIndex: 1300, // above the full-screen camera (1200)
  background: 'rgba(15, 23, 42, 0.97)',
  color: '#f8fafc',
  border: `2px solid ${accent}`,
  borderRadius: 18,
  padding: 16,
  boxShadow: '0 18px 45px rgba(0,0,0,0.5)',
  fontFamily: 'system-ui, sans-serif',
});

const sheetHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 14 };
const iconBtn = { width: 32, height: 32, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const bigBtn = { flex: 1, minHeight: 52, borderRadius: 14, border: 'none', color: '#fff', fontSize: 16, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', padding: '0 16px' };
const smallBtn = { minHeight: 40, borderRadius: 10, border: '1px solid #475569', background: '#1e293b', color: '#e2e8f0', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', padding: '0 12px' };
const requestCard = { display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: '#1e293b', border: '1px solid #7f1d1d', marginBottom: 8 };
const badgeDot = { width: 10, height: 10, borderRadius: '50%', background: '#f87171', boxShadow: '0 0 0 3px rgba(248,113,113,0.35)' };
const modalBackdrop = { position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(2,6,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const modalCard = { width: 'min(420px, 100%)', maxHeight: '80dvh', overflowY: 'auto', background: '#0f172a', color: '#f8fafc', borderRadius: 18, padding: 16, border: '1px solid #334155', fontFamily: 'system-ui, sans-serif' };
