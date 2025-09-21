import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  db,
  ensureAnonAuth,
  joinArena,
  leaveArena,
  claimArenaSeat,
  releaseArenaSeat,
import {
  // ...other imports you already have,
  initArenaPlayerState,
  watchLeaderboard,
  type LeaderboardEntry,
} from "../firebase";
} from "../firebase";
import { debugLog, debugWarn } from "../net/debug";
import {
  ensureArenaState,
  watchArenaState,
  touchPlayer,
  type ArenaState,
} from "../lib/arenaState";
import { useArenaPresence } from "../utils/useArenaPresence";
import { useArenaSeats } from "../utils/useArenaSeats";
import { useAuth } from "../context/AuthContext";
import { makeGame } from "../game/phaserGame";
import ArenaScene, { type ArenaSceneConfig } from "../game/arena/ArenaScene";
import TouchControls from "../game/input/TouchControls";


export default function ArenaPage() {
  const { arenaId = "" } = useParams();
  const nav = useNavigate();
  const [stateReady, setStateReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ArenaState | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement | null>(null);
const gameRef = useRef<Phaser.Game | null>(null);
const [gameBooted, setGameBooted] = useState(false);

const [touchControlsEnabled, setTouchControlsEnabled] = useState(false);
const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
const [leaderboardLoading, setLeaderboardLoading] = useState(true);
const [leaderboardError, setLeaderboardError] = useState<string | null>(null);


  const { players: presence, loading: presenceLoading, error: presenceError } = useArenaPresence(arenaId);
  const { seats, loading: seatsLoading, error: seatsError } = useArenaSeats(arenaId);
  const { user, player, authReady } = useAuth();
  const [seatBusy, setSeatBusy] = useState<number | null>(null);
  const [seatMessage, setSeatMessage] = useState<string | null>(null);

  type SeatEntry = (typeof seats)[number];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const detectTouch = () => {
      const nav = window.navigator as Navigator & {
        maxTouchPoints?: number;
        msMaxTouchPoints?: number;
      };
      const maxPoints = typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
      const navAny = nav as { msMaxTouchPoints?: number };
      const msPoints = typeof navAny.msMaxTouchPoints === "number" ? navAny.msMaxTouchPoints : 0;
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
      const hasOntouch = "ontouchstart" in window;
      const next = maxPoints > 0 || msPoints > 0 || coarse || hasOntouch;
      setTouchControlsEnabled((prev) => (prev === next ? prev : next));
    };

    detectTouch();

    const handleChange = () => detectTouch();
    const pointerQuery = window.matchMedia?.("(pointer: coarse)");
    if (pointerQuery?.addEventListener) {
      pointerQuery.addEventListener("change", handleChange);
    } else if (pointerQuery?.addListener) {
      pointerQuery.addListener(handleChange);
    }
    window.addEventListener("orientationchange", handleChange);
    window.addEventListener("touchstart", handleChange, { passive: true });

    return () => {
      if (pointerQuery?.removeEventListener) {
        pointerQuery.removeEventListener("change", handleChange);
      } else if (pointerQuery?.removeListener) {
        pointerQuery.removeListener(handleChange);
      }
      window.removeEventListener("orientationchange", handleChange);
      window.removeEventListener("touchstart", handleChange);
    };
  }, []);

  // Auto-init + subscribe
  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[ARENA] arena state init skipped: auth not ready", { arenaId });
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        debugLog("[ARENA] arena state init starting", { arenaId });
        await ensureArenaState(db, arenaId); // Create doc if missing
        if (cancelled) return;
        unsub = await watchArenaState(
          db,
          arenaId,
          (s) => {
            setState(s);
            setStateReady(!!s);
          },
          (e) => {
            console.error("[ARENA] arena watch error", e);
            setErr("Live state failed to load.");
          }
        );
        debugLog("[ARENA] arena state subscription active", { arenaId });
      } catch (e) {
        if (cancelled) return;
        console.error("[ARENA] arena init error", e);
        setErr("Failed to initialize arena state.");
      }
    })();

    return () => {
      cancelled = true;
      setStateReady(false);
      if (unsub) {
        unsub();
      }
    };
  }, [arenaId, authReady]);

  // Touch player presence in state (hp + updatedAt)
  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[ARENA] touchPlayer skipped: auth not ready", { arenaId });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        debugLog("[ARENA] touchPlayer start", { arenaId, uid: user?.uid });
        await touchPlayer(db, arenaId);
        if (!cancelled) {
          debugLog("[ARENA] touchPlayer complete", { arenaId, uid: user?.uid });
        }
      } catch (e) {
        if (cancelled) return;
        debugWarn("[ARENA] touchPlayer failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, authReady, user?.uid]);

  useEffect(() => {
    if (!arenaId) return;
    if (!authReady) {
      debugLog("[PRESENCE] join skipped: auth not ready", { arenaId });
      return;
    }
    if (!user?.uid) {
      debugLog("[PRESENCE] join skipped: missing uid", { arenaId });
      return;
    }

    const uid = user.uid;
    const codename = player?.codename ?? uid.slice(0, 6);
    const profileId = player?.id;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    debugLog("[PRESENCE] join effect starting", { arenaId, uid, codename });

    (async () => {
      try {
        debugLog("[PRESENCE] ensureAnonAuth", { arenaId, uid });
        await ensureAnonAuth();
        if (cancelled) return;

        debugLog("[PRESENCE] joinArena", { arenaId, uid, codename });
        await joinArena(arenaId, uid, codename, profileId);
        if (cancelled) return;

        debugLog("[PRESENCE] join complete", { arenaId, uid });

        heartbeat = setInterval(() => {
          debugLog("[PRESENCE] heartbeat", { arenaId, uid });
          joinArena(arenaId, uid, codename, profileId).catch((e) => {
            debugWarn("[PRESENCE] heartbeat failed", e);
          });
        }, 60000);
      } catch (e) {
        if (cancelled) return;
        console.error("[PRESENCE] join failed", e);
      }
    })();

    return () => {
      cancelled = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      debugLog("[PRESENCE] leaveArena", { arenaId, uid });
      leaveArena(arenaId, uid).catch((e) => {
        debugWarn("[PRESENCE] leave failed", e);
      });
    };
  }, [arenaId, authReady, player?.codename, player?.id, user?.uid]);

  useEffect(() => {
    setLeaderboardLoading(true);
    const unsubscribe = watchLeaderboard(
      (entries) => {
        setLeaderboard(entries);
        setLeaderboardLoading(false);
        setLeaderboardError(null);
      },
      () => {
        setLeaderboardError("Failed to load leaderboard.");
        setLeaderboardLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  const agents = useMemo(() => Object.keys(state?.players ?? {}), [state]);

  const chipNames = useMemo(() => {
    if (presence.length) {
      return presence.map((entry) => entry.codename || entry.playerId.slice(0, 6));
    }
    return agents;
  }, [agents, presence]);

  const seatMap = useMemo(() => {
    const map = new Map<number, SeatEntry>();
    seats.forEach((seat) => {
      map.set(seat.seatNo, seat);
    });
    return map;
  }, [seats]);

  const meUid = user?.uid ?? null;
  const meProfileId = player?.id ?? null;

  const isSeatMine = (seat?: SeatEntry) => {
    if (!seat || !meUid) return false;
    if (seat.uid === meUid) return true;
    if (meProfileId && seat.playerId === meProfileId) return true;
    if (!seat.playerId && seat.uid === meUid) return true;
    return false;
  };

  const resolveSeatName = (seat?: SeatEntry) => {
    if (!seat) return "Empty";
    const match = presence.find((entry) => {
      if (seat.playerId && entry.profileId && entry.profileId === seat.playerId) {
        return true;
      }
      return entry.playerId === seat.uid || entry.authUid === seat.uid;
    });
    const base = match?.codename ?? seat.playerId ?? seat.uid;
    return base || "Agent";
  };

  const hostSeat = seatMap.get(0);
  const remoteSeat = seatMap.get(1);
  const isHost = !!hostSeat && isSeatMine(hostSeat);

  const hostLabel = hostSeat ? `${resolveSeatName(hostSeat)}${isSeatMine(hostSeat) ? " (you)" : ""}` : "open";
  const remoteLabel = remoteSeat
    ? `${resolveSeatName(remoteSeat)}${isSeatMine(remoteSeat) ? " (you)" : ""}`
    : "open";

  const { gameBooted } = useArenaRuntime({
    arenaId,
    authReady,
    stateReady,
    isHost,
    meUid,
    codename: player?.codename ?? null,
    canvasRef,
    onBootError: (message) => setSeatMessage((prev) => prev ?? message),
  });

  const debugFooter = useMemo(() => {
    const tick = state?.tick ?? 0;
    const playersCount = chipNames.length;
    return `tick=${tick} · agents=${playersCount} · host=${hostLabel} · p2=${remoteLabel} · ready=${stateReady}`;
  }, [chipNames.length, hostLabel, remoteLabel, state?.tick, stateReady]);

  const handleJoinSeat = async (seatNo: number) => {
    if (!arenaId || !meUid) return;
    setSeatBusy(seatNo);
    setSeatMessage(null);
    try {
      await claimArenaSeat(arenaId, seatNo, { uid: meUid, playerId: meProfileId });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to join seat.";
      setSeatMessage(message);
    } finally {
      setSeatBusy(null);
    }
  };

  const handleLeaveSeat = async (seatNo: number) => {
    if (!arenaId || !meUid) return;
    setSeatBusy(seatNo);
    setSeatMessage(null);
    try {
      await releaseArenaSeat(arenaId, seatNo, { uid: meUid, playerId: meProfileId });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to leave seat.";
      setSeatMessage(message);
    } finally {
      setSeatBusy(null);
    }
  };

  useEffect(() => {
    if (!isHost || !arenaId || !meUid || !canvasRef.current) {
      if (gameRef.current) {
        console.info("[ARENA] tearing down Phaser host", { arenaId });
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      setGameBooted(false);
      return;
    }

    const codename = player?.codename ?? meUid.slice(0, 6);
    const spawn = { x: 240, y: 360 };
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    let cancelled = false;

    (async () => {
      try {
        await initArenaPlayerState(arenaId, { id: meUid, codename }, spawn);
        if (cancelled) return;
        const config: Phaser.Types.Core.GameConfig = {
          type: Phaser.AUTO,
          width: 960,
          height: 540,
          parent: canvasEl,
          backgroundColor: "#0f1115",
          physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 }, debug: false } },
          scene: [],
        };
        const game = makeGame(config);
        game.scene.add(
          "Arena",
          ArenaScene,
          true,
          {
            arenaId,
            me: { id: meUid, codename },
            spawn,
          } as ArenaSceneConfig
        );
        gameRef.current = game;
        setGameBooted(true);
      } catch (err) {
        if (cancelled) return;
        console.error("[ARENA] failed to boot Phaser host", err);
        setSeatMessage((prev) => prev ?? "Failed to start local host session.");
      }
    })();

    return () => {
      cancelled = true;
      if (gameRef.current) {
        console.info("[ARENA] destroying Phaser host", { arenaId });
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      setGameBooted(false);
    };
  }, [arenaId, isHost, meUid, player?.codename]);

  useEffect(() => {

    if (!arenaId || !meUid) return;
    const identity = { uid: meUid, playerId: meProfileId };
    return () => {
      releaseArenaSeat(arenaId, 0, identity).catch((err) => debugWarn("[ARENA] release seat0 failed", err));
      releaseArenaSeat(arenaId, 1, identity).catch((err) => debugWarn("[ARENA] release seat1 failed", err));
    };
  }, [arenaId, meProfileId, meUid]);

  return (
    <div className="grid" style={{ gap: 24 }}>
      <section className="card">
        <div className="card-header">
          <div className="meta-grid">
            <span className="muted mono">Arena</span>
            <h2 style={{ margin: 0 }}>{arenaId || "Arena"}</h2>
          </div>
          <div className="button-row">
            <button type="button" className="button ghost" onClick={() => nav("/")}>
              ← Lobby
            </button>
          </div>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <div>
            <span className="muted mono">Tick</span>
            <div style={{ fontSize: "var(--fs-xl)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {state?.tick ?? "—"}
            </div>
          </div>
          <div>
            <span className="muted mono">Agents online</span>
            <div style={{ marginTop: 8 }}>
              {presenceLoading ? (
                <span className="skel" style={{ width: 140, height: 16 }} />
              ) : chipNames.length ? (
                <div className="chips">
                  {chipNames.map((name) => (
                    <span className="chip" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted">No players connected.</span>
              )}
            </div>
          </div>
        </div>
        {!stateReady && (
          <div className="error" style={{ marginTop: 16 }}>
            Initializing arena… waiting for /arenas/{arenaId}/state
          </div>
        )}
        {err ? (
          <div className="error" style={{ marginTop: 16 }}>
            {err}
          </div>
        ) : null}
        {presenceError ? (
          <div className="error" style={{ marginTop: 16 }}>
            Failed to load presence data.
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="muted mono" style={{ marginBottom: 8 }}>
          Leaderboard
        </div>
        {leaderboardLoading ? (
          <div className="grid" style={{ gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ height: 18, width: "100%" }} />
            ))}
          </div>
        ) : leaderboard.length ? (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-sm)",
            }}
          >
            {leaderboard.slice(0, 5).map((entry, index) => (
              <li
                key={entry.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
              >
                <span>
                  <span className="muted">{index + 1}.</span>{" "}
                  {entry.playerCodename ?? entry.playerId.slice(0, 6)}
                </span>
                <span className="muted">
                  S{entry.streak ?? 0} · W{entry.wins ?? 0}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <span className="muted">No wins recorded yet.</span>
        )}
        {leaderboardError ? (
          <div className="error" style={{ marginTop: 12 }}>{leaderboardError}</div>
        ) : null}
      </section>

      <section className="card card-canvas">
        <div className="grid" style={{ gap: 12, marginBottom: 12 }}>
          {[0, 1].map((seatNo) => {
            const seat = seatMap.get(seatNo);
            const mine = isSeatMine(seat);
            const label = seatNo === 0 ? "Player 1 (Host)" : "Player 2";
            const occupied = !!seat;
            const name = resolveSeatName(seat);
            const disabled = seatBusy !== null || !meUid || (occupied && !mine) || seatsLoading;
            return (
              <div key={seatNo} className="card" style={{ margin: 0, padding: 12 }}>
                <div className="muted mono" style={{ marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", marginBottom: 12 }}>
                  {occupied ? (
                    <>
                      {name}
                      {mine ? " (you)" : ""}
                    </>
                  ) : (
                    <span className="muted">Open seat</span>
                  )}
                </div>
                <div className="button-row">
                  {mine ? (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => handleLeaveSeat(seatNo)}
                      disabled={seatBusy === seatNo}
                    >
                      {seatBusy === seatNo ? "Leaving…" : "Leave seat"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      onClick={() => handleJoinSeat(seatNo)}
                      disabled={disabled}
                    >
                      {seatBusy === seatNo ? "Joining…" : `Join P${seatNo + 1}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {seatMessage ? (
          <div className="error" style={{ marginBottom: 12 }}>{seatMessage}</div>
        ) : null}
        {seatsError ? (
          <div className="error" style={{ marginBottom: 12 }}>
            Failed to load seat assignments.
          </div>
        ) : null}
        <div
          ref={canvasRef}
          className="canvas-frame"
          style={{
            minHeight: 420,
            background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04) 0 35%, transparent 60%), var(--bg-soft)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {!gameBooted && (
            <div
              className="muted"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", textAlign: "center" }}
            >
              Arena scene boots once auth and /state/current are ready.
            </div>
          )}
{touchControlsEnabled && gameBooted ? <TouchControls /> : null}

        </div>
        <div className="card-footer">[NET] {debugFooter}</div>
      </section>
    </div>
  );
}
