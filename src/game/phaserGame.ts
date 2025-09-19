import Phaser from "phaser";

export function makeGame(config: Phaser.Types.Core.GameConfig) {
  const game = new Phaser.Game(config);
  return game;
}
