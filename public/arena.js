// @ts-check
import { ensureAnonAuth } from "../src/firebase.ts";
import {
  joinArena,
  leaveArena,
  getArena,
  listenToArenaPresence
} from "../src/db.ts";
import { getCachedPlayer } from "../src/auth.ts";

const params = new URLSearchParams(window.location.search);
const arenaId = params.get("arena");
const titleEl = /** @type {HTMLElement | null} */ (document.querySelector("#arena-title"));
const presenceList = /** @type {HTMLElement | null} */ (document.querySelector("#presence"));
const leaveBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector("#leave-btn"));

const player = getCachedPlayer();

if (!arenaId) {
  alert("Missing arena id. Returning to lobby.");
  window.location.href = "./index.html";
}

if (!player) {
  alert("Please log in first.");
  window.location.href = "./index.html";
}

/** @type {null | (() => void)} */
let unsubscribe = null;

async function setup() {
  if (!arenaId || !player) return;
  await ensureAnonAuth();
  const arena = await getArena(arenaId);
  if (!arena) {
    alert("Arena not found. Returning to lobby.");
    window.location.href = "./index.html";
    return;
  }
  if (titleEl) {
    titleEl.textContent = `${arena.name} (${arena.id.slice(0, 6)})`;
  }
  await joinArena(arenaId, player.playerId, player.name);
  unsubscribe = listenToArenaPresence(arenaId, (presence) => {
    if (!presenceList) return;
    presenceList.innerHTML = "";
    if (!presence.length) {
      const empty = document.createElement("p");
      empty.textContent = "You are the first fighter here!";
      presenceList.appendChild(empty);
      return;
    }
    presence.forEach((member) => {
      const card = document.createElement("div");
      card.className = "card";
      const name = document.createElement("h3");
      name.textContent = member.playerName;
      card.appendChild(name);
      presenceList.appendChild(card);
    });
  });
}

if (leaveBtn) {
  leaveBtn.addEventListener("click", async () => {
    if (!arenaId || !player) return;
    await leaveArena(arenaId, player.playerId);
    window.location.href = "./index.html";
  });
}

window.addEventListener("beforeunload", () => {
  if (unsubscribe) unsubscribe();
  if (arenaId && player) {
    void leaveArena(arenaId, player.playerId);
  }
});

await setup();
