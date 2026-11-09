// Self-test criteria, one source (DESIGN.md 7.4): THRESH in py/score.py, written to results/summary.json under
// `thresholds`. A Vite named JSON import, so only that key ships. Checked at load: if any expected key is not a
// finite number, THRESHOLDS is null and the self-test shows "Could not run" with no verdicts.
// There is no second copy of the numbers. The latency row has no threshold.

import { thresholds } from '../../results/summary.json';
import { validateThresholds, type Thresholds } from './checks.ts';

export const THRESHOLDS: Thresholds | null = validateThresholds(thresholds);
