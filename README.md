# StickFight PA scaffolding

This project contains a Vite + React + TypeScript front-end wired to Firebase for authentication and Cloud Firestore storage.

## Getting started

1. Install dependencies
   ```bash
   npm install
   ```
2. Run the development server
   ```bash
   npm run dev
   ```
3. Set `VITE_USE_FIREBASE_EMULATORS=true` in a `.env` file if you are running Firebase emulators locally.

## Available scripts

- `npm run dev` – start the Vite development server
- `npm run build` – type-check and produce a production build
- `npm run preview` – preview a build locally

## Firebase setup

The application uses the following Firebase configuration:

```ts
export const firebaseConfig = {
  apiKey: "AIzaSyAfqKN-zpIpwblhcafgKEneUnAfcTUV0-A",
  authDomain: "stickfightpa.firebaseapp.com",
  projectId: "stickfightpa",
  storageBucket: "stickfightpa.firebasestorage.app",
  messagingSenderId: "116175306919",
  appId: "1:116175306919:web:2e483bbc453498e8f3db82"
};
```

## Firestore rules

Development rules are stored in `firestore.rules`. They are permissive for early prototyping. Tighten the rules before shipping to production.
