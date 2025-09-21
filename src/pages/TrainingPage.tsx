import React, { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { makeGame } from "../game/phaserGame";
import TrainingScene from "../game/training/TrainingScene";

const TrainingPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    if (!launched || !containerRef.current) {
      return;
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 960,
      height: 540,
      parent: containerRef.current,
      backgroundColor: "#0a0a0a",
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 }, debug: false } },
      scene: [TrainingScene],
    };

    console.info("[TrainingPage] booting Phaser");
    gameRef.current = makeGame(config);

    return () => {
      console.info("[TrainingPage] destroying Phaser");
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [launched]);

  const handleLaunch = () => {
    setLaunched(true);
  };

  return (
    <section className="card">
      <h1>Training Module</h1>
      <p>Run solo drills in the monochrome dojo. Launch to spin up the local Phaser scene.</p>
      <button type="button" className="button" onClick={handleLaunch} disabled={launched}>
        {launched ? "Training Active" : "Launch Training"}
      </button>
      <div
        ref={containerRef}
        className="canvas-frame"
        style={{
          marginTop: 20,
          minHeight: launched ? 540 : 220,
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          background: "var(--bg-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!launched ? (
          <span className="muted" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
            Canvas warms up once launched.
          </span>
        ) : null}
      </div>
      <div className="card-footer">[SIM] arcade physics · training scene</div>
    </section>
  );
};

export default TrainingPage;
