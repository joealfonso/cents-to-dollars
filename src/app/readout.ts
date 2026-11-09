// Pure readout logic for the Voice analysis hero (DESIGN.md 2.9). No DOM, so Node tests can import it.
// Times are frame-clock seconds (WorkletFrame.t); the constants they are compared with are in ms.

export const MINUS = '−';
export const SHARP_GLYPH = '♯';

/** Float slack for the frame-clock comparisons, in ms, so 1.0 s after a frame counts as 1000 ms. */
export const EPS_MS = 1e-6;

/** Fixed decimals, signed with a real minus sign. Zero after rounding has no sign, so -0.04 at 1 decimal is "0.0". */
export function signedFixed(x: number, d: number): string {
  const s = x.toFixed(d);
  if (Number(s) === 0) return (0).toFixed(d);
  return x < 0 ? `${MINUS}${s.slice(1)}` : `+${s}`;
}

/** The cents chip: the deviation rounded to an integer, "+12", "−13", and "0" (never "-0" or "−0"). */
export function centsLabel(cents: number): string {
  const r = Math.round(cents) || 0;
  return r === 0 ? '0' : r < 0 ? `${MINUS}${-r}` : `+${r}`;
}

/** "A#4" to "A♯4". */
export function noteGlyph(name: string): string {
  return name.replace('#', SHARP_GLYPH);
}

/** "A#4" to its parts: letter "A", accidental "♯" (or ""), octave "4", and the spoken name "A sharp 4". */
export function splitNote(name: string): { letter: string; acc: string; oct: string; spoken: string } {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name);
  if (!m) return { letter: name, acc: '', oct: '', spoken: name };
  return { letter: m[1], acc: m[2] ? SHARP_GLYPH : '', oct: m[3], spoken: `${m[1]}${m[2] ? ' sharp' : ''} ${m[3]}` };
}

export type Direction = 'FLAT' | 'SHARP' | 'WITHIN';

/** The cue. Uses the same rounded integer the chip shows, so the cue never disagrees with the number:
 *  |rounded| <= tolerance is WITHIN (the edge counts as within), below is FLAT, above is SHARP. */
export function directionFor(cents: number, tolerance: number): Direction {
  const r = Math.round(cents) || 0;
  if (Math.abs(r) <= tolerance) return 'WITHIN';
  return r < 0 ? 'FLAT' : 'SHARP';
}

/** True once `holdMs` have passed on the frame clock since the last voiced frame: the note dims, gets
 *  "Last:", and the chip reads "No pitch". False when there is no voiced frame or no newer frame. */
export function holdExpired(nowT: number | null, lastVoicedT: number | null, holdMs: number): boolean {
  if (nowT === null || lastVoicedT === null) return false;
  return (nowT - lastVoicedT) * 1000 >= holdMs - EPS_MS;
}

/** True once the level has stayed below the gate for `gateMs` on the frame clock. `belowSinceT` is the time of
 *  the first frame of the current run below the gate, or null when the newest frame is at or above it. */
export function gateHintDue(nowT: number | null, belowSinceT: number | null, gateMs: number): boolean {
  if (nowT === null || belowSinceT === null) return false;
  return (nowT - belowSinceT) * 1000 >= gateMs - EPS_MS;
}

/** What the screen reader last heard about the pitch. */
export interface Announced { note: string; targetHz: number; dir: Direction }

/** Extra cents beyond a boundary before a change is announced, so vibrato around 0, the tolerance edge or
 *  the ±50 c note boundary does not re-announce every second. Display choice, not validated. */
export const ANNOUNCE_HYSTERESIS_CENTS = 5;

/** A change that passes shouldAnnounce must hold this long on the frame clock before it is announced, so a
 *  vibrato that straddles a boundary (half a cycle is under 170 ms at 3 Hz or faster) never re-announces.
 *  Display choice, not validated. */
export const ANNOUNCE_STABLE_MS = 250;

/** True once a pending change (first seen at `sinceT`) has held for `stableMs` on the frame clock. */
export function stableFor(nowT: number, sinceT: number | null, stableMs = ANNOUNCE_STABLE_MS): boolean {
  if (sinceT === null) return false;
  return (nowT - sinceT) * 1000 >= stableMs - EPS_MS;
}

/**
 * Whether a new pitch reading should be announced, given what was announced last. Announces:
 * - the first reading;
 * - a new note, only once f0 is more than 50 + hysteresis cents from the last announced note's target
 *   (so crossing ±50 c and back does not flip the announced note);
 * - a new direction, only once the rounded deviation is beyond the tolerance by the hysteresis
 *   (into FLAT or SHARP) or inside it by the hysteresis (into WITHIN). FLAT to SHARP or back is announced
 *   when the new side is reached past the same margin.
 * The caller still throttles announcements in time.
 */
export function shouldAnnounce(
  last: Announced | null,
  next: { note: string; cents: number; f0: number },
  tolerance: number,
  hysteresis = ANNOUNCE_HYSTERESIS_CENTS,
): boolean {
  if (!last) return true;
  if (next.note !== last.note) {
    const fromLast = 1200 * Math.log2(next.f0 / last.targetHz);
    return Math.abs(fromLast) > 50 + hysteresis;
  }
  const dir = directionFor(next.cents, tolerance);
  if (dir === last.dir) return false;
  const r = Math.abs(Math.round(next.cents) || 0);
  return dir === 'WITHIN' ? r <= tolerance - hysteresis : r > tolerance + hysteresis;
}
