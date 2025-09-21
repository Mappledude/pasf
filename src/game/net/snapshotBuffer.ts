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

  getInterpolated(_now: number): T | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }
    return this.entries[this.entries.length - 1]!.snapshot;
  }

  clear(): void {
    this.entries = [];
  }
}
