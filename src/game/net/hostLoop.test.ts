import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHostLoop } from "./hostLoop";
import type { ArenaPresenceEntry } from "../../types/models";
import type { ArenaInputSnapshot } from "../../firebase";

const logger = { info: vi.fn(), error: vi.fn() } as Pick<typeof console, "info" | "error">;

let presenceCallback: ((entries: ArenaPresenceEntry[]) => void) | undefined;
let inputsCallback: ((snapshots: ArenaInputSnapshot[]) => void) | undefined;

const writeArenaStateMock = vi.fn(async () => {
  /* no-op */
});

vi.mock("../../firebase", () => ({
  watchArenaPresence: vi.fn((_arenaId: string, cb: typeof presenceCallback) => {
    presenceCallback = cb as typeof presenceCallback;
    return () => undefined;
  }),
  watchArenaInputs: vi.fn((_arenaId: string, cb: typeof inputsCallback) => {
    inputsCallback = cb as typeof inputsCallback;
    return () => undefined;
  }),
  writeArenaState: (...args: Parameters<typeof writeArenaStateMock>) => writeArenaStateMock(...args),
}));

describe("startHostLoop combat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    writeArenaStateMock.mockClear();
    logger.info.mockClear();
    logger.error.mockClear();
    presenceCallback = undefined;
    inputsCallback = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies damage when an attack lands", async () => {
    const controller = startHostLoop({ arenaId: "arena-1", writerUid: "host", log: logger });
    try {
      expect(presenceCallback).toBeDefined();
      expect(inputsCallback).toBeDefined();

      const nowIso = new Date().toISOString();
      presenceCallback?.([
        { playerId: "p1", authUid: "p1", codename: "Alpha", lastSeen: nowIso } as ArenaPresenceEntry,
        { playerId: "p2", authUid: "p2", codename: "Beta", lastSeen: nowIso } as ArenaPresenceEntry,
      ]);

      const commands: Record<string, ArenaInputSnapshot> = {
        p1: { playerId: "p1", right: false, left: false, jump: false, attack: false, attackSeq: 0 },
        p2: { playerId: "p2", right: false, left: false, jump: false, attack: false, attackSeq: 0 },
      };

      const pushInputs = () => {
        inputsCallback?.([commands.p1, commands.p2]);
      };

      pushInputs();
      await vi.advanceTimersByTimeAsync(100);

      commands.p1.right = true;
      commands.p2.left = true;
      pushInputs();
      await vi.advanceTimersByTimeAsync(1_100);

      commands.p1.right = false;
      commands.p2.left = false;
      pushInputs();
      await vi.advanceTimersByTimeAsync(100);

      commands.p1.attack = true;
      commands.p1.attackSeq = (commands.p1.attackSeq ?? 0) + 1;
      pushInputs();
      await vi.advanceTimersByTimeAsync(400);

      commands.p1.attack = false;
      pushInputs();

      const hpValues = writeArenaStateMock.mock.calls
        .map(([, snapshot]) => snapshot.entities?.p2?.hp)
        .filter((value): value is number => typeof value === "number");

      expect(hpValues.some((hp) => hp < 100)).toBe(true);
      expect(hpValues[hpValues.length - 1]).toBeLessThanOrEqual(90);

      const hitLogged = logger.info.mock.calls.some((call) => String(call[0]).includes("[HIT]"));
      expect(hitLogged).toBe(true);
    } finally {
      controller.stop();
    }
  });
});
