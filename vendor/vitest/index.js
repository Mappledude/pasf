const scheduled = [];
const describeStack = [];

function getFullName(name) {
  return [...describeStack, name].join(' ').trim();
}

export function describe(name, fn) {
  describeStack.push(name);
  try {
    fn();
  } finally {
    describeStack.pop();
  }
}

export function it(name, fn) {
  scheduled.push({
    name: getFullName(name),
    fn,
  });
}

function createError(message) {
  const error = new Error(message);
  error.name = 'AssertionError';
  return error;
}

function compareNumbers(actual, expected, precision = 2) {
  const tolerance = Math.pow(10, -precision) / 2;
  return Math.abs(actual - expected) <= tolerance;
}

function buildMatchers(actual, negate = false) {
  const applyResult = (condition, message) => {
    const passed = negate ? !condition : condition;
    if (!passed) {
      throw createError(message);
    }
  };

  const matchers = {
    toBe(expected) {
      applyResult(Object.is(actual, expected), `Expected ${actual} to be ${expected}`);
    },
    toBeCloseTo(expected, precision = 2) {
      if (typeof actual !== 'number' || typeof expected !== 'number') {
        throw createError('toBeCloseTo expects numeric values');
      }
      applyResult(
        compareNumbers(actual, expected, precision),
        `Expected ${actual} to be close to ${expected} with precision ${precision}`,
      );
    },
    toBeGreaterThan(expected) {
      if (typeof actual !== 'number' || typeof expected !== 'number') {
        throw createError('toBeGreaterThan expects numeric values');
      }
      applyResult(actual > expected, `Expected ${actual} to be greater than ${expected}`);
    },
    toBeLessThan(expected) {
      if (typeof actual !== 'number' || typeof expected !== 'number') {
        throw createError('toBeLessThan expects numeric values');
      }
      applyResult(actual < expected, `Expected ${actual} to be less than ${expected}`);
    },
  };

  Object.defineProperty(matchers, 'not', {
    get() {
      return buildMatchers(actual, !negate);
    },
  });

  return matchers;
}

export function expect(actual) {
  return buildMatchers(actual, false);
}

export function __vitestGetScheduled() {
  return [...scheduled];
}

export function __vitestClearScheduled() {
  scheduled.length = 0;
}
