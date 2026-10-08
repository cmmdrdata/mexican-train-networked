# Mexican Train

A single-file, browser-based **Mexican Train** domino game (double-12 set) for one player against a computer opponent, with three skill levels, a talkative opponent, and a lot of polish on how it looks and sounds.

- **One file, no dependencies.** The whole game is a self-contained HTML page (about 160 KB) with no libraries, no fonts, no images, no audio files and no network requests. Tile art is inline SVG and the tile click is synthesized with Web Audio.
- **Plays offline.** Open `mexican-train.html` in a modern browser. That's it.
- **Heavily tested.** About 170,000 automated checks run in Node with no browser (see [Testing](#testing)).

> **Status:** playable and feature-rich, but so far tested only through Node-based simulations and fake DOMs. It has not yet had a systematic pass in real browsers. See [Known limitations](#known-limitations).

---

## Contents

1. [Quick start](#quick-start)
2. [How to play](#how-to-play)
3. [Controls](#controls)
4. [Settings](#settings)
5. [The computer opponent](#the-computer-opponent)
6. [Playing online](#playing-online)
7. [Look, feel and sound](#look-feel-and-sound)
8. [Accessibility](#accessibility)
9. [Project layout and building](#project-layout-and-building)
10. [How the code is organized](#how-the-code-is-organized)
11. [Testing](#testing)
12. [The terminal version](#the-terminal-version)
13. [Known limitations](#known-limitations)
14. [Ideas under consideration](#ideas-under-consideration)
15. [License](#license)

---

## Quick start

**Play against the computer:** open `mexican-train.html` in a current browser (Chrome, Edge, Firefox or Safari). No server is needed.

**Play against a friend:** run `node server.js` on one computer and see [Playing online](#playing-online).

**Replay the same deals:** add `?seed=N` to the page URL, for example `mexican-train.html?seed=7`. With a fixed seed the shuffle, the computer's moves and its name are repeatable. Handy for bug reports.

**Your settings are remembered** in the browser's `localStorage` (keys `mt-opts` and `mt-last-cpu`). If storage is unavailable or blocked, the game still works and simply doesn't remember.

**Rebuild from source** (only if you change the code):

```bash
python3 build.py        # writes mexican-train.html from template.html + style.css + game.js
```

---

## How to play

The rules below are exactly what the game implements.

### The set and the rounds

- The set is **double-12**: 91 tiles, 0-0 up to 12-12.
- Each round starts from an **engine**, a double: **12-12 in round 1, 11-11 in round 2, and so on down to 0-0** (13 rounds for a full game). You can play 1, 4 or 13 rounds.
- Each player is dealt **8, 12 or 15** tiles (your choice). The rest are the **boneyard**.
- Three trains all begin from the engine's number: **your train**, **the computer's train**, and the shared **Mexican train** that anyone can play on.

### The opening: everyone builds at once

At the start of every round, both players **build their own train at the same time**, before any normal turn:

- Tap tiles one after another to add them to your train, or press **Build my longest train** to lay down the longest possible train automatically.
- You can **take back** your last tile as often as you like until you press **Done**.
- The computer builds too, but **its tiles stay face down** until it finishes. (Its doubles are shown standing across the train even while face down.)
- **Done** is not allowed while your train ends on an uncovered double. Cover it or take it back.
- If nothing in your hand fits the engine, you draw one tile. If it still doesn't fit, you pass and a toy train marker goes on your train.
- Using up **every tile** in the opening wins the round on the spot. If both players do it, the round is a tie.

### Normal turns

Play one tile that matches the number a train needs onto one of:

- your own train,
- the **Mexican train**, or
- the **computer's train, but only if it has a toy train marker on it**.

**Nothing fits?** Draw one tile. If it fits, play it. If not, you **pass** and a **marker (a little toy train in your color) goes on your train**, which lets your opponent play there until you next play on it yourself.

### Doubles

- After you play a **double**, you must play another tile onto it straight away.
- If you can't (even after drawing), the double stays **open** and the next player must cover it before anything else is played.
- **A double cannot win the round.** If your last tile is a double, you don't go out: you must **draw one tile and cover the double, or pass**. If the other player then covers it, you have gone out. If that cover was *their* last tile too, the round is a tie.
- In the opening, **a double cannot be your last tile down** (it could not win, and the opening has no draw to cover it), so it stays in your hand.

### Scoring and winning

- **Going out** wins the round: you score **0**, and the other player scores the pips left in their hand. The **0-0 tile counts 50**.
- A **blocked round** (boneyard empty and nobody can play) scores both players their pips.
- The **lowest total after the last round wins** the match.

---

## Controls

| To do this | Do this |
|---|---|
| **Play a tile on one train** | Tap the tile (it plays at once when it fits only one place). |
| **Choose between trains** | Tap the tile, then tap the glowing train. |
| **Play by dragging** | Drag the tile onto the train you want. The trains it can go on light up and the one under the tile is highlighted. |
| **Rearrange your hand** | Drag tiles around your hand. Drop between or after other tiles, in any row. There is no Sort button: a new round starts with the automatic order again (heaviest tiles first). |
| **Move a tile with the keyboard** | Focus it, then **Shift + Left/Right arrow**. |
| **Draw** | Press the **Draw** spot in your hand, click the empty part of your hand, or press the boneyard button (only when drawing is your only move). |
| **Build my longest train** | Button in the opening. |
| **Take back / Done** | Buttons in the opening. |
| **Mute sound** | The Mute button in the header. |
| **Computer comments on/off** | The **Comments** button beside the computer's name. |
| **Close a dialog** | **Esc** |

Notes:

- If you have **only one playable tile** and it fits several trains, it starts selected and **can't be de-selected**. You just pick the train.
- Your tiles are drawn flat (long side horizontal) in **two or more rows**, with a spare cell for the Draw spot.
- Tiles you can't play are dimmed.
- Hovering a playable tile previews the trains it can go on.

---

## Settings

Open **New game** to choose these. They are saved between visits.

| Setting | Choices | Default |
|---|---|---|
| Rounds | 1, 4, or 13 | 4 |
| Tiles per hand | 8, 12, or 15 | 15 |
| Tile style | **Colored pips** or **Large numbers** | Colored pips |
| Computer level | **Easy**, **Medium**, **Hard** | Medium |
| Sound | on / off (also the Mute button) | on |
| Computer comments | on / off (the Comments button) | on |

---

## The computer opponent

### Three skill levels

| Level | How it plays |
|---|---|
| **Easy** | Plays a random legal move a good share of the time and builds short opening trains (about 2 tiles on average). |
| **Medium** | A sensible heuristic: heavy tiles first, prefers its own train, covers doubles it can follow up, and builds the longest possible opening train. |
| **Hard** | Medium plus true pip counting (0-0 costs 50) and a **lookahead** that keeps long chains buildable. |

Measured over 1,400 rounds each, with every deal played twice with the seats swapped:

| Matchup | Round wins |
|---|---|
| Hard vs Medium | 54.7% to 44.0% |
| Medium vs Easy | 60.6% to 38.3% |
| Hard vs Easy | 67.2% to 31.9% |
| Easy vs a purely random player | 56.6% to 42.3% |

(Hard's edge is real but modest: the game has a lot of luck. Ideas that were tried and made no measurable difference include counting unseen tiles and avoiding awkward shared-train ends.)

### Pacing like a person

Every tile the computer places waits a random **0.5 to 4 seconds**. The exceptions are covers: when a double is open and the computer holds a tile that covers it, it plays it **immediately**, with no thinking time.

### Names, tags and voices

- There are **48 computer players, 16 per level**. Each name always plays at one level, and the level is shown as a colored tag next to the name. The name is drawn from the pool for the level you chose.
- **Each level has its own voice.** Easy is a flustered beginner, Medium is sassy, and Hard is smug and exact. Each has its own full set of lines (no line is shared).

### It talks about your play

- It **rates each of your moves** against the best available one using the Hard evaluation (great, good, poor, awful, forced, or a missed chance to go out) and sometimes comments, with a cooldown so it isn't constant.
- It reacts to your **draws, passes and opening trains** (including quoting how many tiles you built versus how many you could have).
- **If you take too long**, it taunts you after 25 seconds, then again every 20 to 26 seconds, getting ruder each time.
- The tone is cheeky and rude in a game-night way, with mild language. A blocklist test checks that every line stays that way. The **Comments** button turns it all off.
- Comments never affect the game: a game plays out identically with comments on or off.

### Players with foreign names

- **17 players speak in their own script**, sometimes (about 40% of their comments), with an English translation underneath: Russian (Dmitri), Japanese (Keiko, Hiro, Kenji), Chinese (Mei, Wen), Korean (Joon), Hindi (Ravi, Priya, Arjun, Anil, Sunita) and Arabic (Omar, Aisha, Zainab, Tariq, Noor). Arabic is shown right to left.
- **All 48 players have a home country and three dishes from it.** While you dither they may announce they are hungry and go off to get one, escalating from peckish, to off to get it, to back and finished it. They keep the same dish through a wait. Players with a native language say this in it too, with the dish in its own script.

---

## Playing online

Two people can play each other over a network. One of you runs a small game server on their own computer; both of you play in an ordinary browser. There is no account, no website and nothing to install for the second player.

### What you need

- **The host** needs [Node.js](https://nodejs.org) (developed and tested on Node 22; the code uses nothing newer than Node 14, but that is untested) and these five files in one folder: `server.js`, `ws-lite.js`, `online-match.js`, `game.js` and `mexican-train.html`. There are no packages to install.
- **The guest** needs only a browser and the host's address.

### Hosting

```bash
node server.js                  # listen on port 8080, on every network interface
node server.js --port 3000      # another port
node server.js --local-only     # only this computer may connect (for trying it out)
node server.js --help
```

The server prints the address to open, for example:

```
  Open  http://192.168.1.23:8080  in your browser to host a game.
  The other player opens the same address to join.
```

That is this computer's address on your network, never `localhost` (home and office addresses, 192.168.x.x, 10.x.x.x or 172.16-31.x.x, are preferred when there are several; the others are listed under it). Open it in your own browser, press **Host online game**, and pick the game length. The Host screen shows the same address in a **read-only field**: the server tells the page what it is (through `/info`), the page uses that and nothing typed in, and if the page was not opened from the game server it says so and offers no Create button. A server started with `--local-only` has no network address and shows `127.0.0.1`. You get a **join code** like `K7Q-F2M`. Give the guest the address (the lobby lists every address the server found) and the code. When they have joined, press **Start game**.

**A computer player.** When you create the game, or any time in the lobby, the host can add a computer as a **third player** (Easy, Medium or Hard, the same players and skill as in the game against the computer). All three are at the table from the start, and each person sees the other person and the computer as two opponents, each with a row of face-down tiles and a train. The computer runs on the server, so the server must stay up for the whole game; it thinks for the same human-like pause as in the single-player game and plays a tile that covers an open double at once. It does not make comments in online games.

**The rules with three players** are the usual ones. Everyone has a train of their own and there is the shared Mexican train; a marker on someone's train lets *both* of the others play on it. The turns go round the table, and who starts changes every round. All three build their opening trains at the same time. An open double must be covered by whoever is next able to, and the players who cannot pass and get a marker. A double as someone's last tile cannot go out: if it is then covered, its owner has gone out, and if the player who covers it also plays their last tile, those two tie (as do any players who are out together in the opening). A blocked round goes to the lowest hand; if two or three share the lowest, nobody wins it. Lowest total wins the game, and a shared lowest is "A tie between ...".

The lobby also shows a **QR code** for the join link, for example `http://192.168.1.23:8080/?join=K7QF2M`, with a **Copy link** button under it. A phone on the same network can scan it and lands on the Join screen with the server address and the code already filled in, so it only has to type a name and tap Join. If the computer has more than one network address (Wi-Fi and a VPN, say), each one gets a **Show QR** button and the QR code shows one at a time. The QR code carries the computer's *local network* address; for a game over the internet, give the guest the same link with your public address and forwarded port instead (`http://PUBLIC-ADDRESS:PORT/?join=CODE`). The server does not look up its public address yet.

**"Listening on the whole network"** means the server accepts connections on every network interface the computer has (Wi-Fi, Ethernet, VPN), not only from the same machine, so another computer can connect to `your-ip:8080`. That is the default, because the point is to let someone else join. `--local-only` restricts it to the host machine. Your operating system's firewall may ask whether to allow Node.js: allow it on private networks.

### Joining

Either scan the host's QR code (or open the link it contains), which fills in everything but your name; or open the host's address in a browser (`http://192.168.1.23:8080`), press **Join online game** and enter the code; or open any saved copy of `mexican-train.html`, press **Join online game**, and type the address as well as the code. The address may be written as `192.168.1.23:8080`, `192.168.1.23` (port 8080 is assumed) or pasted as a full `http://...` link.

### Over the internet

On the same network (home Wi-Fi, an office) it just works. Over the internet the guest has to be able to reach the host's computer: forward the port on the host's router to the computer running the server, or put both computers on a VPN (Tailscale, ZeroTier and similar), or use a tunnel service. The connection is plain HTTP and WebSocket, **not encrypted**, which is fine on a home network or a VPN. The page must be opened over `http://` (or from a file): a browser will not let an `https://` page connect to a plain `ws://` server.

### During a game

- Everything works as in the game against the computer: tapping, dragging, **Build my longest train**, taking tiles back, the flying tiles and the click sounds. Your opponent's tiles click too.
- **A low, short tone says it is your move.** It sounds when a new turn of yours begins, not for the rest of the same turn (covering your own double, or playing a tile you just drew), not while you build your opening train, and not when the dialogs appear. It is much lower and softer than the high click of a domino, and **Mute** silences it. It plays in online games only.
- The computer's comments are replaced by **Say something**: twelve quick phrases ("Nice play!", "Hurry up!"...). Nothing anyone types can reach the other screen.
- **If someone's connection drops**, the game pauses for both players and the other screen shows a 3-minute countdown. The dropped player's page reconnects by itself (and a reloaded page rejoins from a remembered code), landing back in the same game with the same hand. If they do not return in time, the game ends and the other player is told why.
- **Leave game** ends the game for both players (after a confirmation). Closing the page does not: you have the three minutes to come back.
- If the same game is opened in a second window, the first window is closed rather than the two fighting over the seat.

### Fair play and safety

- **The server runs the rules**, using the same engine as the game against the computer. Every move is checked there; an illegal or out-of-turn move changes nothing.
- **Neither browser is ever sent a tile it should not see**, the host's included. Your opponent's hand and the boneyard arrive as counts only. While your opponent is still building their opening train it arrives as face-down placeholders: only which of them are doubles shows, as in the game against the computer.
- Join codes are six random characters from an alphabet without look-alikes (no 0/O, 1/I/L), and a client that guesses wrong codes is made to wait. Anyone who has the address **and** the code can take the second seat of an open game, so give them only to the person you mean to play.
- Names are cleaned (letters, digits, spaces and `. _ - '`, 20 characters) on the server and again on the page, and everything that arrives from the network is escaped before it is drawn. The server serves only the game page (no other files), limits message size and rate, caps connections and games, and drops connections that stop answering.

### How it works

The server (`server.js`) serves the page at `/` and a WebSocket at `/ws`. A small hand-written WebSocket implementation (`ws-lite.js`, RFC 6455, text frames only) avoids any dependency. `online-match.js` runs a match between two seats using the real engine and builds a separate **view** for each player. The page sends **intents** (`play`, `draw`, `done`, `undo`, `autoBuild`, `ok`) and draws the views it is sent; each intent is answered with an `ack` that carries the sequence number of the last state sent before the move was processed, so the page can tell which later states already include its move. Messages are JSON:

| Page to server | Meaning |
|---|---|
| `create`, `join`, `resume` | open a game, join one by code, or take your seat back with the token you were given |
| `settings`, `start` | the host sets the length and hand size, and starts |
| `i` | an intent (`a`: what, `tile`, `train`, and an `id` that comes back in the `ack`) |
| `chat`, `leave`, `ping` | a quick phrase by number, leave, keep-alive |

| Server to page | Meaning |
|---|---|
| `created`, `joined`, `resumed`, `lobby` | you are in; who is here; the settings and the addresses |
| `state` | the full view for this player, plus the events that led to it (so tiles can fly) |
| `presence` | the other player dropped or came back, and when the wait runs out |
| `ack`, `error`, `chat`, `ended`, `pong` | answers, a phrase from the other player, the game is over and why |

### Limits

- Two people, with or without one computer as a third player. No more than three at the table, no two computers, and no spectators. The computer does not comment on the play online.
- Games live in the server's memory: stopping or restarting the server ends every game.
- Tested with real sockets (see Testing), but **not yet in real browsers, on separate computers, or across a real network with a firewall and router**. Treat the first game between two machines as the real test.

---

## Look, feel and sound

**Markers are toy trains.** When a player passes, a small toy locomotive appears at the far left of their train to show it is open, as the colored train pieces do in the physical game. It is glossy and 3D-looking but a single color per player (you red, the first opponent blue, the second yellow): lighter on top, darker underneath, with a white shine, all shades of that one color. It is about 52 x 34 pixels, with two wheels whose upper halves are hidden behind the body. It stays at the left edge as a long train scrolls past underneath it, never catches a click, and the "Open: ... can play here" note says the same in words. The Mexican train, which is always open, has none.

**Hints.** The main screen has an **Allow hints** switch (on by default). With it off, nothing highlights the tiles you can play or the trains they can go on, nothing is picked or played for you, and "Build my longest train" is hidden: you pick a tile and then a train, and a wrong guess is refused with a message. With it on, your hand has a **Show hints** button to switch the highlights off and on during a game. The train with an open double to cover is always outlined, and the hand always has its Draw button.

- **Flying tiles.** Played tiles fly from where they were (your hand, the spot where you let go of a drag, or the computer's row of face-down tiles) to their place on the train, and turn face up in flight when they become public. Drawn tiles fly from the boneyard into the hand. Nothing flies if your system asks for reduced motion.
- **Trains** scroll themselves to follow the newest tile. There are no scroll bars: a soft fade appears on the left edge when older tiles are out of sight.
- **The boneyard button** is pinned to the top right of the opponent row and never moves or resizes.
- **The tile sound** is synthesized: a bright, short click of two small hard tiles meeting (a sharp strike, four fast-fading resonances at roughly 3 to 8.5 kHz, and a quieter second contact a few milliseconds later), in six slightly different variants with a little pitch variation. It is unlocked on your first click, as browsers require.
- **Dim states.** When drawing is your only move, your tiles dim and the boneyard button and Draw spot flash in step.

---

## Accessibility

- Tiles are real buttons with labels such as "5 and 7, playable"; face-down tiles read "face-down tile" and never reveal their numbers.
- Status messages and the computer's comments are in live regions.
- Everything can be done from the keyboard, including reordering your hand.
- The game respects the system **reduced motion** setting (no flying tiles or animation; shorter pauses).
- Colored pips are only one of two tile styles: **Large numbers** is there for anyone who finds the colors hard to tell apart.

---

## Project layout and building

```
.
├── template.html          the page shell (a placeholder for the CSS and one for the JS)
├── style.css              all styling
├── game.js                all game code (rules, AI, sound, animation, views, app)
├── build.py               stitches the three files above into mexican-train.html
├── mexican-train.html     the built, single-file game (generated, but committed so you can just play it)
├── server.js              the online game server (see "Playing online"); no dependencies
├── ws-lite.js             a small WebSocket (RFC 6455) implementation for the server
├── online-match.js        a two-human match run on the server with the real engine, and each player's view
├── mexican-train.js       the separate, older terminal version (see below)
├── game_v4_rule.js        a frozen reference engine used by test_levels
├── .gitignore
└── t/                     the tests
    ├── test_*.js          the test suites (see below)
    ├── mexican-train.js   a 7-line shim that lets test_rules and test_sim use the browser engine
    ├── game_before_cover.js   a frozen earlier build, used by test_cpu_cover
    ├── game_before_sound.js   a frozen earlier build, used by test_sound
    └── game.js            a copy of ../game.js made by the test command below (git-ignored)
```

Edit `game.js`, `style.css` or `template.html`, then run `python3 build.py`. The build asserts that the code doesn't contain `</script>` or `</style>`, which would break the single-file page.

Nothing is minified or bundled, so the built file is readable.

**Browser features used:** Pointer Events (mouse, touch and pen dragging), the Web Audio API, the Web Animations API, CSS Grid and custom properties, and `localStorage` (always wrapped in `try/catch`).

---

## How the code is organized

`game.js` is one file in labelled sections:

| Section | What it does |
|---|---|
| **Engine** | Pure game rules: tiles, deals, legal moves, turns, doubles and markers, blocked-round detection, scoring. No UI. |
| **The opening** | The simultaneous opening phase, the exact longest-train search, and the computer's opening play. |
| **Skill levels** | The Easy, Medium and Hard move choosers, and the move-rating function used for comments. |
| **Sound** | The click synthesis (plain maths on an array) and the Web Audio player. |
| **Tile art** | One inline SVG per tile, in pips or numbers style. |
| **Motion** | Flying-tile animation, drag-to-play and hand rearranging. |
| **Trash talk** | Line pools for all levels, native-language and food data, and the comment logic. |
| **Views** | Pure functions from state to HTML strings. |
| **App** | State, actions, the match loop, timers and pacing. |
| **Boot** | Wires the real browser (events, storage, audio, resize) to the app. |

Design choices that make it testable:

- **The engine is independent of the UI.** It drives the game through async hooks (`onPlay`, `onDraw`, and so on), so the same engine runs a browser game, a terminal game, or a 5,000-round simulation.
- **Dependency injection.** `createApp(env)` takes its storage, random source, sleep function, sound, animation layer and timers as arguments. Tests substitute fakes, which is how the whole game can be played in Node with no browser.
- **Reproducible.** The game uses a seeded random generator. The computer's *chatter* uses a separate random source, so comments never change how a game plays out.
- **Pure views.** Screens are strings built from state; the boot code only attaches events and does the few things that need a real DOM (measuring tiles, scrolling, animating).

The code exports its pieces as `globalThis.MexicanTrainGame` (engine, app, helpers) so tests can use them, and exposes the running app as `MexicanTrainApp` on the page.

---

## Testing

There is no build step for the tests and no dependencies: just Node (developed and run on Node 22; the network suites use Node's built-in WebSocket client, which needs Node 22; `test_qr` and `test_join_link` also use python3 with OpenCV for their decoding checks and skip them if it is missing).

```bash
python3 build.py
cp game.js t/game.js                      # the tests load t/game.js
cd t
for f in test_*.js; do node "$f" || echo "FAILED: $f"; done    # each suite exits non-zero if anything fails
```

| Suite | What it covers | Checks |
|---|---|---|
| `test_rules` | Core rules, including the last-tile-double rule and ties | 61 |
| `test_sim` | 5,200 simulated rounds (CPU vs CPU, random vs CPU, random vs random) with board invariants checked on every move, and every outcome of the double rule exercised | all invariants |
| `test_open` | The opening phase against a brute-force oracle, 1,500 computer rounds and 1,200 random-agent openings | ~10,850 |
| `test_levels` | Skill levels: Medium is move-for-move identical to the original; every pairing plays legally; strength ordering | ~70,700 |
| `test_ui` | The whole interface by playing complete matches through the actions | ~80,400 |
| `test_boot` | The real built page, run in a sandbox with a fake DOM and audio | 52 |
| `test_fx` | Flying-tile and draw animations, hand dragging, scroll behavior | ~7,100 |
| `test_drag_play` | Dragging a tile onto a train, the no-pause double cover, the fixed boneyard | 53 |
| `test_hand_layout` | The flat multi-row hand, the Draw spot, dropping into rows | 77 |
| `test_facedown_doubles` | The computer's face-down doubles stand upright | 7 |
| `test_double_ui` | Selection rules and last-tile-double flows through the page | 30 |
| `test_cpu_cover` | The computer's no-delay cover, compared with the previous build | 18 |
| `test_first_turn_win` | Using every tile on your first train, played through the game from a rigged deal | 54 |
| `test_sound` | The synthesized click as numbers (spectrum, timing, two contacts), against the old sound | 43 |
| `test_chat` | Move rating, thresholds, comment timing, per-level voices, the Comments toggle | ~120 |
| `test_native` | Every native-language line is in the right script and translated | ~140 |
| `test_food` | Every player's home country, dishes and hunger remarks | ~200 |
| `test_spelling` | Everything a player can read uses American spelling | 6 |
| `test_ws` | The WebSocket layer over real sockets: handshake, every frame size, fragmentation, every protocol violation and its close code, 600 connections of garbage | 74 |
| `test_online_match` | Whole two-human matches: no hidden tile is ever sent (checked on every message of 36 matches, and shown to catch three injected leaks), both views agree, no tile is lost, every bad intent is refused, rigged first-train wins | 66 |
| `test_server` | The server over real sockets: the page and path tricks, which network address is shown (ranking, `/info`, never localhost), codes and the lobby (including the computer player option), hostile clients, flooding, 12 simultaneous games, whole games with a computer, dropping and returning, the time limit, chat, the heartbeat, the command line | 151 |
| `test_online_client` | The real page logic against the real server, played through the same actions a person triggers: Host and Join screens, lobby, whole games, a rigged first-turn win, chat, reconnecting, the paused screen, reload and resume, a hostile server trying to inject markup, and the turn sound checked against the engine's own record of turns | 133 |
| `test_three_players` | The rules with three players: the deal, who may play where, a marker, an open double travelling past a player who cannot cover it, ties and blocked rounds among three, the three-way opening, and 1,500 simulated rounds with all invariants checked at every play | 37 |
| `test_online_three` | A server-side match with two people and a computer: nothing hidden is ever sent to either person (checked on every message of 30 matches, and shown to catch leaks of the second opponent), both views agree under their different labels, the computer builds and plays by itself, pausing, a rigged win | 33 |
| `test_three_client` | The real page against the real server with a computer player, through the screens: the Computer player option, the lobby, two opponent rows, whole games, each opponent's animations, the turn sound against the engine's record, chat attribution, a dropped connection, a rigged win, a hostile server describing three players | 51 |
| `test_hints` | Allow hints and Show hints: no hint of any kind on any screen of whole games with hints off (played by guessing tile and train), wrong guesses change nothing, nothing is picked for you, the toggles and their saving, the opening, dragging, online, the always-on double outline and Draw button | 52 |
| `test_toy_train` | The toy train marker: its drawing (shades of one color, two wheels half covered by the body, same height), the three colors and its size, when it appears (every screen of six whole games), the wording with no lanterns left, three players online | 34 |
| `test_dim_spacing` | The hand is dimmed on every screen where it is not your turn (against the computer and online) and not on your turn; the end-of-train padding is two dominoes | 12 |
| `test_browser.py` | The real page in real Chromium (Playwright) against the real server: measured opacity of the hand, measured empty space after each train's last tile (wide and phone-sized screens), the host address field (an IP, read-only, cannot be edited), the QR code as the browser really draws it decoded by OpenCV, layout of the three-player table, and whole games between two and three real browser pages with no JavaScript errors. Skipped if Playwright is not installed; saves screenshots | 44 |
| `test_qr` | The QR generator: a published Reed-Solomon example, the standard's block tables and format and version strings, and 52 codes across all ten versions read back by an independent decoder (OpenCV, skipped if python3 with OpenCV is not installed) | 35 |
| `test_join_link` | The real built page opened from a scanned link (`?join=`), the Host screen's address, the lobby's QR code and Copy link button, several network addresses, and the lobby's QR decoded back to its link | 33 |
| `test_turn_sound` | The turn sound as numbers (pitch, length, no clicks, unlike the domino click), its audio plumbing, and when it plays: once per turn, not once per prompt | 49 |

A few techniques worth knowing about:

- **Reference builds.** Some tests compare the current game with a frozen earlier build (`game_v4_rule.js`, `t/game_before_cover.js`, `t/game_before_sound.js`) so that "this part didn't change" and "this part changed exactly like this" are checked, not assumed.
- **Rigged deals.** The first-turn-win test makes the game deal a hand of the author's choosing by running the Fisher-Yates shuffle backwards to compute the exact random numbers needed, so the game's state is never tampered with.
- **Checks that can fail.** Several suites were verified by deliberately breaking the game in a scratch copy and confirming the test failed.

The scripts used to measure and tune the computer's strength, and the sound-analysis scraps, were left out of the repository: they are throwaway experiments, not part of the game or its tests.

---

## The terminal version

`mexican-train.js` is a separate, older, dependency-free **terminal** game (Node 14+) with its own copy of the rules:

```bash
node mexican-train.js                 # a full 13-round game
node mexican-train.js --rounds 1      # one quick round
node mexican-train.js --seed 5        # replay a deal
node mexican-train.js --help
```

It is simpler than the browser game: normal turns only (no simultaneous opening), one computer skill level, and no comments. It has been kept consistent with the browser game on the last-tile-double rule and the tie result, and was checked with a 3,000-round simulation, but it has no tests of its own in `t/`.

---

## Known limitations

- **Only lightly tested in real browsers.** Most testing is in Node with fake DOMs. `test_browser.py` runs the page in one real browser, Chromium, and checks the hand dimming, the train spacing, the host address field, the QR code and whole online games between real pages, and the three-player layout was inspected in a screenshot. Safari, Firefox and phones were not tried, nor was touch dragging, audio unlocking on mobile, or the non-Latin fonts. Nothing has been tried between separate computers.
- **Two or three players.** The rules engine seats two players (you and the computer, or two people online) or three (two people and a computer, online only). There is no hot-seat second human on one screen, no game against two computers, and no more than three at the table.
- **Online play is untested on real networks.** It is tested with real local sockets, with the real page logic against the real server, but not in real browsers, between separate computers, or through a router and firewall. Connections are not encrypted.
- **Native-language lines were written without a native-speaker review.** They are checked for the right script and clean translations, but may contain awkward phrasing. The grammar avoids guessing anyone's gender where it could.
- **The computer's face-down doubles show that a tile is a double** (though not its numbers).
- **Hard is only modestly stronger than Medium.** A much stronger computer would need to reason about the unseen tiles in your hand, which isn't implemented.
- **Only the double-12 set** is supported.
- **A few unmatched exits remain** in the separate trading-app project this was developed alongside; they are unrelated to the game.

---

## Ideas under consideration

These are discussed, **not implemented**:

- **Encrypted connections** (HTTPS and `wss://`) for playing over the open internet, which would need a certificate or a tunnel in front of the server.
- **More than three players**, or a second computer, or two people sharing a screen. (Three at the table is done, as two people and a computer, online.)
- **Online play over the internet without port forwarding.** (The server does not look up its public address.)
- **The computer commenting online**, as it does in the game against the computer.

---

## License

No license has been chosen yet. Until one is added, all rights are reserved by default. A permissive license such as MIT would be a natural fit for a project like this; add a `LICENSE` file and update this section.
