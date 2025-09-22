import { useArenaRuntime } from "../utils/useArenaRuntime";
import DebugDock from "../components/DebugDock";

export default function ArenaPage() {
  const arenaId = "CLIFF";
  const { live, stable, enqueueInput } = useArenaRuntime(arenaId);

  return (
    <>
      <div className="arena-status">
        <h1>Arena {arenaId}</h1>
        <p>Players online: {live.length}</p>
        <p>{stable ? "Ready for combat" : "Waiting for rivals"}</p>
        <button
          type="button"
          onClick={() => enqueueInput({ type: "move", dx: 1 })}
        >
          Move ➡️
        </button>
      </div>
      <DebugDock />
    </>
  );
}
