import type { ArenaPlayerState } from "../../firebase";

type AuthoritativePlayerState = Partial<ArenaPlayerState> & { updatedAt?: unknown };

type TimestampedSnapshot = {
  ts: number;
  state: AuthoritativePlayerState;
};

export interface SnapshotBufferOptions {
  /**
   * How far back in time (in milliseconds) we should try to sample the timeline.
   * A small delay gives the buffer time to collect the next authoritative state
   * before we attempt to interpolate between them.
   */
  interpolationDelayMs?: number;
}

export interface InterpolatedTransform {
  x: number;
  y: number;
  facing: "L" | "R";
  hp?: number;
  /** Linear interpolation factor between the previous and next snapshots. */
  lerpFactor: number;
  /** Whether the returned transform was actually interpolated between two states. */
  didLerp: boolean;
  from: TimestampedSnapshot;
  to: TimestampedSnapshot;
  /** The target moment in time that we sampled during interpolation. */
  targetTime: number;
}

export interface SnapshotBuffer {
  ingest(playerId: string, state: AuthoritativePlayerState): void;
  interpolate(playerId: string, now: number): InterpolatedTransform | undefined;
  clear(playerId?: string): void;
  setBypass(playerId: string, bypass: boolean): void;
}

const DEFAULT_DELAY_MS = 100;

export function createSnapshotBuffer(options?: SnapshotBufferOptions): SnapshotBuffer {
  const snapshots = new Map<string, TimestampedSnapshot[]>();
  const bypass = new Set<string>();
  const interpolationDelayMs = options?.interpolationDelayMs ?? DEFAULT_DELAY_MS;

  const recordSnapshot = (playerId: string, snap: TimestampedSnapshot) => {
    const list = snapshots.get(playerId) ?? [];
    list.push(snap);
    list.sort((a, b) => a.ts - b.ts);
    while (list.length > 2) {
      list.shift();
    }
    snapshots.set(playerId, list);
  };

  return {
    ingest(playerId, state) {
      const ts = toMillis(state.updatedAt) ?? Date.now();
      recordSnapshot(playerId, { ts, state });
    },

    interpolate(playerId, now) {
      const list = snapshots.get(playerId);
      if (!list || list.length === 0) return undefined;

      const latest = list[list.length - 1];
      if (list.length === 1 || bypass.has(playerId)) {
        return buildTransform(latest, latest, latest, now, 1, false);
      }

      const previous = list[list.length - 2] ?? latest;
      const targetTime = now - interpolationDelayMs;

      if (targetTime <= previous.ts || latest.ts <= previous.ts) {
        // Not enough temporal distance to interpolate; fall back to whichever snapshot makes sense.
        const base = targetTime <= previous.ts ? previous : latest;
        const didLerp = false;
        const lerpFactor = base === latest ? 1 : 0;
        return buildTransform(base, previous, latest, targetTime, lerpFactor, didLerp);
      }

      if (targetTime >= latest.ts) {
        return buildTransform(latest, previous, latest, targetTime, 1, false);
      }

      const span = latest.ts - previous.ts;
      if (span <= 0) {
        return buildTransform(latest, previous, latest, targetTime, 1, false);
      }

      const lerpFactor = clamp((targetTime - previous.ts) / span, 0, 1);
      const x = lerp(resolveNumber(previous.state.x, latest.state.x), resolveNumber(latest.state.x, previous.state.x), lerpFactor);
      const y = lerp(resolveNumber(previous.state.y, latest.state.y), resolveNumber(latest.state.y, previous.state.y), lerpFactor);
      const facing = chooseFacing(previous.state.facing, latest.state.facing, lerpFactor);
      const hp = resolveOptionalNumber(previous.state.hp, latest.state.hp);

      return {
        x,
        y,
        facing,
        hp,
        lerpFactor,
        didLerp: true,
        from: previous,
        to: latest,
        targetTime,
      };
    },

    clear(playerId) {
      if (typeof playerId === "string") {
        snapshots.delete(playerId);
        return;
      }
      snapshots.clear();
    },

    setBypass(playerId, shouldBypass) {
      if (shouldBypass) {
        bypass.add(playerId);
      } else {
        bypass.delete(playerId);
      }
    },
  };
}

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === "object" && value) {
    const maybeMillis = (value as { toMillis?: () => number }).toMillis?.();
    if (typeof maybeMillis === "number") {
      return maybeMillis;
    }
    const asDate = (value as { toDate?: () => Date }).toDate?.();
    if (asDate instanceof Date && !Number.isNaN(asDate.valueOf())) {
      return asDate.valueOf();
    }
    const seconds = (value as { seconds?: number }).seconds;
    const nanoseconds = (value as { nanoseconds?: number }).nanoseconds;
    if (typeof seconds === "number") {
      const base = seconds * 1000;
      if (typeof nanoseconds === "number") {
        return base + nanoseconds / 1_000_000;
      }
      return base;
    }
  }
  return undefined;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function resolveNumber(primary: unknown, fallback: unknown) {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return primary;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return 0;
}

function resolveOptionalNumber(previous: unknown, next: unknown): number | undefined {
  if (typeof next === "number" && Number.isFinite(next)) {
    return next;
  }
  if (typeof previous === "number" && Number.isFinite(previous)) {
    return previous;
  }
  return undefined;
}

function chooseFacing(previous: unknown, next: unknown, lerpFactor: number): "L" | "R" {
  const prevFacing = previous === "L" ? "L" : previous === "R" ? "R" : undefined;
  const nextFacing = next === "L" ? "L" : next === "R" ? "R" : undefined;
  if (!prevFacing && !nextFacing) {
    return "R";
  }
  if (!prevFacing) {
    return nextFacing ?? "R";
  }
  if (!nextFacing) {
    return prevFacing;
  }
  return lerpFactor >= 0.5 ? nextFacing : prevFacing;
}

function buildTransform(
  base: TimestampedSnapshot,
  from: TimestampedSnapshot,
  to: TimestampedSnapshot,
  targetTime: number,
  lerpFactor: number,
  didLerp: boolean,
): InterpolatedTransform {
  const x = resolveNumber(base.state.x, to.state.x);
  const y = resolveNumber(base.state.y, to.state.y);
  const facing = chooseFacing(base.state.facing, to.state.facing, lerpFactor);
  const hp = resolveOptionalNumber(from.state.hp, to.state.hp);
  return {
    x,
    y,
    facing,
    hp,
    lerpFactor,
    didLerp,
    from,
    to,
    targetTime,
  };
}
