# DRRR Safe House

A disaster-survival icebreaker: you (the host) run the projector screen, everyone else joins
from their phone and controls their own stickman.

## What was fixed / added
- **The bug:** your saved `index.html` had chat text accidentally pasted into the middle of
  the `<script>` tag (`for (let i = meteors.length - 1; i >= You are totally right...`).
  That broke the whole script, so every button silently did nothing. Rebuilt clean — verified
  with `node --check` on both files.
- **Intermission/lobby:** host sees everyone who's joined and their chosen role, then hits
  **▶ Start Game** whenever ready. No one is dropped into gameplay early.
- **4 disaster events** instead of 1: 🌍 Earthquake (screen shake), 🌪️ Typhoon (wind & debris),
  🌊 Tsunami (rising water), ☄️ Meteor Strike (falling meteors) — each with its own damage
  range and visual.
- **`config.json`** — the 11 roles and 4 events live here so you can rename them, change icons,
  or tweak damage numbers without touching any code.
- Health + hunger bars per player, elimination when health hits 0, roles free up automatically
  if someone disconnects.

## How to run it
1. Make sure [Node.js](https://nodejs.org) is installed.
2. In this folder, run:
   ```
   npm install
   npm start
   ```
3. Open `http://localhost:3000` on your laptop → click **Start as Host (Projector)**. Plug the
   laptop into the projector.
4. Everyone else connects their **phone** to the same Wi-Fi, then opens
   `http://<your-laptop-IP>:3000` (find your IP with `ipconfig`/`ifconfig`) and clicks
   **Join as Player (Phone)**.
5. Players enter the 4-letter room code shown on the projector, pick a name/color/role, and
   land in the waiting room.
6. Host clicks **▶ Start Game** once everyone's in — controllers unlock on players' phones.
7. Host taps the 4 event buttons any time to hit the group with a disaster.

## Ideas to extend later
- Give Carpenters a "repair" button that only works when both tap it within a few seconds.
- Let Providers/Medics send a one-time heal or food boost to a chosen player.
- Add a floor-switching control so players can retreat upstairs during the Tsunami.
- Add a "win" condition (survive N events) and a results screen.

## Files
- `server.js` — game server (Express + Socket.io)
- `public/index.html` — host screen + player controller (one file, role-switches by URL state)
- `config.json` — roles and disaster events data
- `package.json` — dependencies
