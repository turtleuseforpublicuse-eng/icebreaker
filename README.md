# DRRR Safe House v2.0

A disaster-survival icebreaker: the host runs the projector screen, everyone else joins from their phone and controls their own stickman.

## v2.0 Features

### Safe House Expansion
- **Second floor** with interactive stairs (yellow button on controller)
- **12 furniture pieces** across both floors (Tables, Beds, Sofa, Closets, Cabinets, Bookshelf, Pantry, First Aid Cabinet, Umbrella Stand)
- **Furniture durability** — furniture takes damage during disasters and can be repaired
- **Shelter integrity** — displayed as a progress bar; disasters reduce it, repairs restore it
- **Hiding mechanic** — players near furniture take reduced damage

### Items System
- **7 item types**: Food, Water, Umbrella, Repair Kit, First Aid Kit, Battery, Random Supplies
- **Scavenger role** gathers items from shrubs between disasters
- **Umbrella** blocks meteor damage with 2-hit durability
- Items appear in inventory grid on controller; tap to use

### Updated Roles (10 total)
| Role | Count | Responsibility |
|------|-------|---------------|
| Medic | 2 | Heal others (cannot heal self; only Medic can heal Medic) |
| Scavenger | 2 | Gather food/resources, share food |
| Engineer | 1 | Must initialize construction before Constructors can build |
| Constructor | 2 | Repair shelter/furniture (needs Engineer first, ~20s build time) |
| Lookout | 2 | Detect disasters early for calm warning |
| Caretaker | 1 | Clean rubble, repair furniture, maintain shelter |

### Request System
- Players can request: Healing, Food, Engineer init, Construction, Role swap
- Requests appear only to the appropriate player (Medic, Scavenger, Engineer, Constructor)
- Target accepts or declines

### Quiz System
- **Host button**: Throw Question — sends DRRR multiple-choice question to all players
- **22 questions** covering RA 10121, disaster risk, hazards, preparedness, resilience, etc.
- **Rewards**: Top 3 fastest correct players receive +20 Health, +10 Food
- **Essay Question**: Situational DRRR question, 50 char max, 1 min timer, ends early if all submit
- **Essay Voting**: Players vote for best essay (cannot vote for self); winner gets disaster immunity

### Game Progression
- **10 rounds** displayed as `Round X / 10`
- Disasters strike automatically every 1-2 minutes
- **Winner**: Highest Health + Food at end
- **Last survivor wins** if everyone else dies
- **Game Over** screen with winner announcement

### Shelter System
- Shelter integrity bar (100% → 0%)
- Disasters damage shelter (earthquake: 5-15, typhoon: 8-18, meteor: 10-25 per tick)
- Furniture randomly damaged during disasters
- Caretaker repairs furniture and cleans rubble
- Engineers + Constructors perform major repairs (+25 integrity, repair all furniture)

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
6. Host clicks **Start Game** — disasters begin automatically.

## Architecture

| Module | Purpose |
|--------|---------|
| `server.js` | Express + Socket.io entry, game loop, all socket handlers |
| `lib/disasterManager.js` | Auto-scheduling, warnings, damage with shelter/umbrella/immunity |
| `lib/roleManager.js` | Role swap, Medic heal, Caretaker repair, Scavenger gather |
| `lib/shelterManager.js` | Shelter integrity, furniture durability, construction flow |
| `lib/itemManager.js` | Item spawning, inventory, scavenging, umbrella system |
| `lib/quizManager.js` | Quiz, essay, voting with rewards |
| `lib/requestManager.js` | Player-to-player request routing |
| `config.json` | Roles, events, items, furniture, quiz questions, game settings |
| `index.html` | Host projector + player controller (single page) |

## Files

- `server.js` — game server
- `index.html` — host projector + player controller
- `config.json` — all game configuration
- `lib/` — modular managers (6 files)
- `package.json` — dependencies
