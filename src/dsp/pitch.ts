// Pitch units. Definitions in MEASUREMENT.md section 2.
// Reference pitch is a parameter everywhere; 440 Hz is only the default until she confirms 440 or 442.

export const DEFAULT_A4 = 440;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Cents of f above A4 = a4 (absolute scale used for contours and vibrato). */
export function centsFromA4(f: number, a4 = DEFAULT_A4): number {
  return 1200 * Math.log2(f / a4);
}

/** Cents between two frequencies, positive when f is above ref. */
export function centsBetween(f: number, ref: number): number {
  return 1200 * Math.log2(f / ref);
}

export interface NoteReading {
  midi: number;
  name: string; // scientific pitch notation, A4 = MIDI 69
  targetHz: number;
  cents: number; // deviation from the nearest 12-TET note, in [-50, +50)
}

export function nearestNote(f: number, a4 = DEFAULT_A4): NoteReading {
  const semis = 12 * Math.log2(f / a4);
  let n = Math.round(semis);
  let cents = 100 * (semis - n);
  if (cents >= 50) { n += 1; cents -= 100; } // keep the half-open interval [-50, +50)
  const midi = 69 + n;
  const targetHz = a4 * Math.pow(2, n / 12);
  const name = `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return { midi, name, targetHz, cents };
}
