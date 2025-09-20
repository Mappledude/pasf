declare module 'node:test' {
  export interface TestContext {
    skip(message?: string): void;
    diagnostic(message: string): void;
  }

  export type TestFn = (t?: TestContext) => Promise<void> | void;

  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}

declare module 'node:assert/strict' {
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): void;
  export function strictEqual(actual: unknown, expected: unknown, message?: string): void;
  export function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;

  const assert: {
    equal: typeof equal;
    deepEqual: typeof deepEqual;
    ok: typeof ok;
    strictEqual: typeof strictEqual;
    notStrictEqual: typeof notStrictEqual;
  };

  export default assert;
}
