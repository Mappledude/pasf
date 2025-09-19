import { useEffect, useRef } from "react";

export type KeyIntentState = {
  left: boolean;
  right: boolean;
  up: boolean;
  jump: boolean;
  attack: boolean;
  seq: number;
};

const DEFAULT_STATE: KeyIntentState = {
  left: false,
  right: false,
  up: false,
  jump: false,
  attack: false,
  seq: 0,
};

const KEY_CODE_MAP: Record<string, keyof KeyIntentState | undefined> = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "up",
  ArrowUp: "up",
  Space: "jump",
  KeyJ: "attack",
};

export function useKeyBinder(target: Document | Window | null = typeof window !== "undefined" ? window : null) {
  const stateRef = useRef<KeyIntentState>({ ...DEFAULT_STATE });

  useEffect(() => {
    if (!target) {
      return;
    }

    const downHandler = (event: KeyboardEvent) => {
      const key = KEY_CODE_MAP[event.code];
      if (!key) return;
      if (key === "seq") return;
      const current = stateRef.current;
      if (!current[key]) {
        stateRef.current = { ...current, [key]: true, seq: current.seq + 1 };
      }
    };

    const upHandler = (event: KeyboardEvent) => {
      const key = KEY_CODE_MAP[event.code];
      if (!key) return;
      if (key === "seq") return;
      const current = stateRef.current;
      if (current[key]) {
        stateRef.current = { ...current, [key]: false, seq: current.seq + 1 };
      }
    };

    const downTarget: any = "addEventListener" in target ? target : window;
    const upTarget: any = downTarget;

    downTarget.addEventListener("keydown", downHandler);
    upTarget.addEventListener("keyup", upHandler);

    return () => {
      downTarget.removeEventListener("keydown", downHandler);
      upTarget.removeEventListener("keyup", upHandler);
    };
  }, [target]);

  return stateRef;
}
