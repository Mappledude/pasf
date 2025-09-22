import React from "react";

export default function BuildBadge() {
  const sha = import.meta.env.VITE_COMMIT_SHORT ?? "dev";
  const builtAt = import.meta.env.VITE_BUILD_TIME ?? "";

  return (
    <div className="fixed bottom-2 right-2 text-[10px] opacity-70 select-none">
      build {sha} · {builtAt}
    </div>
  );
}
