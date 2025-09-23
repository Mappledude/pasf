declare const process: { env: Record<string, string | undefined> };

declare module "firebase/app" {
  export const initializeApp: (config: any) => any;
  export const getApp: () => { options: Record<string, any> };
}

declare module "firebase/app-check" {
  export const initializeAppCheck: (app: any, options: any) => any;
  export class ReCaptchaEnterpriseProvider {
    constructor(siteKey: string);
  }
  export class ReCaptchaV3Provider {
    constructor(siteKey: string);
  }
}

declare module "firebase/auth" {
  export type User = { uid: string };
  export const getAuth: (app?: any) => any;
  export const signInAnonymously: (auth: any) => Promise<{ user: User }>;
  export const onAuthStateChanged: (
    auth: any,
    next: (user: User | null) => void,
    error?: (err: any) => void
  ) => () => void;
  export const connectAuthEmulator: (auth: any, url: string) => void;
  export const signOut: (auth: any) => Promise<void>;
}

declare module "firebase/firestore" {
  export type Firestore = any;
  export type DocumentReference = any;
  export type QueryDocumentSnapshot = any;
  export type Unsubscribe = () => void;
  export const getFirestore: (app?: any) => any;
  export const connectFirestoreEmulator: (db: any, host: string, port: number) => void;
  export const doc: (db: any, ...segments: string[]) => any;
  export const collection: (db: any, ...segments: string[]) => any;
  export const getDoc: (ref: any) => Promise<any> | any;
  export const getDocs: (ref: any) => Promise<any> | any;
  export const setDoc: (ref: any, data: any, options?: any) => Promise<void> | void;
  export const updateDoc: (ref: any, data: any) => Promise<void> | void;
  export const deleteDoc: (ref: any) => Promise<void> | void;
  export const onSnapshot: (ref: any, next: (snapshot: any) => void, error?: (err: any) => void) => Unsubscribe;
  export const serverTimestamp: () => any;
  export class Timestamp {
    constructor(seconds: number, nanoseconds: number);
    toMillis(): number;
    toDate(): Date;
    static fromMillis(millis: number): Timestamp;
  }
  export const increment: (by: number) => any;
  export const query: (collection: any, ...clauses: any[]) => any;
  export const orderBy: (field: string, direction?: "asc" | "desc") => any;
  export const runTransaction: (db: any, updater: (tx: any) => Promise<any>) => Promise<any>;
}

declare module "firebase/functions" {
  export const getFunctions: (app: any) => any;
}
