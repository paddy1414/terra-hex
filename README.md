# Terra Hex 2

A digital version of the classic hex-island trading and building game: a 3D board, the complete base-game rules, 10 maps, 2–6 players, AI rivals, games on one shared screen, and online rooms where the server checks every move.

All artwork, models, icons and sounds are original and generated in code.

## Running it

Requires [Node.js](https://nodejs.org/) 18 or newer. There is nothing to install.

```bash
npm start                    # serves on port 7779
node server.js --port 8080   # or pick a port
```

Then open `http://<server-ip>:7779`.

### CubeCoders AMP (Generic module)

1. Upload the whole folder (`server.js`, `package.json`, `client/`, `shared/`) to the instance root.
2. **Configuration → Generic Settings**: Executable `/usr/bin/node`, Arguments `server.js --port {{$ApplicationPort1}}`, Application Port 1 `7779` (TCP).
3. Start the instance and share `http://YOUR-SERVER-IP:7779`.

Online rooms are saved to `data/rooms.json` and accounts to `data/accounts.json` every few seconds, and restored when the server restarts. Set `TERRAHEX_DATA` to store them elsewhere. Back up `data/accounts.json` if you care about ratings.

**Accounts and HTTPS.** Passwords are stored only as salted scrypt hashes, and sign-in tokens only as hashes. But plain `http://` sends passwords over the network unencrypted. That is fine on your home network; if the server is reachable from the internet, put it behind HTTPS (for example a reverse proxy such as Caddy or nginx, or AMP's own HTTPS options).

## Playing

- **Start screen**: one-click presets (Quick game, First game, Cities & Knights, Big table, Surprise me), set all AIs at once, a live 3D preview of the chosen map behind the menu, a summary of your settings, and a short How to play guide.
- **Play on this device**: 2–6 seats, any mix of people and AI (easy, normal, hard). Several people can share one screen; hands are hidden behind a "pass to…" screen between them. Local games save after every move and can be continued.
- **Play online**: create a room and share the 6-letter code or invite link. The host can add AI players, pick the board and set a turn timer. Players who reload or lose connection press **Rejoin** to get their seat back. If a player runs out of time, or is disconnected for 45 seconds on their turn, a simple move is made for them so the game never stalls.
- **Cities & Knights** (a setup option for any map and player count, local or online; played to 13 points):
  - Cities on forest, pasture and mountains produce a commodity (paper, cloth, coin) instead of a second resource.
  - Three city-improvement tracks (Trade, Politics, Science) paid in commodities. Level 3 unlocks the Trading House (2:1 commodities), Fortress (mighty knights) or Aqueduct (a resource when a roll gives you nothing). The first to level 4 builds that metropolis (+2), and the first to level 5 can take it.
  - The event die: a ship moves the barbarians; a coloured gate draws progress cards for players whose red die is at most their level + 1.
  - Barbarian attacks: the number of cities against active knight strength. Win, and the top defender becomes Defender of Catan (+1; ties draw a progress card). Lose, and the weakest city owners lose a city. Metropolises are safe, and the robber stays put until the first attack.
  - Knights (basic, strong, mighty): build, activate (1 wheat), promote, move along your roads, displace weaker knights, chase the robber. Knights block other players' roads. City walls add +2 to your discard limit (3 at most).
  - All 54 progress cards (hold up to 4), including the merchant (+1 point, 2:1 on its tile).
  - Click one of your knights on the board for its actions; **Improve** (`I`) opens the city tracks.
- **Seafarers** (a setup option for any map, or the New Shores scenario; played to 13 points; cannot be combined with Cities & Knights yet):
  - Open sea surrounds the land (and fills channels and lakes). Ships (1 wood + 1 sheep, 15 each) sail on water, linking to your settlements and other ships; roads and ships connect only through your own settlement or city.
  - Once per turn, move the ship at the open end of a route (not one built this turn, nor one beside the pirate): click it, then click where it sails. Settlements can be founded from ships.
  - Starting settlements go on a home island. Your first settlement on each other island earns +2 points.
  - Gold fields pay any resource you choose (1 per settlement, 2 per city).
  - On a 7 or a Knight, move the robber (land) or the pirate (sea). The pirate robs ship owners next to him and blocks building or moving ships beside him.
  - Roads and ships together count for the Longest Trade Route. Road Building can place roads or ships; while placing starting pieces or free roads, switch between Road and Ship in the status bar.
- **Map Generator**: your own island from a seed. Choose size (about 20–60 tiles), shape (island, continent, twin isles, archipelago, ring), lakes, resource mix (even, lush, rocky, farmland, scarce), deserts, tree density and a look (temperate, autumn, winter, arid, tropical). The same seed and settings always give the same island; share the map code (`TH:seed:...`). Every generated map keeps each resource on at least a tenth of the tiles, spreads matching terrain apart, keeps red 6s and 8s apart and evens out production per resource; the setup screen shows each resource's share.
- **Maps**: Classic Island, Diamond, Desert Oasis (rich land around a central desert), Lakes (inland lakes), Gear, Archipelago, Twin Isles, Grand Continent, British Isles and Wild Frontier (a new random coastline every game). Each shows the player counts it suits best; any map can be played with 2–6.
- **Numbers**: Beginner (the fixed starter island, Classic map only), Balanced (classic spiral on the Classic map; elsewhere red 6s and 8s apart and matching numbers spread out), Random (red 6s and 8s never touch) and Unrestricted (anything goes).
- **5–6 players** use the official extension rules: 24 of each resource in the bank, a 34-card development deck (20 Knights, 3 of each progress card), and a Special Building Phase after every turn in which each other player, in order, may build or buy a card (no trading, no playing cards). You can only win on your own turn.
- **House rules**: Friendly Robber (on by default: players on 2 points or fewer cannot be blocked or robbed; switch it off for the official rule where anyone can be robbed), Balanced Dice (rolls dealt from a shuffled deck of all 36 outcomes, fewer streaks), Hidden Hands (other players' card counts are hidden), points to win (3–20), discard limit on a 7 (5–20), and a turn timer (30 seconds to 5 minutes, for local and online games).
- **Board game view** (`B` or the ▦ button): flat printed tiles with resource icons, seen from above, for a clear Colonist-style board.
- **Trading**: offers are always shown from your side ("You give / You get", with how many you hold). "Ask for what you need" fills in the cards missing for a road, settlement, city or card; the bank tab offers one-click shortcuts that complete a build. Replies to your offer stay visible while the trade window is closed. Your current bank and harbour rates sit beside your hand.
- **Harbours**: signs show the ratio, the resource and its colour at a constant size on screen; hover one to see what it trades and which two corners give access.
- **Display options** (menu → Display, saved per device): player symbols (●▲■◆★✚) above buildings, knights and (optionally) roads; a colour-blind-friendly palette; rings on what other players built since your last turn. Every new piece pulses briefly when it is built.
- **Readable pieces for every colour**: roads are paved in the owner's colour with a light edge and dark outline; buildings and knights have a two-tone outline (dark, then light) and a coloured base, so they stand out on any terrain.
- **Big rolls**: every roll appears large in the middle of the screen before settling into the dice tray; cards you collect show as "+2 wood +1 ore" above your hand, and other players' gains pop up on their plaques.
- **Accounts, leaderboard and friends** (on the Terra Hex server): sign in from the setup screen. Your rating starts at 1000 and moves after each online game (beating higher-rated players earns more; AI seats count as 1000). Only online games count, because the server decides them. Profiles show stats and recent games. Add friends by username to see who is online, who is in a lobby (with a Join button) and who is playing, and invite friends straight into your room.
- **Chat** in online games, with quick emotes, under the Chat tab beside the Chronicle.
- **Graphics quality** (Menu → Display): Auto, High, Balanced or Battery saver. Auto picks a level for the device (phones start lower) and steps down if the frame rate drops. Lower levels use a lower resolution, fewer trees, wheat and rocks, cheaper shadows (or none), simpler water, no birds or tile effects, and Battery saver caps the frame rate at 30. On every level, pieces are baked into two meshes each, all roads, road junctions, number tokens, chimney smoke and effect particles are drawn as shared instanced meshes, harbour piers are merged, only large scenery casts shadows, and the board drops to 30 fps when nobody is touching it. "Show frame rate" adds a small counter.
- **Turn alerts**: a chime when it becomes your turn (and a reminder after 25 seconds), a glowing Roll button, the tab title flashes while you are in another tab, phones vibrate, and desktop notifications can be switched on in the Sound menu.
- **Signed-in names**: when you are signed in, your account name is your player name in local and online games.
- **A living board**: seagulls circle, fish leap; chimneys smoke; the robber's tile reacts to its terrain, and when his blocked number is rolled he cackles and hops (fire in forests and fields, a thunderstorm over pasture, rockslides in hills and mountains, a sandstorm in the desert) and the pirate drags a squall behind him.
- **Card animations**: cards visibly travel for production, player trades, bank and harbour trades, steals, discards, building costs and card effects.
- **Territory overlay** (`V` or the ⬡ button) rings each tile in the colour of the player who produces most from it.
- **Keys**: `I` city improvements (Cities & Knights), `R` roll, `1` road, `2` settlement, `3` city, `D` buy a card, `T` trade, `E` end turn, `B` board view, `V` territory, `C` reset the view, `H` rules, `Esc` cancel. Drag to rotate, right-drag or two fingers to move, scroll or pinch to zoom.

### Rules implemented

Snake-order setup with resources for the second settlement; distance rule; roads that connect to your network and cannot pass through opponents' buildings; 15 roads, 5 settlements and 4 cities per player; production (settlements 1, cities 2) with the bank-shortage rule; the robber on 7s and Knights (discard half above 7 cards, steal one random card, blocked tiles); all 25 development cards with the one-per-turn and not-on-the-turn-bought rules; Longest Road (5+, holder keeps ties, broken roads handled) and Largest Army (3+); 4:1 bank, 3:1 and 2:1 harbours that apply only to their owner; player trades with counteroffers; victory at 10 points on your own turn. Points to win and the discard limit can be changed under House rules.

## How it is built

```
shared/board.js     hex grid, board generation, harbour placement
shared/engine.js    the rules: one function applies a move and returns the new state
shared/ck.js        Cities & Knights rules (plugged into the engine; Seafarers lives in engine.js)
shared/ai.js        AI players (easy / normal / hard)
shared/ai_ck.js     AI for Cities & Knights
server.js           web server + online rooms (runs the engine, so the server decides every move)
accounts.js         accounts, ratings, friends, presence, invites
client/index.html   layout and styling
client/main.js      interface, turn flow, local games, online client hookup
client/scene.js     the 3D board (Three.js)
client/net.js       online room connection
client/audio.js     synthesized sound effects
client/vendor/      Three.js 0.160.0 (bundled so the game works without a CDN; MIT licence)
```

Each player only receives what they are allowed to see: other players' hands and the development deck are hidden by the server. Repeated or out-of-date moves are ignored.

## Tests

```bash
npm test
```

Runs rule tests (Seafarers rules and complete Seafarers AI games, Cities & Knights rules and complete Cities & Knights AI games with 3–6 players, all built-in maps and the map generator's balance guarantees, setup, building, production, the robber, development cards, Longest Road edge cases, trading, victory, the 5–6 player rules and every house rule), complete AI games on every map with 5 and 6 players, an end-to-end server test that plays a full online game, and a room-settings test.

`test/browser/` holds optional browser playthroughs (Python + Playwright) that play complete games through the real interface. Start the server on port 7781 first (`node server.js --port 7781`), then run e.g. `python3 test/browser/ui_playthrough.py balanced lakes 5 friendlyRobber,hiddenHands` (numbers, map, seats, house rules; add `ck` to the rules for a Cities & Knights game). They use two test-only page hooks: `?still=1` (render on demand, for slow headless browsers) and `?aispeed=0.01` (fast AI).

## Not included

- Seafarers and other expansions (Cities & Knights is included).
- The cloud-room backend from version 1. It only switched on when the page was hosted on a platform that injected Firebase settings, so it never ran on a self-hosted server; online rooms now always go through `server.js`.
- Fonts load from Google Fonts; without internet the game falls back to system fonts.
