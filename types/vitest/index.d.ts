declare module 'vitest' {
  export type TestFn = () => void | Promise<void>;

  export interface VitestExpect {
    toBe(expected: unknown): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    readonly not: VitestExpect;
  }

  export function describe(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn): void;
  export function expect<T = unknown>(value: T): VitestExpect;
}
