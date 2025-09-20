import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const vitestUrl = pathToFileURL(path.join(baseDir, 'index.js')).href;

export function resolve(specifier, context, defaultResolve) {
  if (specifier === 'vitest') {
    return {
      url: vitestUrl,
      shortCircuit: true,
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
