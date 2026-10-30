# Tiny Heist (prototype)

A browser-based co-op heist where you and your crew are toy-sized thieves inside a convenience store at night. Steal 3 valuables, carry them to the escape zone by the exit, and don't let the security camera watch you for too long.

This is a vertical-slice demo: one level, one objective, one security mechanic, 2 to 4 players.

## How to play

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (click the game first; Esc frees the mouse) |
| Space | Jump |
| E | Pick up / drop a valuable |
| Shift | Sprint |

### The heist

Steal the **golden watch**, **luxury phone**, **jewelry box** and **gold bar** and bring them to the yellow "LOOT HERE" zone by the exit. Loot is placed on random spots every heist, and the money you stash is counted at the end (your best run is saved in the browser).

- **Gold bar:** heavy. One thief can only drag it slowly; two thieves holding it (both press E) carry it much faster. Walk too far apart and it falls.
- **Diamond ring:** optional secret bonus worth $8,000, hidden somewhere hard to reach.
- **Security camera:** if its yellow cone watches you for about 1.3 seconds, the alarm goes off and the police arrive in 60 seconds. If you haven't stashed all four main valuables by then: BUSTED.
- **Camera switch:** a red pad on the floor at the back right. While anyone stands on it, the camera is off.
- **The cat:** sleeps on its purple cushion at the back. Sprinting nearby, dropping loot, snapping traps or the alarm wake it up. If it sees you it hunts you, and if it reaches you it swats you back to the entrance (you drop what you carry). It's faster than walking but slower than sprinting, it's too big to get under the display table, and it can't reach you on high places like the counter.
- **Mousetraps:** step on one and you're stuck for 4 seconds, unless a friend frees you (E).
- **Robot vacuum:** drives a loop around the shop floor. It shoves you if it bumps you, but you can jump on and ride it.
- **Trampolines:** pink rubber bands on the floor launch you up (one next to the counter, one next to the crates).
- **Teamwork:** you can stand on a friend's head to reach higher places.

## Tech stack

The client is plain JavaScript ES modules with Three.js r160, loaded from the jsDelivr CDN through an import map, so there is no build step. The server is Node.js with no npm dependencies: it serves the game files and runs multiplayer over native WebSockets on `/ws` (a small RFC 6455 implementation lives in `ws.js`). Level data and physics (`level.js`, `physics.js`) are imported by both sides, so the client and server always agree on colliders, pickup range, the escape zone and what the camera can see.

The server is authoritative for everything that matters: which player holds which valuable, where dropped items land, deliveries, the camera sweep, detection, the alarm and heist completion. Clients only send requests (for example "interact"), so nobody can create or duplicate objects locally. Each client simulates its own movement for responsive controls; the server rejects impossible moves (teleporting, leaving the map) and snaps the player back. Remote players are drawn 110 ms in the past and interpolated between 20 Hz snapshots so they move smoothly.

## Project structure

Everything is in one folder (no subfolders), which makes it easy to upload to GitHub from a browser.

- `index.html`, `style.css`: start screen, HUD, overlays
- `main.js`, `net.js`, `game.js`, `world.js`, `player.js`, `avatar.js`, `items.js`, `input.js`, `hud.js`, `audio.js`: the browser game
- `server.js`, `room.js`, `ws.js`: the Node.js server (static files, rooms, WebSockets)
- `constants.js`, `level.js`, `physics.js`: shared by the browser and the server
- `test.mjs`: end-to-end test (`npm test`)

## 1. Install dependencies

You need [Node.js](https://nodejs.org) 18 or newer (22+ if you want to run the automated test).

```
cd tiny-heist
npm install
```

There are no third-party packages, so `npm install` only sets up the project; it's safe to skip.

## 2. Start the server

```
npm start
```

You'll see `Tiny Heist server running at http://localhost:3000`. To use another port, set `PORT`, for example `PORT=8080 npm start` (on Windows PowerShell: `$env:PORT=8080; npm start`).

## 3. Start the client

There is no separate client build. The server hosts the client, so open **http://localhost:3000** in Chrome or Edge. The browser needs internet access the first time, because Three.js and the fonts load from CDNs.

## 4. Test multiplayer locally

1. In the first window, enter a nickname and click **Create room**. The room code appears at the top left.
2. In a second window, enter another nickname, type the code, and click **Join room**. You can also click **Copy invite link** in the first window and open that link instead; it fills in the code for you.

Other computers on the same Wi-Fi can join too: find your computer's local IP address (for example `192.168.1.20`, from `ipconfig` on Windows) and open `http://192.168.1.20:3000` on the other machine. Windows may ask to allow Node.js through the firewall; allow it on private networks.

## 5. Test using two browser tabs

Open `http://localhost:3000` in two tabs (or two windows side by side, which is easier to watch). Create a room in one and join it from the other. Mouse look needs a click in the tab you're controlling, and browsers pause background tabs' rendering, so two side-by-side windows work better than tabs for watching both at once.

To run the automated end-to-end test (starts a server, connects simulated players, and plays a whole heist including the alarm, drops, disconnects and restart):

```
npm test
```

## 6. Deploy so someone can join over the internet

The server is a single Node process that needs WebSocket support, which all the hosts below provide. The client automatically uses `wss://` when the page is served over HTTPS.

### Option A: Render (free tier, no credit card)

1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com), choose **New > Web Service** and pick the repository.
3. Settings: Runtime **Node**, Build command `npm install`, Start command `npm start`. Leave the port alone; Render sets `PORT` and the server uses it.
4. Deploy, then share the `https://your-app.onrender.com` address. Players open it, one creates a room, the others join with the code.

Free Render services sleep after about 15 minutes of inactivity; the first visit afterwards takes up to a minute to wake it.

### Option B: Railway or Fly.io

Both detect a Node project from `package.json`. Use `npm start` as the start command. Railway: **New Project > Deploy from GitHub repo**, then **Settings > Networking > Generate Domain**. Fly.io: `fly launch` in this folder, then `fly deploy`.

### Option C: Quick share from your own computer

Run `npm start`, then expose it with a tunnel such as Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) or ngrok (`ngrok http 3000`). Send your friend the `https://…` address it prints. This lasts only while your computer and the tunnel are running.

## Performance notes

The whole store is merged into a few meshes that use vertex colours, so it renders in a handful of draw calls. There is one shadow-casting light (1024 px shadow map) and three cheap point lights, and pixel ratio is capped at 1.5. If the first four seconds average under ~35 fps, the game switches itself to low quality (no shadows, 1x resolution). You can force low quality with `?low=1` in the address, for example `http://localhost:3000/?low=1`.

## Known limitations of this prototype

- Movement is client-simulated. The server blocks teleporting and leaving the map, but doesn't re-run collision, so a modified client could walk through shelves. That's normal for a prototype and fine for friends playing together.
- Valuables don't collide with players or each other; they are held above your head or rest on surfaces.
- There's no reconnect: if your connection drops, use **Back to start** and rejoin with the same code.
- Touch controls aren't implemented; a keyboard and mouse (or trackpad) are needed.
