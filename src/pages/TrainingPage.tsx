import React, { useEffect, useRef } from "react";
import Phaser from "phaser";
import { Link } from "react-router-dom";
import { makeGame } from "../game/phaserGame";
import TrainingScene from "../game/training/TrainingScene";

const TrainingPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 960,
      height: 540,
      parent: containerRef.current,
      backgroundColor: "#0f1115",
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
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0f1115", color: "#e6e6e6" }}>
      <div style={{ padding: "12px" }}>
        <Link to="/" style={{ color: "#7dd3fc", textDecoration: "none" }}>
          ← Lobby
        </Link>
        <h2 style={{ margin: "8px 0 12px 0" }}>Training</h2>
      </div>
      <div ref={containerRef} style={{ display: "flex", justifyContent: "center" }} />
    </div>
  );
};

export default TrainingPage;
