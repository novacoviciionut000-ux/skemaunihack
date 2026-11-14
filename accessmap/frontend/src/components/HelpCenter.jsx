import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LifeBuoy, HeartHandshake, Trophy, Award, Navigation, CheckCircle2, XCircle, Users, Loader2, Power, X, Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { palette, rgb, radius, shadow } from '../theme';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  helpCreate, helpActive, helpCancel, helpConfirm, volunteerPresence, helpAccept, helpRelease, helpFinish,
  volunteerLeaderboard,
} from '../api/client';
import { speechQueue, playAlarmBeep } from '../utils/speechQueue';
import { helpConfirmBridge, HELP_COMMAND_EVENT, requestVoiceListen } from '../utils/helpVoiceBridge';

const CLIENT_POLL_MS = 4000;
const VOLUNTEER_POLL_MS = 8000;
const DISTANCE_MILESTONES = [1000, 500, 200, 50];
// After asking "A fost rezolvat?": how long to wait for an answer, and how many times to ask
const CONFIRM_LISTEN_MS = 9000;
const CONFIRM_ATTEMPTS = 3;

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

/** Spoken summary of the client's request. */
function describe(r) {
  if (!r) return '';
  if (r.status === 'OPEN') {
    return r.nearbyVolunteers > 0
      ? `Căutăm un voluntar. ${r.nearbyVolunteers === 1 ? 'Un voluntar a fost anunțat' : `${r.nearbyVolunteers} voluntari au fost anunțați`}.`
      : 'Încă nu e niciun voluntar aproape. Cererea rămâne activă.';
  }
  if (r.status === 'ACCEPTED') {
    return `${r.volunteerName} vine spre tine${r.volunteerDistanceMeters != null ? `, la ${spokenMeters(r.volunteerDistanceMeters)}` : ''}.`;
  }
  if (r.status === 'AWAITING_CONFIRMATION') return `${r.volunteerName} spune că a terminat. Spune Da dacă a fost rezolvat, sau Nu.`;
  return '';
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

  // Help voice commands from someone who isn't logged in
  useEffect(() => {
    if (user) return undefined;
    const onCmd = (e) => {
      if (e.detail.type === 'call-volunteer') {
        say('Ca să chem un voluntar, trebuie să fii conectat în aplicație. Pentru urgențe spune: sună la 112.', { interrupt: true });
      }
    };
    window.addEventListener(HELP_COMMAND_EVENT, onCmd);
    return () => window.removeEventListener(HELP_COMMAND_EVENT, onCmd);
  }, [user]);

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

  const attemptRef = useRef({ n: 0, timer: null });

  const answer = useCallback(async (yes) => {
    const r = prevRef.current;
    if (!r || answeringRef.current) return;
    answeringRef.current = true;
    helpConfirmBridge.clear();
    clearTimeout(attemptRef.current.timer);
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

  // Volunteer pressed "deed finished": ask by voice, then open the microphone (same listening
  // popup as a double tap) for "Da" / "Nu". Big Da / Nu buttons stay on screen as a backup.

  const stopAsking = useCallback(() => {
    clearTimeout(attemptRef.current.timer);
    attemptRef.current = { n: 0, timer: null };
  }, []);

  const askConfirmation = useCallback((r) => {
    const name = r.volunteerName || 'Voluntarul';
    stopAsking();
    setAsking(true);
    vibrate([200, 100, 200]);

    const ask = (text) => {
      if (!helpConfirmBridge.isAwaiting()) return;
      attemptRef.current.n += 1;
      clearTimeout(attemptRef.current.timer);
      say(text, {
        interrupt: true,
        onEnd: () => {
          if (!helpConfirmBridge.isAwaiting()) return; // answered by tap meanwhile
          requestVoiceListen('A fost rezolvat? Spune Da sau Nu');
          // Nothing heard: ask again, then fall back to the buttons
          attemptRef.current.timer = setTimeout(() => retry('Nu te-am auzit.'), CONFIRM_LISTEN_MS);
        },
      });
    };
    const retry = (why) => {
      if (!helpConfirmBridge.isAwaiting()) return;
      if (attemptRef.current.n >= CONFIRM_ATTEMPTS) {
        clearTimeout(attemptRef.current.timer);
        say(`${why} Când ești gata, apasă Da sau Nu pe ecran, sau atinge de două ori și spune Da sau Nu.`, { interrupt: true });
        return;
      }
      ask(`${why} ${name} a terminat de ajutat? Spune Da sau Nu.`);
    };

    // "Da" / "Nu" heard by the main assistant -> answer(); anything else -> ask again
    helpConfirmBridge.ask(answer, { onUnclear: () => retry('Nu am înțeles.') });
    ask(`${name} spune că te-a ajutat. A fost rezolvat? Spune Da sau Nu.`);
  }, [answer, stopAsking]);

  useEffect(() => stopAsking, [stopAsking]);

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

  // Voice: "am nevoie de ajutor", "anulează cererea", "unde e voluntarul"
  useEffect(() => {
    const onCmd = (e) => {
      const r = prevRef.current;
      switch (e.detail.type) {
        case 'call-volunteer':
          if (r) say(`Cererea ta e deja trimisă. ${describe(r)}`, { interrupt: true });
          else sendDistress();
          break;
        case 'cancel-help':
          if (r) cancel();
          else say('Nu ai nicio cerere de ajutor activă.', { interrupt: true });
          break;
        case 'help-status':
          say(r ? describe(r) : 'Nu ai nicio cerere de ajutor activă. Spune: am nevoie de ajutor.', { interrupt: true });
          break;
        case 'deed-finished':
        case 'accept-help':
        case 'release-help':
        case 'duty-on':
        case 'duty-off':
        case 'my-points':
          say('Comanda asta este pentru voluntari. Tu poți spune: am nevoie de ajutor.', { interrupt: true });
          break;
        default:
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
          style={{ ...launcherStyle(isMobile), background: P.danger, borderColor: P.danger, minWidth: isMobile ? 148 : 170 }}
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : <LifeBuoy size={20} />}
          <span>{busy ? 'Se trimite...' : 'Cer ajutor'}</span>
        </button>
      )}

      {(request || thanks || error) && (
        <div role="alert" aria-live="assertive" style={sheetStyle(isMobile, request?.status === 'AWAITING_CONFIRMATION' ? P.warning : P.danger)}>
          <div style={sheetHeader}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
              <LifeBuoy size={18} color={P.danger} />
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
              {request.status === 'ACCEPTED' && <Navigation size={18} color={P.success} style={{ flexShrink: 0 }} />}
              <span>{statusText}</span>
            </div>
          )}
          {request?.rejectedCount > 0 && request.status === 'ACCEPTED' && (
            <div style={{ fontSize: 12.5, color: P.slate600, marginTop: 6 }}>Ai spus că nu e gata încă; voluntarul continuă.</div>
          )}

          {asking && request?.status === 'AWAITING_CONFIRMATION' && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={() => answer(true)} style={{ ...bigBtn, background: P.success }} aria-label="Da, a fost rezolvat">
                <CheckCircle2 size={22} /> Da
              </button>
              <button type="button" onClick={() => answer(false)} style={{ ...bigBtn, background: P.slate600 }} aria-label="Nu, încă nu e rezolvat">
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
          {error && <div style={{ color: P.danger, fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Volunteer: on duty toggle, incoming requests, route to the client, Deed points
// ════════════════════════════════════════════════════════════════════════════


function VolunteerPanel({ userLocation, onNavigateTo, onClearRoute }) {
  const isMobile = useIsMobile();
  const { user, refreshUser } = useAuth();
  // Volunteers are on duty as soon as the app is open; "Ies din serviciu" only lasts until
  // the app is opened again
  const [onDuty, setOnDuty] = useState(true);
  const dutyAnnouncedRef = useRef(false);
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
      const msg = `Cerere de ajutor de la ${r.clientFirstName}, la ${spokenMeters(r.distanceMeters)}.${r.note ? ` Mesaj: ${r.note}.` : ''} Spune Accept sau apasă Ajut.`;
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

  const setDuty = (next) => {
    setOnDuty(next);
    if (next) {
      setOpen(true);
      // Asked from the tap, as browsers require; used for alerts while the app is in the background
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      say(hasLocation ? 'Ești în serviciu. Te anunț când cineva din apropiere are nevoie de ajutor.' : 'Ești în serviciu. Aștept semnalul GPS.', { interrupt: true });
    } else {
      say('Ai ieșit din serviciu. Nu mai primești cereri până redeschizi aplicația sau spui: intru în serviciu.', { interrupt: true });
    }
  };
  const toggleDuty = () => setDuty(!onDuty);

  // Tell the volunteer once per app start that they're receiving requests
  useEffect(() => {
    if (!hasLocation || !onDuty || dutyAnnouncedRef.current) return;
    dutyAnnouncedRef.current = true;
    say('Ești voluntar în serviciu. Te anunț când cineva din apropiere are nevoie de ajutor.');
  }, [hasLocation, onDuty]);

  // Background alerts need notification permission, which browsers only grant from a tap
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'default') return undefined;
    const ask = () => {
      Notification.requestPermission().catch(() => {});
      window.removeEventListener('pointerup', ask, true);
    };
    window.addEventListener('pointerup', ask, true);
    return () => window.removeEventListener('pointerup', ask, true);
  }, []);

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
      say(`L-am întrebat pe ${j.clientName} dacă a fost rezolvat. Primești punctele după confirmare.`, { interrupt: true });
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

  // Voice: "accept", "fapta e gata", "nu mai pot ajunge", "intru / ies din serviciu", "câte puncte am"
  useEffect(() => {
    const onCmd = (e) => {
      const current = jobRef.current;
      switch (e.detail.type) {
        case 'accept-help': {
          if (current) { say(`Ai deja o faptă în desfășurare, la ${current.clientName}.`, { interrupt: true }); break; }
          const first = (data?.nearby || [])[0];
          if (first) accept(first);
          else say(onDuty ? 'Nu e nicio cerere de ajutor aproape acum.' : 'Nu ești în serviciu. Spune: intru în serviciu.', { interrupt: true });
          break;
        }
        case 'deed-finished':
          if (current?.status === 'ACCEPTED') finish();
          else if (current) say('Așteptăm confirmarea persoanei.', { interrupt: true });
          else say('Nu ai nicio faptă în desfășurare.', { interrupt: true });
          break;
        case 'release-help':
          if (current?.status === 'ACCEPTED') release();
          else say('Nu ai nicio cerere preluată.', { interrupt: true });
          break;
        case 'duty-on':
          if (onDuty) say('Ești deja în serviciu.', { interrupt: true });
          else setDuty(true);
          break;
        case 'duty-off':
          if (current) say('Ai o faptă în desfășurare. Termin-o întâi sau spune: nu mai pot ajunge.', { interrupt: true });
          else if (onDuty) setDuty(false);
          else say('Nu ești în serviciu.', { interrupt: true });
          break;
        case 'my-points':
          say(`Ai ${points} de puncte de faptă bună, nivelul ${level || 'Începător'}, ${data?.deedsCompleted ?? user.deedsCompleted ?? 0} fapte confirmate.`, { interrupt: true });
          break;
        case 'help-status':
          if (current) say(current.status === 'ACCEPTED' ? `Mergi la ${current.clientName}${current.distanceMeters != null ? `, la ${spokenMeters(current.distanceMeters)}` : ''}.` : `Așteptăm confirmarea lui ${current.clientName}.`, { interrupt: true });
          else say(`${(data?.nearby || []).length ? `Sunt ${data.nearby.length} cereri aproape.` : 'Nicio cerere aproape.'}`, { interrupt: true });
          break;
        case 'call-volunteer':
          say('Contul tău este de voluntar. Pentru urgențe spune: sună la 112.', { interrupt: true });
          break;
        default:
      }
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
        style={{ ...launcherStyle(isMobile), background: onDuty ? P.success : P.white, color: onDuty ? P.white : P.ink, borderColor: onDuty ? P.success : P.slate300 }}
      >
        <HeartHandshake size={19} />
        <span>{points} pct</span>
        {(nearby.length > 0 || job) && <span style={badgeDot} aria-hidden="true" />}
      </button>

      {open && (
        <div style={sheetStyle(isMobile, job ? P.success : nearby.length ? P.danger : P.primary)} role="region" aria-label="Panou voluntar">
          <div style={sheetHeader}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
              <HeartHandshake size={18} color={P.success} /> Voluntar
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" aria-label="Clasament voluntari" style={iconBtn} onClick={openBoard}><Trophy size={16} /></button>
              <button type="button" aria-label="Închide panoul" style={iconBtn} onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
          </div>

          {/* Points and level */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Award size={30} color={P.warning} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{points} <span style={{ fontSize: 13, fontWeight: 600, color: P.slate600 }}>puncte de faptă bună</span></div>
              <div style={{ fontSize: 12.5, color: P.slate600 }}>
                {level}{data?.nextLevelAt ? ` · încă ${data.nextLevelAt - points} până la nivelul următor` : ''}
                {data ? ` · ${data.deedsCompleted} fapte` : ''}
              </div>
              {data?.nextLevelAt > 0 && (
                <div style={{ height: 6, borderRadius: 3, background: P.slate200, marginTop: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (points / data.nextLevelAt) * 100)}%`, background: P.warning }} />
                </div>
              )}
            </div>
          </div>

          {celebration && (
            <div style={{ background: P.successSoft, border: `1px solid ${P.success}`, borderRadius: 12, color: P.ink, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>+{celebration.pointsAwarded} puncte! {celebration.clientName} a confirmat.</div>
              {celebration.breakdown && (
                <div style={{ fontSize: 12.5, color: P.success, lineHeight: 1.5 }}>
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
              <div style={{ fontSize: 13, color: P.slate600, marginBottom: 10 }}>
                {job.distanceMeters != null && `${shortMeters(job.distanceMeters)} până la persoană`}
                {job.note && ` · „${job.note}”`}
              </div>
              {job.status === 'ACCEPTED' && (
                <>
                  <button type="button" onClick={finish} disabled={busy === 'finish'} style={{ ...bigBtn, background: P.success, width: '100%' }}>
                    {busy === 'finish' ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={22} />} Fapta e gata
                  </button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" style={{ ...smallBtn, flex: 1 }} onClick={() => routeTo(job)}><Navigation size={14} /> Arată ruta</button>
                    <button type="button" style={{ ...smallBtn, flex: 1 }} onClick={release} disabled={busy === 'release'}>Nu mai pot ajunge</button>
                  </div>
                </>
              )}
              {job.status === 'AWAITING_CONFIRMATION' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: P.warning }}>
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
                style={{ ...bigBtn, width: '100%', background: onDuty ? P.success : P.primary }}
              >
                <Power size={20} /> {onDuty ? 'În serviciu · apasă ca să ieși' : 'Intră în serviciu'}
              </button>
              {onDuty && !hasLocation && <div style={{ fontSize: 12.5, color: P.warning, marginTop: 8 }}>Aștept semnalul GPS...</div>}

              {onDuty && hasLocation && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: P.slate600, marginBottom: 6 }}>
                    {nearby.length ? <Bell size={14} color={P.danger} /> : <Users size={14} />}
                    {nearby.length ? 'Cereri de ajutor aproape de tine' : 'Nicio cerere aproape de tine acum.'}
                  </div>
                  {nearby.map((r) => (
                    <div key={r.id} style={requestCard}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>{r.clientFirstName} · {shortMeters(r.distanceMeters)}</div>
                        <div style={{ fontSize: 12, color: P.slate600 }}>
                          acum {Math.max(1, Math.round(r.ageSeconds / 60))} min{r.note ? ` · „${r.note}”` : ''}
                        </div>
                      </div>
                      <button type="button" onClick={() => accept(r)} disabled={Boolean(busy)} style={{ ...bigBtn, padding: '10px 14px', background: P.danger }}>
                        {busy === `accept-${r.id}` ? <Loader2 size={18} className="animate-spin" /> : 'Ajut'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <div style={{ color: P.danger, fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {board && (
        <div style={modalBackdrop} onClick={() => setBoard(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Clasamentul voluntarilor">
            <div style={sheetHeader}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><Trophy size={18} color={P.warning} /> Clasament voluntari</span>
              <button type="button" aria-label="Închide" style={iconBtn} onClick={() => setBoard(null)}><X size={16} /></button>
            </div>
            {board.loading && <Loader2 size={20} className="animate-spin" />}
            {board.error && <div style={{ color: P.danger }}>{board.error}</div>}
            {!board.loading && !board.rows.length && !board.error && <div style={{ color: P.slate600 }}>Încă nu are nimeni puncte. Fii primul!</div>}
            {board.rows.map((r) => (
              <div key={r.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${P.slate200}` }}>
                <span style={{ width: 24, fontWeight: 900, color: r.rank <= 3 ? P.warning : P.slate500 }}>{r.rank}</span>
                <span style={{ flex: 1, fontWeight: 700 }}>{r.name}<span style={{ display: 'block', fontSize: 11.5, color: P.slate500, fontWeight: 500 }}>{r.level} · {r.deedsCompleted} fapte</span></span>
                <span style={{ fontWeight: 900 }}>{r.deedPoints}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Styles (light cards, same look as the voice panel and planner) ────────────

const P = palette;

const launcherStyle = (isMobile) => ({
  position: 'fixed',
  top: isMobile ? 64 : 76,
  left: isMobile ? 12 : 20,
  zIndex: 1005,
  minHeight: 44,
  padding: '0 16px',
  borderRadius: radius.pill,
  border: '1px solid',
  color: P.white,
  fontSize: 14.5,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: 'pointer',
  boxShadow: shadow.md,
  fontFamily: 'inherit',
});

const sheetStyle = (isMobile, accent) => ({
  position: 'fixed',
  left: isMobile ? 12 : 20,
  right: isMobile ? 12 : 'auto',
  top: isMobile ? 118 : 130,
  width: isMobile ? 'auto' : 380,
  maxHeight: isMobile ? 'calc(100dvh - 140px)' : 'calc(100dvh - 160px)',
  overflowY: 'auto',
  zIndex: 1300, // above the full-screen camera (1200)
  background: P.white,
  color: P.ink,
  border: `1px solid ${P.slate200}`,
  borderTop: `4px solid ${accent}`,
  borderRadius: radius.lg,
  padding: 16,
  boxShadow: shadow.lg,
  fontFamily: 'inherit',
});

const sheetHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: 15, color: P.ink };
const iconBtn = { width: 36, height: 36, borderRadius: radius.sm, border: 'none', background: P.slate100, color: P.slate700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const bigBtn = { flex: 1, minHeight: 52, borderRadius: radius.md, border: 'none', color: P.white, fontSize: 16, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', padding: '0 16px', fontFamily: 'inherit' };
const smallBtn = { minHeight: 40, borderRadius: radius.sm, border: `1px solid ${P.slate300}`, background: P.white, color: P.slate700, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', padding: '0 12px', fontFamily: 'inherit' };
const requestCard = { display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, background: P.dangerSoft, border: `1px solid ${P.dangerSoftBorder}`, marginBottom: 8 };
const badgeDot = { width: 10, height: 10, borderRadius: '50%', background: P.danger, boxShadow: `0 0 0 3px rgba(${rgb.danger}, 0.25)` };
const modalBackdrop = { position: 'fixed', inset: 0, zIndex: 1400, background: `rgba(${rgb.ink}, 0.5)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const modalCard = { width: 'min(420px, 100%)', maxHeight: '80dvh', overflowY: 'auto', background: P.white, color: P.ink, borderRadius: radius.lg, padding: 16, border: `1px solid ${P.slate200}`, boxShadow: shadow.lg, fontFamily: 'inherit' };
