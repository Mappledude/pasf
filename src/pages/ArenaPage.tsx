import { useParams } from "react-router-dom";
import { useArenaRuntime } from "../utils/useArenaRuntime";
import DebugDock from "../components/DebugDock";

export default function ArenaPage() {
  const params = useParams<{ id: string }>();
  const arenaId = (params.id ?? "CLIFF").toUpperCase();
  const { live, stable, enqueueInput, bootError, nextRetryAt } = useArenaRuntime(arenaId);

  return (
    <>
      <div className="arena-status">
        <h1>Arena {arenaId}</h1>
        <p>Players online: {live.length}</p>
        <p>{stable ? "Ready for combat" : "Waiting for rivals"}</p>
        {bootError && (
          <p className="text-red-400">
            Presence setup failed: {bootError}
            {nextRetryAt && (
              <>
                {" "}(retrying at {new Date(nextRetryAt).toLocaleTimeString()})
              </>
            )}
          </p>
        )}
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
