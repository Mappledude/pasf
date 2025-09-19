import React, { useEffect, useRef } from "react";
import Phaser from "phaser";

const TrainingPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    class TrainingScene extends Phaser.Scene {
      constructor() {
        super("Training");
      }
      create() {
        console.info("[training] scene.create()");
        this.cameras.main.setBackgroundColor(0x0f1115);
        this.add
          .text(480, 60, "Training Scene Ready", {
            fontFamily: "system-ui, Arial",
            fontSize: "24px",
            color: "#e6e6e6",
          })
          .setOrigin(0.5, 0.5);

        const g = this.add.graphics();
        g.fillStyle(0x86efac).fillCircle(480, 270, 12);
      }
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: 960,
      height: 540,
      parent: containerRef.current,
      backgroundColor: "#0f1115",
      scene: [TrainingScene],
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <a
          href="/"
          style={{
            padding: "6px 10px",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 6,
            color: "#e5e7eb",
            textDecoration: "none",
          }}
        >
          ← Lobby
        </a>
      </div>
      <div ref={containerRef} />
    </div>
  );
};

export default TrainingPage;
