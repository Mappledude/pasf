// @ts-nocheck
import { describe, expect, it } from "vitest";
import { startHostLoop } from "./hostLoop";
import type { LivePresence } from "../../firebase";

const { beforeEach, afterEach, vi } = globalThis as any;

const infoMock = vi.fn();
const errorMock = vi.fn();

describe("startHostLoop", () => {
  let originalRaf: typeof requestAnimationFrame | undefined;
  let rafCallback: FrameRequestCallback | undefined;
  let currentNow = 0;

  const runNextFrame = async () => {
    expect(rafCallback).toBeTypeOf("function");
    const cb = rafCallback!;
    rafCallback = undefined;
    await cb(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    infoMock.mockClear();
    errorMock.mockClear();
    originalRaf = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 0;
    };
    currentNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => currentNow);
    vi.spyOn(console, "info").mockImplementation(infoMock);
    vi.spyOn(console, "error").mockImplementation(errorMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalRaf) {
      (globalThis as any).requestAnimationFrame = originalRaf;
    } else {
      delete (globalThis as any).requestAnimationFrame;
    }
    rafCallback = undefined;
  });

  it("filters invalid inputs and writes state for valid ones", async () => {
    const live: LivePresence[] = [
      {
        id: "p1",
        presenceId: "p1",
        authUid: "p1",
        uid: "p1",
        lastSeen: new Date().toISOString(),
      } as LivePresence,
      {
        id: "p2",
        presenceId: "p2",
        authUid: "p2",
        uid: "p2",
        lastSeen: new Date().toISOString(),
      } as LivePresence,
    ];

    const inputQueue: any[] = [];
    const isWriter = vi.fn(() => true);
    const getLivePresence = vi.fn(() => live);
    const pullInputs = vi.fn(async () => {
      const payload = [...inputQueue];
      inputQueue.length = 0;
      return payload;
    });
    const stepSim = vi.fn();
    const writeState = vi.fn(async () => {
      /* no-op */
    });

    const stop = startHostLoop({
      arenaId: "arena-1",
      isWriter,
      getLivePresence,
      pullInputs,
      stepSim,
      writeState,
    });

    try {
      // First frame shouldn't tick because dt < target threshold
      currentNow = 0;
      await runNextFrame();
      expect(stepSim).not.toHaveBeenCalled();

      // Queue inputs and advance enough time to trigger a simulation step
      const validInput = { presenceId: "p1", authUid: "p1" };
      const missingPresence = { presenceId: "p3", authUid: "p3" };
      const authMismatch = { presenceId: "p2", authUid: "wrong" };
      inputQueue.push(validInput, missingPresence, authMismatch);

      currentNow = 100; // > 1 / 12 s (~83ms)
      await runNextFrame();

      expect(isWriter).toHaveBeenCalled();
      expect(getLivePresence).toHaveBeenCalled();
      expect(pullInputs).toHaveBeenCalledTimes(1);
      expect(stepSim).toHaveBeenCalledTimes(1);
      expect(stepSim.mock.calls[0][0]).toBe(100);
      expect(stepSim.mock.calls[0][1]).toEqual([validInput]);
      expect(writeState).toHaveBeenCalledTimes(1);

      const logMessages = infoMock.mock.calls.map((call) => call[0]);
      expect(logMessages.some((msg) => String(msg).includes("[INPUT] rejected"))).toBe(true);
      expect(logMessages.some((msg) => String(msg).includes("[STATE] wrote"))).toBe(true);
    } finally {
      stop();
    }
  });
});
