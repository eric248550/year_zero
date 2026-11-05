/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * The generator state is a single uint32 stored inside the WorldState, so a
 * snapshot fully captures "where" the random stream is. Same seed + same
 * inputs => identical stream => identical history.
 */
export class Rng {
  private s: number;

  constructor(state: number) {
    this.s = state >>> 0;
  }

  /** Current internal state; persist this to resume the stream later. */
  get state(): number {
    return this.s >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Weighted pick; weights must be >= 0 and not all zero. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    if (items.length === 0 || total <= 0) throw new Error("Rng.weighted with no positive weights");
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  }

  /** Fisher–Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** Approximately normal variate (Irwin–Hall, n=4) scaled to mean/stddev. */
  gaussian(mean: number, stddev: number): number {
    const sum = this.next() + this.next() + this.next() + this.next();
    return mean + (sum - 2) * stddev * Math.sqrt(3);
  }
}

/** Derive an initial RNG state from a user-facing seed (any integer). */
export function seedToState(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
