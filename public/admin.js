// @ts-check
import { ensureAnonAuth } from "../src/firebase.ts";
import {
  bossCreatePlayer,
  bossDeletePlayerById,
  bossCreateArena,
  bossDeleteArena,
  listPlayers,
  listArenas
} from "../src/db.ts";

// TODO: Lock these operations behind secure admin flows via Cloud Functions.
await ensureAnonAuth();

const playerForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#player-form"));
const playerList = /** @type {HTMLElement | null} */ (document.querySelector("#player-list"));
const arenaForm = /** @type {HTMLFormElement | null} */ (document.querySelector("#arena-form"));
const arenaList = /** @type {HTMLElement | null} */ (document.querySelector("#arena-list"));

async function refreshPlayers() {
  if (!playerList) return;
  const players = await listPlayers();
  playerList.innerHTML = "";
  if (!players.length) {
    const empty = document.createElement("p");
    empty.textContent = "No players yet.";
    playerList.appendChild(empty);
    return;
  }
  players.forEach((player) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = player.name;
    card.appendChild(title);

    const passcode = document.createElement("p");
    passcode.textContent = `Passcode ID: ${player.passcodeId ?? "?"}`;
    card.appendChild(passcode);

    const stats = document.createElement("p");
    const wins = player.stats?.wins ?? 0;
    const losses = player.stats?.losses ?? 0;
    stats.textContent = `Record: ${wins}-${losses}`;
    card.appendChild(stats);

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove ${player.name}?`)) return;
      await bossDeletePlayerById(player.id);
      await refreshPlayers();
    });
    card.appendChild(remove);

    playerList.appendChild(card);
  });
}

async function refreshArenas() {
  if (!arenaList) return;
  const arenas = await listArenas();
  arenaList.innerHTML = "";
  if (!arenas.length) {
    const empty = document.createElement("p");
    empty.textContent = "No arenas created yet.";
    arenaList.appendChild(empty);
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

    const population = document.createElement("p");
    population.textContent = `Fighters inside: ${arena.presence.length}`;
    card.appendChild(population);

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete arena ${arena.name}?`)) return;
      await bossDeleteArena(arena.id);
      await refreshArenas();
    });
    card.appendChild(remove);

    arenaList.appendChild(card);
  });
}

if (playerForm) {
  playerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(playerForm);
    const name = String(formData.get("player") ?? "").trim();
    const passcode = String(formData.get("passcode") ?? "").trim();
    if (!name || !passcode) return;
    await bossCreatePlayer(name, passcode);
    playerForm.reset();
    await refreshPlayers();
  });
}

if (arenaForm) {
  arenaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(arenaForm);
    const name = String(formData.get("arena") ?? "").trim();
    if (!name) return;
    await bossCreateArena(name);
    arenaForm.reset();
    await refreshArenas();
  });
}

await Promise.all([refreshPlayers(), refreshArenas()]);
