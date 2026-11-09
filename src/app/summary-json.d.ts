// results/summary.json, read only for its `thresholds` key (src/app/criteria.ts). Typed unknown on purpose:
// criteria.ts checks every value at load.
declare module '*/results/summary.json' {
  export const thresholds: unknown;
}
