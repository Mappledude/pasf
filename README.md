# StickFight (Lobby Scaffold)

Minimal Firebase + Vite TypeScript scaffold with:
- Anonymous Auth
- Firestore data model (players, passcodes, arenas, presence)
- Basic pages: `/index.html` (passcode login + arena list), `/admin.html` (boss), `/arena.html` (presence + exit)

## Prereqs
- Firebase project: **stickfightpa**
- Enable: Firestore, Authentication (Anonymous), Hosting
- Add your domain under Auth → Settings → Authorized domains (Hosting auto-adds on deploy)

## Local Dev
```bash
npm install
npm run dev
