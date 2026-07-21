# DRRR Safe House v1.1

A disaster-survival icebreaker: the host runs the projector screen, everyone else joins from their phone and controls their own stickman.

## Version 1.1 Features

- **Automatic disasters** — Earthquake, Typhoon, and Meteor Shower strike randomly every 1–2 minutes (configurable in `config.json`).
- **Warning overlays** — Large full-screen warning before each disaster on projector and all controllers.
- **Lookout role** — Lookouts get a 3-second early window to detect disasters; successful detection downgrades the warning to a small notification for everyone.
- **Health & Food UI** — Progress bars plus block-style meters (`████████░░ 80`) on controller and host sidebar.
- **Role swapping** — Players can request a swap; the target accepts or declines. Stats, position, and inventory are preserved.
- **Mobile controls** — SVG arrow icons, no text selection/long-press issues, simultaneous move + jump supported.
- **Round tracking** — Displays `Round X / 10` on the host screen (architecture ready for win conditions).
- **Rejoin** — Existing seat-reclaim flow preserved and improved (rejoin errors shown on rejoin screen).

## How to run

1. Install [Node.js](https://nodejs.org).
2. In this folder:
   ```
   npm install
   npm start
   ```
3. Open `http://localhost:3000` on the laptop → **Start as Host (Projector)**.
4. Players on the same Wi-Fi open `http://<laptop-IP>:3000` → **Join as Player (Phone)**.
5. Enter the room code, pick name/color/role, wait in lobby.
6. Host clicks **▶ Start Game** — disasters begin automatically.

## Architecture (extensible for v1.2+)

| Module | Purpose |
|--------|---------|
| `server.js` | Express + Socket.io entry, game loop, socket handlers |
| `lib/disasterManager.js` | Auto-scheduling, warnings, damage ticks — add disasters in `config.json` |
| `lib/roleManager.js` | Role swap requests/responses — foundation for request system |
| `config.json` | Roles, events, game settings |

**Prepared but not yet implemented:** shelter integrity, furniture, items/inventory UI, quiz system, medic/heal requests, scavenger gathering, engineer/construction flow.

Player objects include `inventory: []` for future items. Server tracks `shelterIntegrity` and `pendingRequests[]` for future systems.

## Files

- `server.js` — game server
- `index.html` — host projector + player controller (single page)
- `config.json` — roles, disasters, settings
- `lib/` — modular managers
- `package.json` — dependencies
