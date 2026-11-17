# Terra Hex

A hex-tile empire-building strategy game that runs in the browser: build roads, settlements and cities, trade, play development cards and race to the victory-point target, against AI rivals or friends online.

## Features

- **10 maps**: Classic Island, Diamond, Desert Oasis, Lakes, Gear, Archipelago, Twin Isles, Grand Continent, British Isles, and Wild Frontier (a new random shape every game)
- **2–6 players**: any mix of humans and AI
- **Online rooms**: the host creates a 6-character code and friends join; empty seats can be filled with AI
- **Rules**: Friendly Robber, Balanced Dice, Balanced Numbers, Hidden Hands
- **Advanced settings**: turn timer (off to 5 min), points to win (3–20), card discard limit (5–20)
- Animated dice, sound effects, a "your turn" alert and a territory overlay

## Running it

Requires [Node.js](https://nodejs.org/) 16 or newer. There are no dependencies to install.

```bash
npm start            # serves on port 7779
# or
node server.js --port 8080
```

Then open `http://<server-ip>:7779` in a browser.

### CubeCoders AMP (Generic Module)

1. Create an instance using the **Generic** module.
2. Upload `index.html`, `server.js` and `package.json` to the instance root.
3. Under **Configuration → Generic Settings** set:
   - Executable: `/usr/bin/node`
   - Arguments: `server.js --port {{$ApplicationPort1}}`
   - Application Port 1: `7779` (TCP)
4. Start the instance and share `http://YOUR-SERVER-IP:7779`.

Friends outside your home network need the port forwarded on your router, or a reverse proxy.

## How multiplayer works

`server.js` serves the game and relays room state between players:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Lets the client detect that online rooms are available |
| `POST /api/rooms/:code` | Create a room |
| `POST /api/rooms/:code/join` | Join (or rejoin) a room |
| `POST /api/rooms/:code/update` | Push the latest game state (seated players only) |
| `GET /api/rooms/:code/events` | Live room updates (Server-Sent Events) |

Rooms are kept in memory, so restarting the server ends any games in progress. The host's browser runs the AI players.

## Project layout

```
index.html    # the whole game client (UI, rules, AI, rendering)
server.js     # static file server + multiplayer room relay
package.json  # npm start script
```
