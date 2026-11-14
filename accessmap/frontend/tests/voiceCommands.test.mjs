import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('../src/utils/voiceCommands.js', import.meta.url))], bundle: true, format: 'esm', outfile: fileURLToPath(new URL('./.voiceCommands.out.mjs', import.meta.url)), logLevel: 'error' });
const { parseVoiceCommand, pickBestCommand } = await import('./.voiceCommands.out.mjs');
const cases = [
  // [heard, expected type, expected query (destination), expected near]
  ['Du-mă la Kaufland', 'destination', 'Kaufland'],
  ['du mă la Kaufland', 'destination', 'Kaufland'],
  ['Dumă la Kaufland', 'destination', 'Kaufland'],
  ['du-mi la Kaufland', 'destination', 'Kaufland'],
  ['Du-mă la Cofland', 'destination', 'Kaufland'],
  ['du-mă la kauflandul cel mai apropiat', 'destination', 'Kaufland'],
  ['Du-mă la Kaufland-ul de pe Gheorghe Lazăr', 'destination', 'Kaufland', 'Gheorghe Lazar'],
  ['Du-mă la Kaufland te rog.', 'destination', 'Kaufland'],
  ['vreau să merg la Lidl', 'destination', 'Lidl'],
  ['vreau la carfur', 'destination', 'Carrefour'],
  ['aș vrea să ajung la Iulius Mall', 'destination', 'Iulius Town'],
  ['cum ajung la Gara de Nord', 'destination', 'Gara De Nord'],
  ['unde e cel mai apropiat Lidl', 'destination', 'Lidl'],
  ['arată-mi drumul spre Piața Unirii', 'destination', 'Piata Unirii'],
  ['du-mă la spitalul de urgență', 'destination', 'Spitalul De Urgenta'],
  ['du-mă pe Șoseaua Sagului', 'destination', 'Soseaua Sagului'],
  ['du-mă pe Strada Iuliu Maniu 12', 'destination', 'Strada Iuliu Maniu 12'],
  ['du-mă până la Universitatea de Vest din Timișoara', 'destination', 'Universitatea De Vest', 'Timisoara'],
  ['Kaufland', 'destination', 'Kaufland'],
  ['take me to the nearest Kaufland', 'destination', 'Kaufland'],
  ['navigate to McDonalds', 'destination', 'McDonalds'],
  ['deschide camera', 'camera-open'],
  ['închide camera', 'camera-close'],
  ['anulează ruta', 'cancel-route'],
  ['cât mai am', 'status'],
  ['pe unde o iau', 'start-navigation'],
  ['cheamă un voluntar', 'call-volunteer'],
  ['Am nevoie de ajutor', 'call-volunteer'],
  ['am nevoie de ajutor te rog', 'call-volunteer'],
  ['ajută-mă', 'call-volunteer'],
  ['vreau ajutor', 'call-volunteer'],
  ['trimite pe cineva', 'call-volunteer'],
  ['ajută-mă să ajung la Kaufland', 'destination', 'Kaufland'],
  ['anulează cererea', 'cancel-help'],
  ['nu mai am nevoie de ajutor', 'cancel-help'],
  ['unde e voluntarul', 'help-status'],
  ['fapta e gata', 'deed-finished'],
  ['am terminat', 'deed-finished'],
  ['accept', 'accept-help'],
  ['ajut eu', 'accept-help'],
  ['nu mai pot ajunge', 'release-help'],
  ['ies din serviciu', 'duty-off'],
  ['intru în serviciu', 'duty-on'],
  ['câte puncte am', 'my-points'],
  ['ajutor', 'emergency'],
  ['sună la 112', 'emergency'],
  ['urgență', 'emergency'],
  ['', 'unknown'],
  ['eee', 'unknown'],
  ['hmm', 'unknown'],
  ['mmmm', 'unknown'],
];
let fail = 0;
for (const [heard, type, query, near] of cases) {
  const r = parseVoiceCommand(heard);
  const ok = r.type === type && (!query || r.destination?.query === query) && (near === undefined || r.destination?.near === near);
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(heard).padEnd(52), '->', r.type, r.destination ? `"${r.destination.query}"${r.destination.near ? ` near "${r.destination.near}"` : ''}` : '');
}
// Alternatives: recognizer's first guess is wrong, a later one names the store
// Context: a logged-in client saying just "ajutor" gets a volunteer, not 112
const clientHelp = parseVoiceCommand('Ajutor!', { isClient: true });
const chOk = clientHelp.type === 'call-volunteer';
if (!chOk) fail++;
console.log(chOk ? 'ok  ' : 'FAIL', '"Ajutor!" as a client ->', clientHelp.type);
const urgent = parseVoiceCommand('sună la 112', { isClient: true });
const urOk = urgent.type === 'emergency';
if (!urOk) fail++;
console.log(urOk ? 'ok  ' : 'FAIL', '"sună la 112" as a client ->', urgent.type);
// While the app waits for "a fost rezolvat?": da / nu
for (const [said, want] of [['Da', 'confirm-yes'], ['da, a fost rezolvat', 'confirm-yes'], ['Nu', 'confirm-no'], ['nu încă', 'confirm-no']]) {
  const r = parseVoiceCommand(said, { awaitingConfirmation: true });
  if (r.type !== want) fail++;
  console.log(r.type === want ? 'ok  ' : 'FAIL', `"${said}" while awaiting confirmation ->`, r.type);
}

const alt = pickBestCommand(['du mă la cauza', 'du-mă la Kaufland', 'du-mă la cafea']);
const altOk = alt.type === 'destination' && alt.destination.query === 'Kaufland';
if (!altOk) fail++;
console.log(altOk ? 'ok  ' : 'FAIL', 'pickBestCommand prefers the alternative that names a known store ->', alt.destination?.query);
console.log(fail ? `\n${fail} FAILED` : `\nall ${cases.length + 7} passed`);

process.exit(fail ? 1 : 0);
