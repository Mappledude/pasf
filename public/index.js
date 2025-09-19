// @ts-check
import { ensureAnonAuth } from "../src/firebase.ts";
import {
  resolvePasscode,
  listenToArenas,
  joinArena
} from "../src/db.ts";
/** @typedef {import("../src/db.ts").ArenaSummary} ArenaSummary */
import { getCachedPlayer, cachePlayer, clearCachedPlayer } from "../src/auth.ts";

await ensureAnonAuth();

const loginForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#login-form"));
const passcodeInput = /** @type {HTMLInputElement | null} */ (document.querySelector("#passcode-input"));
const loginStatus = /** @type {HTMLElement | null} */ (document.querySelector("#login-status"));
const dashboard = /** @type {HTMLElement | null} */ (document.querySelector("#dashboard"));
const playerNameEl = /** @type {HTMLElement | null} */ (document.querySelector("#player-name"));
const arenasContainer = /** @type {HTMLElement | null} */ (document.querySelector("#arenas"));
const quickMatchBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector("#quick-match"));
const logoutBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector("#logout-btn"));

let unsubscribe = /** @type {null | (() => void)} */ (null);
let currentPlayer = getCachedPlayer();

function setStatus(message, type = "info") {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.dataset.type = type;
}

function showDashboard(show) {
  if (!dashboard) return;
  dashboard.hidden = !show;
  const loginCard = document.querySelector("#login-card");
  if (loginCard instanceof HTMLElement) {
    loginCard.hidden = show;
  }
}

/**
 * @param {ArenaSummary[]} arenas
 */
function renderArenas(arenas) {
  if (!arenasContainer) return;
  arenasContainer.innerHTML = "";
  if (!arenas.length) {
    const empty = document.createElement("p");
    empty.textContent = "No arenas yet. Ask the Boss to make some!";
    arenasContainer.appendChild(empty);
    return;
  }

  arenas.forEach((arena) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = arena.name;
    card.appendChild(title);

    const status = document.createElement("p");
    status.textContent = arena.active ? "Active" : "Inactive";
    card.appendChild(status);

    const occupantsTitle = document.createElement("strong");
    occupantsTitle.textContent = "Fighters";
    card.appendChild(occupantsTitle);

    const list = document.createElement("ul");
    list.style.paddingLeft = "1.25rem";
    if (arena.presence.length === 0) {
      const li = document.createElement("li");
      li.textContent = "(Empty)";
      list.appendChild(li);
    } else {
      arena.presence.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.playerName;
        list.appendChild(li);
      });
    }
    card.appendChild(list);

    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Join";
    joinBtn.disabled = !arena.active || !currentPlayer;
    joinBtn.addEventListener("click", async () => {
      if (!currentPlayer) return;
      await ensureAnonAuth();
      await joinArena(arena.id, currentPlayer.playerId, currentPlayer.name);
      window.location.href = `./arena.html?arena=${encodeURIComponent(arena.id)}`;
    });
    card.appendChild(joinBtn);

    arenasContainer.appendChild(card);
  });
}

function refreshSubscription() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (!currentPlayer) return;
  unsubscribe = listenToArenas((arenas) => {
    renderArenas(arenas);
  });
}

function applyPlayer(player) {
  currentPlayer = player;
  if (playerNameEl) {
    playerNameEl.textContent = player ? player.name : "";
  }
  showDashboard(Boolean(player));
  if (player) {
    setStatus(`Logged in as ${player.name}`);
    cachePlayer(player);
  } else {
    setStatus("Please enter your passcode to start.");
    clearCachedPlayer();
  }
  refreshSubscription();
}

if (currentPlayer) {
  setStatus(`Welcome back, ${currentPlayer.name}!`);
  applyPlayer(currentPlayer);
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!passcodeInput) return;
    const passcode = passcodeInput.value.trim();
    if (!passcode) {
      setStatus("Please type your passcode.", "error");
      return;
    }
    setStatus("Checking passcode...");
    try {
      await ensureAnonAuth();
      const result = await resolvePasscode(passcode);
      if (!result) {
        setStatus("Passcode not found. Try again or ask the Boss.", "error");
        return;
      }
      applyPlayer(result);
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong while logging in.", "error");
    }
  });
}

if (quickMatchBtn) {
  quickMatchBtn.addEventListener("click", () => {
    if (!currentPlayer || !arenasContainer) return;
    const firstJoin = arenasContainer.querySelector("button:not([disabled])");
    if (firstJoin instanceof HTMLButtonElement) {
      firstJoin.click();
    } else {
      setStatus("No arenas are available yet.", "error");
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    applyPlayer(null);
    if (passcodeInput) passcodeInput.value = "";
  });
}
