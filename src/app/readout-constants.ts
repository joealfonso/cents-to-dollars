// Display constants for the Voice analysis hero (DESIGN.md 2.9). Each one is a display choice, not a
// validated measurement setting. Change them here only.

/** Cents either side of the nearest note that read as "WITHIN". Display choice, not validated.
 *  NEEDS THE OWNER'S NUMBER (DESIGN.md OPEN 2): 10 c is a placeholder until she gives hers. */
export const TOLERANCE_CENTS = 10;

/** After the last voiced frame, the note stays at full strength this long, then dims with "Last:" and the
 *  status chip reads "No pitch". Display choice, not validated; tune with her (OPEN 3). */
export const HOLD_FULL_MS = 1000;

/** The "I can't hear you" hint shows once the input level has stayed below DEFAULT_YIN.silenceDb this long.
 *  Display choice, not validated; tune with her (OPEN 3). */
export const GATE_HINT_MS = 1000;
