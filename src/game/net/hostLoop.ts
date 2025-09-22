import { LivePresence } from "../../firebase";

const TICK_MS = 1000 / 12;

export const startHostLoop = (ctx: {
  arenaId: string;
  isWriter: () => boolean;
  getLivePresence: () => LivePresence[];
  pullInputs: () => Promise<any[]>;
  stepSim: (dtMs: number, inputs: any[]) => void;
  writeState: () => Promise<void>;
}) => {
  let running = true,
    last = performance.now();

  const validate = (live: LivePresence[], e: any) => {
    const p = live.find((x) => x.id === e.presenceId);
    if (!p) return "presence-offline";
    if ((p.authUid || "") !== (e.authUid || "")) return "auth-mismatch";
    return null;
  };

  const tick = async () => {
    if (!running) return;
    if (!ctx.isWriter()) {
      requestAnimationFrame(tick);
      return;
    }
    const now = performance.now();
    const dt = now - last;
    if (dt < TICK_MS) {
      requestAnimationFrame(tick);
      return;
    }
    last = now;

    const live = ctx.getLivePresence();
    const inRaw = await ctx.pullInputs();
    const inputs = inRaw.filter((e) => {
      const r = validate(live, e);
      if (r) {
        console.info("[INPUT] rejected", { presenceId: e.presenceId, reason: r });
        return false;
      }
      return true;
    });

    ctx.stepSim(dt, inputs);
    await ctx.writeState();
    console.info("[STATE] wrote", { hz: 12 });
    requestAnimationFrame(tick);
  };

  console.info("[WRITER] start");
  requestAnimationFrame(tick);
  return () => {
    running = false;
    console.info("[WRITER] stop");
  };
};
