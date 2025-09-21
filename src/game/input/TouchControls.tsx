import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearInputSource,
  createInputSource,
  type InputSource,
  type InputState,
  updateInputSource,
} from "./inputsChannel";

type TouchKey = "left" | "right" | "up" | "attack1" | "attack2";

type ActiveMap = Record<TouchKey, boolean>;

type PointerBuckets = Record<TouchKey, Set<number>>;

function createPointerBuckets(): PointerBuckets {
  return {
    left: new Set<number>(),
    right: new Set<number>(),
    up: new Set<number>(),
    attack1: new Set<number>(),
    attack2: new Set<number>(),
  };
}

const ORIENTATION_QUERY = "(orientation: portrait)";

function getOrientation(): "portrait" | "landscape" {
  if (typeof window === "undefined") {
    return "landscape";
  }
  const query = window.matchMedia?.(ORIENTATION_QUERY);
  if (query) {
    return query.matches ? "portrait" : "landscape";
  }
  return window.innerHeight >= window.innerWidth ? "portrait" : "landscape";
}

const baseActiveMap: ActiveMap = {
  left: false,
  right: false,
  up: false,
  attack1: false,
  attack2: false,
};

const TouchControls: React.FC = () => {
  const sourceRef = useRef<InputSource>(createInputSource("touch-controls"));
  const pointersRef = useRef<PointerBuckets>(createPointerBuckets());
  const [activeMap, setActiveMap] = useState<ActiveMap>({ ...baseActiveMap });
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(getOrientation);

  const updateOrientation = useCallback(() => {
    setOrientation(getOrientation());
  }, []);

  useEffect(() => {
    const query = typeof window !== "undefined" ? window.matchMedia?.(ORIENTATION_QUERY) : null;
    if (query?.addEventListener) {
      query.addEventListener("change", updateOrientation);
    } else if (query?.addListener) {
      query.addListener(updateOrientation);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateOrientation);
      window.addEventListener("orientationchange", updateOrientation);
    }
    return () => {
      if (query?.removeEventListener) {
        query.removeEventListener("change", updateOrientation);
      } else if (query?.removeListener) {
        query.removeListener(updateOrientation);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", updateOrientation);
        window.removeEventListener("orientationchange", updateOrientation);
      }
    };
  }, [updateOrientation]);

  const releaseAll = useCallback(() => {
    const source = sourceRef.current;
    if (!source) {
      return;
    }
    const partial: Partial<InputState> = {
      left: false,
      right: false,
      up: false,
      jump: false,
      attack1: false,
      attack2: false,
    };
    updateInputSource(source, partial);
    pointersRef.current = createPointerBuckets();
    setActiveMap({ ...baseActiveMap });
  }, []);

  useEffect(() => {
    return () => {
      releaseAll();
      clearInputSource(sourceRef.current);
    };
  }, [releaseAll]);

  const setPointerActive = useCallback(
    (key: TouchKey, pointerId: number, active: boolean) => {
      const source = sourceRef.current;
      const buckets = pointersRef.current;
      const bucket = buckets[key];
      if (active) {
        bucket.add(pointerId);
      } else {
        bucket.delete(pointerId);
      }
      const nextActive = bucket.size > 0;
      setActiveMap((prev) => {
        if (prev[key] === nextActive) {
          return prev;
        }
        return { ...prev, [key]: nextActive };
      });
      if (!source) {
        return;
      }
      switch (key) {
        case "left":
        case "right":
        case "attack1":
        case "attack2": {
          updateInputSource(source, { [key]: nextActive } as Partial<InputState>);
          break;
        }
        case "up": {
          updateInputSource(source, { up: nextActive, jump: nextActive });
          break;
        }
        default:
          break;
      }
    },
    [],
  );

  const makePointerHandler = useCallback(
    (key: TouchKey, active: boolean) =>
      (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (active) {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } else {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        setPointerActive(key, event.pointerId, active);
      },
    [setPointerActive],
  );

  const handleCancel = useCallback(
    (key: TouchKey) => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setPointerActive(key, event.pointerId, false);
    },
    [setPointerActive],
  );

  const buttonClass = useCallback(
    (key: TouchKey, extra?: string) => {
      const classes = ["touch-controls__button"];
      if (extra) {
        classes.push(extra);
      }
      if (activeMap[key]) {
        classes.push("touch-controls__button--active");
      }
      return classes.join(" ");
    },
    [activeMap],
  );

  const orientationClass = useMemo(() => {
    return orientation === "portrait" ? "touch-controls--portrait" : "touch-controls--landscape";
  }, [orientation]);

  return (
    <div className={`touch-controls ${orientationClass}`}>
      <div className="touch-controls__group">
        <div className="touch-controls__dpad">
          <span />
          <button
            type="button"
            className={buttonClass("up", "touch-controls__button--dpad")}
            onPointerDown={makePointerHandler("up", true)}
            onPointerUp={makePointerHandler("up", false)}
            onPointerCancel={handleCancel("up")}
            onLostPointerCapture={handleCancel("up")}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="Jump"
          >
            ↑
          </button>
          <span />
          <button
            type="button"
            className={buttonClass("left", "touch-controls__button--dpad")}
            onPointerDown={makePointerHandler("left", true)}
            onPointerUp={makePointerHandler("left", false)}
            onPointerCancel={handleCancel("left")}
            onLostPointerCapture={handleCancel("left")}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="Move left"
          >
            ←
          </button>
          <span />
          <button
            type="button"
            className={buttonClass("right", "touch-controls__button--dpad")}
            onPointerDown={makePointerHandler("right", true)}
            onPointerUp={makePointerHandler("right", false)}
            onPointerCancel={handleCancel("right")}
            onLostPointerCapture={handleCancel("right")}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="Move right"
          >
            →
          </button>
        </div>
      </div>
      <div className="touch-controls__group touch-controls__attack-group">
        <button
          type="button"
          className={buttonClass("attack1", "touch-controls__button--attack")}
          onPointerDown={makePointerHandler("attack1", true)}
          onPointerUp={makePointerHandler("attack1", false)}
          onPointerCancel={handleCancel("attack1")}
          onLostPointerCapture={handleCancel("attack1")}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Attack 1"
        >
          A
        </button>
        <button
          type="button"
          className={buttonClass("attack2", "touch-controls__button--attack")}
          onPointerDown={makePointerHandler("attack2", true)}
          onPointerUp={makePointerHandler("attack2", false)}
          onPointerCancel={handleCancel("attack2")}
          onLostPointerCapture={handleCancel("attack2")}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Attack 2"
        >
          B
        </button>
      </div>
    </div>
  );
};

export default TouchControls;
