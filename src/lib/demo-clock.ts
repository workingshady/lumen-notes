// Demo mode pins the clock to the design's moment (Fri 13 Nov 2026, 21:41 local) so relative labels
// ("12m ago", "Yesterday", "37 days left") match the Claude Design screens exactly. Time still advances.
// Imported first in main.tsx; real mode is untouched.
//
// Dev simulator "time travel": localStorage "lumen.sim.clock" holds a different pinned moment (epoch ms).
// Changing it reloads the page so every derived label/due date is recomputed from the new "now".
const on = (() => { try { return localStorage.getItem("lumen.demo") === "1"; } catch { return false; } })();
const CLOCK_KEY = "lumen.sim.clock";
const RealDate = Date;
/** The design moment every demo session starts from (unless time-travelled). */
export const DESIGN_NOW = new RealDate(2026, 10, 13, 21, 41, 0).getTime();
const pinned = (() => { try { const v = Number(localStorage.getItem(CLOCK_KEY)); return v > 0 ? v : DESIGN_NOW; } catch { return DESIGN_NOW; } })();

if (on) {
  const offset = pinned - RealDate.now();
  const now = () => RealDate.now() + offset;
  class DemoDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(now());
      else super(...(args as [string | number | Date]));
    }
    static now() { return now(); }
  }
  (globalThis as { Date: DateConstructor }).Date = DemoDate as unknown as DateConstructor;
}

/** True when the demo clock is moved away from the design moment. */
export const clockShifted = () => pinned !== DESIGN_NOW;
/** Pin the demo clock to `t` (epoch ms) and reload; null = back to the design moment. */
export function setDemoClock(t: number | null) {
  try { t === null ? localStorage.removeItem(CLOCK_KEY) : localStorage.setItem(CLOCK_KEY, String(Math.round(t))); } catch { /* ignore */ }
  location.reload();
}
/** Move the demo clock forward/back by `ms` from the current simulated now. */
export const shiftDemoClock = (ms: number) => setDemoClock(Date.now() + ms);
