// Setup rows with the data-field convention (DESIGN.md 7.3, 7.5). Each row is
// <div class="kv" data-field="{name}"> with .kv-dot, .kv-label, .kv-value and an optional .kv-action.
// setField updates every row with that name, so Overview and Tools can show the same field.
// Phase A fills only the fields that need no microphone.

import { DEFAULT_A4 } from '../dsp/pitch.ts';

export type FieldName = 'mic-permission' | 'browser-audio' | 'secure' | 'a4' | 'calibration' | 'latency' | 'selftest';
/** ok: passed or available. idle: not run, not asked or not known. error: blocking. info: a setting, no status. */
export type FieldStatus = 'ok' | 'idle' | 'error' | 'info';

export interface FieldUpdate {
  status: FieldStatus;
  value: string;
  action?: { label: string; href: string } | null;
}

export const FIELD_LABELS: Record<FieldName, string> = {
  'mic-permission': 'Microphone permission',
  'browser-audio': 'Browser audio',
  secure: 'Secure page',
  a4: 'Reference pitch (A4)',
  calibration: 'Calibration',
  latency: 'Loopback latency',
  selftest: 'Self-test',
};

const last = new Map<FieldName, FieldUpdate>();

/** Markup for one row, to go inside a <dl class="kv-list">. The value says "Checking…" until setField fills it. */
export function fieldRow(name: FieldName): string {
  return `<div class="kv" data-field="${name}" data-status="idle">
    <dt class="kv-label">${FIELD_LABELS[name]}</dt>
    <dd class="kv-body"><span class="kv-dot" aria-hidden="true"></span><span class="kv-value">Checking…</span><span class="kv-action"></span></dd>
  </div>`;
}

export function setField(name: FieldName, u: FieldUpdate): void {
  last.set(name, u);
  for (const row of document.querySelectorAll<HTMLElement>(`[data-field="${name}"]`)) paint(row, u);
}

function paint(row: HTMLElement, u: FieldUpdate) {
  row.dataset.status = u.status;
  const value = row.querySelector<HTMLElement>('.kv-value');
  if (value && value.textContent !== u.value) value.textContent = u.value;
  const action = row.querySelector<HTMLElement>('.kv-action');
  if (!action) return;
  if (!u.action) { action.replaceChildren(); return; }
  const a = document.createElement('a');
  a.href = u.action.href;
  a.className = 'link';
  a.textContent = u.action.label;
  action.replaceChildren(a);
}

/** Re-applies the last known values to rows rendered after the update (for example a view rendered later). */
export function repaintFields(root: ParentNode = document): void {
  for (const row of root.querySelectorAll<HTMLElement>('[data-field]')) {
    const u = last.get(row.dataset.field as FieldName);
    if (u) paint(row, u);
  }
}

// ---------------------------------------------------------------- the checks that need no microphone

const A4_KEY = 'centstodollars.a4';

/** The saved A4 if it is in range (400 to 480 Hz), else DEFAULT_A4. Phase B writes the key. */
export function savedA4(): number {
  try {
    const raw = localStorage.getItem(A4_KEY);
    const v = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return v >= 400 && v <= 480 ? v : DEFAULT_A4;
  } catch {
    return DEFAULT_A4;
  }
}

function micPermissionUpdate(state: PermissionState): FieldUpdate {
  if (state === 'granted') return { status: 'ok', value: 'Allowed' };
  if (state === 'denied') return { status: 'error', value: 'Blocked. Allow it in the browser’s site settings.' };
  return { status: 'idle', value: 'Not asked yet' };
}

let started = false;

/** Fills every no-mic field once and keeps the permission row current. Safe to call more than once. */
export function runPassiveChecks(): void {
  if (started) return;
  started = true;

  const secure = window.isSecureContext;
  setField('secure', secure
    ? { status: 'ok', value: 'Yes' }
    : { status: 'error', value: 'No. The microphone needs http://127.0.0.1:5173.' });

  const worklet = typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype;
  setField('browser-audio', worklet
    ? { status: 'ok', value: 'Available' }
    : { status: 'error', value: 'Not available in this browser' });

  setField('a4', { status: 'info', value: `${savedA4()} Hz` });

  // Results from the checks live in memory for this visit only. Phase C fills them from checks.ts.
  const notRun: FieldUpdate = { status: 'idle', value: 'Not run this visit', action: { label: 'Setup checks', href: '#/methods' } };
  setField('calibration', notRun);
  setField('latency', notRun);
  setField('selftest', notRun);

  const notReported: FieldUpdate = { status: 'idle', value: 'Not reported by this browser' };
  setField('mic-permission', { status: 'idle', value: 'Checking…' });
  if (!navigator.permissions?.query) { setField('mic-permission', notReported); return; }
  navigator.permissions
    .query({ name: 'microphone' as PermissionName })
    .then((status) => {
      setField('mic-permission', micPermissionUpdate(status.state));
      status.addEventListener('change', () => setField('mic-permission', micPermissionUpdate(status.state)));
    })
    .catch(() => setField('mic-permission', notReported));
}
