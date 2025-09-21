import Phaser from "phaser";

export type SnapshotEntry<T> = {
  snapshot: T;
  timestamp: number;
};

export class SnapshotBuffer<T> {
  private entries: SnapshotEntry<T>[] = [];

  constructor(private readonly maxEntries = 4) {}

  push(snapshot: T, timestamp: number): void {
    this.entries.push({ snapshot, timestamp });
    this.entries.sort((a, b) => a.timestamp - b.timestamp);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  getInterpolated(
    now: number,
    delayMs = 100,
  ): { previous?: SnapshotEntry<T>; next?: SnapshotEntry<T>; alpha: number; renderTimestamp: number } | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }

    const renderTimestamp = now - delayMs;
    const entries = this.entries;

    let previous: SnapshotEntry<T> | undefined;
    let next: SnapshotEntry<T> | undefined;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      if (entry.timestamp <= renderTimestamp) {
        previous = entry;
        continue;
      }
      next = entry;
      break;
    }

    if (!previous) {
      previous = entries[0];
    }
    if (!next) {
      next = entries[entries.length - 1];
    }

    if (!previous || !next) {
      return undefined;
    }

    const span = next.timestamp - previous.timestamp;
    const alpha = span > 0 ? Phaser.Math.Clamp((renderTimestamp - previous.timestamp) / span, 0, 1) : 0;

    return { previous, next, alpha, renderTimestamp };
  }

  clear(): void {
    this.entries = [];
  }
}
