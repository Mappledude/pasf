import { describe, expect, it } from "vitest";
import { startHostLoop } from "./hostLoop";
import type { LivePresence } from "../../lib/presence";
import type { ArenaInputSnapshot } from "../../firebase";

const { beforeEach, afterEach, vi } = globalThis as any;

// Keep real mocks so we can call .mockClear() and inspect calls.
const infoMock = vi.fn();
const errorMock = vi.fn();
const logger = { info: infoMock, error: errorMock } as unknown as typeof console;

let presenceCallback: ((entries: LivePresence[]) => void) | undefined;
let inputsCallback: ((snapshots: ArenaInputSnapshot[]) => void) | undefined;

const writeArenaStateMock = vi.fn(async () => {
  /* no-op */
});

vi.mock("../../firebase", () => ({
  db: {} as unknown,
  watchArenaInputs: vi.fn(
    (_arenaId: string, cb: (snapshots: ArenaInputSnapshot[]) => void) => {
      inputsCallback = cb;
      return () => undefined;
    },
  ),
  writeArenaState: (...args: Parameters<typeof writeArenaStateMock>) =>
    writeArenaStateMock(...args),
}));

vi.mock("../../lib/presence", () => ({
  watchArenaPresence: vi.fn((_arenaId: string, cb: (entries: LivePresence[]) => void) => {
    presenceCallback = cb;
    return () => undefined;
  }),
}));

describe("startHostLoop combat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    writeArenaStateMock.mockClear();
    infoMock.mockClear();
    errorMock.mockClear();
    presenceCallback = undefined;
    inputsCallback = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies damage when an attack lands", async () => {
    const controller = startHostLoop({
      arenaId: "arena-1",
      writerAuthUid: "p1",
      writerPresenceId: "p1",
      log: logger as any,
    });
    try {
      // Avoid toBeDefined typing issues; assert via boolean
      expect(Boolean(presenceCallback)).toBe(true);
      expect(Boolean(inputsCallback)).toBe(true);

      const nowIso = new Date().toISOString();
      presenceCallback?.([
        {
          id: "p1",
          presenceId: "p1",
          authUid: "p1",
          lastSeen: nowIso,
        } as unknown as LivePresence,
        {
          id: "p2",
          presenceId: "p2",
          authUid: "p2",
          lastSeen: nowIso,
        } as unknown as LivePresence,
      ]);

      const commands: Record<string, ArenaInputSnapshot> = {
        p1: {
          playerId: "p1",
          presenceId: "p1",
          authUid: "p1",
          right: false,
          left: false,
          jump: false,
          attack: false,
          attackSeq: 0,
        } as unknown as ArenaInputSnapshot,
        p2: {
          playerId: "p2",
          presenceId: "p2",
          authUid: "p2",
          right: false,
          left: false,
          jump: false,
          attack: false,
          attackSeq: 0,
        } as unknown as ArenaInputSnapshot,
      };

      const pushInputs = () => {
        inputsCallback?.([commands.p1, commands.p2]);
      };

      pushInputs();
      await vi.advanceTimersByTimeAsync(100);

      commands.p1.right = true as any;
      commands.p2.left = true as any;
      pushInputs();
      await vi.advanceTimersByTimeAsync(1_100);

      commands.p1.right = false as any;
      commands.p2.left = false as any;
      pushInputs();
      await vi.advanceTimersByTimeAsync(100);

      commands.p1.attack = true as any;
      commands.p1.attackSeq = ((commands.p1.attackSeq as number) ?? 0) + 1;
      pushInputs();
      await vi.advanceTimersByTimeAsync(400);

      commands.p1.attack = false as any;
      pushInputs();

      const hpValues = writeArenaStateMock.mock.calls
        .map((args: unknown[]) => (args[1] as any)?.entities?.p2?.hp as unknown)
        .filter((value: unknown): value is number => typeof value === "number");

      expect(hpValues.some((hp: number) => hp < 100)).toBe(true);
      expect((hpValues[hpValues.length - 1] ?? 100) <= 90).toBe(true);

      const hitLogged = infoMock.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes("[HIT]"),
      );
      expect(hitLogged).toBe(true);
    } finally {
      controller.stop();
    }
  });
});
