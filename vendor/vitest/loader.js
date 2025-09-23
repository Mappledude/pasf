import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const vitestUrl = pathToFileURL(path.join(baseDir, 'index.js')).href;

const firebaseModuleSources = {
  'firebase/app': `const stub = globalThis.__ARENA_EMULATOR__?.app;
if (!stub) throw new Error('firebase/app stub missing');
export const initializeApp = (...args) => stub.initializeApp(...args);
export const getApp = (...args) => stub.getApp(...args);`,
  'firebase/app-check': `const stub = globalThis.__ARENA_EMULATOR__?.appCheck;
if (!stub) throw new Error('firebase/app-check stub missing');
export const initializeAppCheck = (...args) => stub.initializeAppCheck(...args);
export class ReCaptchaEnterpriseProvider { constructor(siteKey){ this.siteKey = siteKey; } }
export class ReCaptchaV3Provider { constructor(siteKey){ this.siteKey = siteKey; } }`,
  'firebase/auth': `const stub = globalThis.__ARENA_EMULATOR__?.auth;
if (!stub) throw new Error('firebase/auth stub missing');
export const getAuth = (...args) => stub.getAuth(...args);
export const signInAnonymously = (...args) => stub.signInAnonymously(...args);
export const onAuthStateChanged = (...args) => stub.onAuthStateChanged(...args);
export const connectAuthEmulator = (...args) => stub.connectAuthEmulator(...args);
export const signOut = (...args) => stub.signOut(...args);`,
  'firebase/firestore': `const stub = globalThis.__ARENA_EMULATOR__?.firestore;
if (!stub) throw new Error('firebase/firestore stub missing');
export const getFirestore = (...args) => stub.getFirestore(...args);
export const connectFirestoreEmulator = (...args) => stub.connectFirestoreEmulator(...args);
export const doc = (...args) => stub.doc(...args);
export const collection = (...args) => stub.collection(...args);
export const getDoc = (...args) => stub.getDoc(...args);
export const getDocs = (...args) => stub.getDocs(...args);
export const setDoc = (...args) => stub.setDoc(...args);
export const updateDoc = (...args) => stub.updateDoc(...args);
export const deleteDoc = (...args) => stub.deleteDoc(...args);
export const onSnapshot = (...args) => stub.onSnapshot(...args);
export const serverTimestamp = (...args) => stub.serverTimestamp(...args);
export const Timestamp = stub.Timestamp;
export const increment = (...args) => stub.increment(...args);
export const query = (...args) => stub.query(...args);
export const orderBy = (...args) => stub.orderBy(...args);
export const runTransaction = (...args) => stub.runTransaction(...args);`,
  'firebase/functions': `const stub = globalThis.__ARENA_EMULATOR__?.functions;
if (!stub) throw new Error('firebase/functions stub missing');
export const getFunctions = (...args) => stub.getFunctions(...args);`,
};

export function resolve(specifier, context, defaultResolve) {
  if (specifier === 'vitest') {
    return {
      url: vitestUrl,
      shortCircuit: true,
    };
  }

  const source = firebaseModuleSources[specifier];
  if (source) {
    const url = `data:application/javascript,${encodeURIComponent(source)}`;
    return {
      url,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = path.resolve(path.dirname(parentPath), `${specifier}.js`);
    if (fs.existsSync(candidate)) {
      return {
        url: pathToFileURL(candidate).href,
        shortCircuit: true,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
