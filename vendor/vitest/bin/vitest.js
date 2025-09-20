#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  __vitestClearScheduled,
  __vitestGetScheduled,
} from '../index.js';

async function findSpecFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSpecFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.spec.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function loadTests() {
  const distDir = path.join(process.cwd(), 'dist-tests');
  let specFiles = [];
  try {
    specFiles = await findSpecFiles(distDir);
  } catch (error) {
    if ((error && error.code) !== 'ENOENT') {
      throw error;
    }
    return [];
  }

  for (const file of specFiles) {
    await import(pathToFileURL(file).href);
  }
  return specFiles;
}

async function run() {
  const specFiles = await loadTests();
  if (specFiles.length === 0) {
    console.log('No test files found.');
    return;
  }

  const scheduled = __vitestGetScheduled();
  let failed = 0;

  for (const test of scheduled) {
    try {
      const result = test.fn();
      if (result && typeof result.then === 'function') {
        await result;
      }
      console.log(`✓ ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${test.name}`);
      if (error instanceof Error) {
        console.error(error.stack ?? error.message);
      } else {
        console.error(error);
      }
    }
  }

  __vitestClearScheduled();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
