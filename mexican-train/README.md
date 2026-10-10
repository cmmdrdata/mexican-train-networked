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

- Tap tiles one after another to add them to your train and press **Done**, or press **Build my longest train** to lay down the longest possible train automatically: when the train is down, your opening is finished for you (there is no Done to press).
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

Each train has its own row. A player's row shows the name and, when the train is open, "Open: ... can play here"; it does not say which number it needs (that is the number on the train's last tile). Only the shared **Mexican train** row also says which number it needs.

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
| **Build my longest train** | Button in the opening. Lays the longest train, then finishes your opening for you. |
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
| Computer players | **One** or **two** computer players (so two or three at the table) | One |
| Computer level | **Easy**, **Medium**, **Hard** | Medium |
| Second computer's level | **Easy**, **Medium**, **Hard** (only with two computers; each has its own) | Medium |
| Theme | **Classic** or **The Lord of the Rings** (see [Themes](#themes)) | Classic |
| Hints | **Allow hints** on / off (see Hints under Look, feel and sound). In an online game it is the host's choice, for everyone | on |
| Sound | on / off (also the Mute button) | on |
| Computer comments | on / off (the Comments button) | on |

---

## The computer opponent

### One computer, or two

Choose **Two computer players** and you play against two computers at once, three at the table, each with **its own skill**: an Easy and a Hard one, say, or two of the same. They get different names from the lists for their own skill, play at their own skill (an Easy computer builds short trains, a Hard one long ones), and the header says which is which ("Computers: Easy and Hard"). The turns go round the table and who plays first rotates every round; a marker on a train lets *both* of the others play there; and the usual tie rules apply (two players who go out together tie, a blocked round goes to the lowest hand, and the final can be "A tie between ..."). Their comments are spoken by one computer at a time, in its own voice: during one long wait the same computer does all the "you are taking too long" jabs, getting ruder.

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

### Themes

The **Theme** setting swaps the classic computer players for a cast of characters. There is one so far, **The Lord of the Rings**:

- **14 characters, each at a fixed level.** Easy: Pippin, Merry, Gollum, Treebeard. Medium: Frodo, Sam, Gimli, Legolas, Boromir. Hard: Gandalf, Aragorn, Galadriel, Elrond, Saruman. They play exactly like any other computer player of their level; only who they are changes.
- **Each character has their own voice**, with a full set of lines for every kind of comment (448 lines in all): Gollum hisses about tricksy moves, Treebeard thinks everything is hasty, Gimli swears by his beard, Saruman is smug about your mistakes. The lines are original, written in each character's spirit rather than quoted from the books or films.
- **They get hungry for their own food** while you dither: Sam for rabbit stew, Gollum for raw fish, Treebeard for Ent-draught.
- **An open train is marked with a golden ring** instead of a toy train, and the header says *Double-12 in Middle-earth*.
- **Online too.** The host picks the theme on the Host screen. It applies to the whole online game: the computer player (if there is one) is a character of its level, and an open train wears the golden ring on everyone's screen. The guest's lobby says which theme was chosen. The server sends the theme with the other settings (`settings.theme`, `classic` or `lotr`) and ignores anything else.

Themes live in `THEMES` in `game.js`: a theme lists its characters by level, their lines (`voices`), their food (`food`) and how they say they are hungry (`foodLines`). Adding another theme means adding another entry; the setup screen lists it automatically.

---

## Playing online

Two people can play each other over a network. One of you runs a small game server on their own computer; both of you play in an ordinary browser. There is no account, no website and nothing to install for the second player.


### The end of a game

Between rounds, each person presses the button on the round-end dialog and the next round starts once **both** have, because the next round needs both of them. After the **last** round there is nothing left to start, so nobody waits: whoever presses **See final score** gets the final score at once, even if the other person has not pressed theirs yet (that person still has their own dialog, and gets their own score when they press it). Someone who has seen the final score may go back to the menu or close the page straight away: the game is not treated as abandoned, there is no pause, and the other person is told they have gone and can still press their button and see the final score. (Someone who leaves *before* pressing the button, or at the end of any round but the last, still ends the game for the other person, as before.)

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

**A computer player.** When the host creates the game, they can add a computer as a **third player** (on the Host screen: the first choice is **None**, then Easy, Medium or Hard) (the same players and skill as in the game against the computer). All three are at the table from the start, and each person sees the other person and the computer as two opponents, each with a row of face-down tiles and a train. The computer runs on the server, so the server must stay up for the whole game; it thinks for the same human-like pause as in the single-player game and plays a tile that covers an open double at once.

**The rules with three players** are the usual ones. Everyone has a train of their own and there is the shared Mexican train; a marker on someone's train lets *both* of the others play on it. The turns go round the table, and who starts changes every round. All three build their opening trains at the same time. An open double must be covered by whoever is next able to, and the players who cannot pass and get a marker. A double as someone's last tile cannot go out: if it is then covered, its owner has gone out, and if the player who covers it also plays their last tile, those two tie (as do any players who are out together in the opening). A blocked round goes to the lowest hand; if two or three share the lowest, nobody wins it. Lowest total wins the game, and a shared lowest is "A tie between ...".

**There is nothing to fill in after Create game.** Everything is chosen on the Host screen (game length, tiles each, computer player, theme, whether hints are allowed). The lobby that follows has no inputs: it shows the join code, the QR code and link, who has joined, a one-line summary of how the game was set up, **Leave**, and **Start game** (which waits for the other player). The join code is only shown there; once the game starts, the header just says "Online game".

The lobby also shows a **QR code** for the join link, for example `http://192.168.1.23:8080/?join=K7QF2M`, with a **Copy link** button under it. A phone on the same network can scan it and lands on the Join screen with the server address and the code already filled in, so it only has to type a name and tap Join. If the computer has more than one network address (Wi-Fi and a VPN, say), each one gets a **Show QR** button and the QR code shows one at a time. The QR code carries the computer's *local network* address; for a game over the internet, give the guest the same link with your public address and forwarded port instead (`http://PUBLIC-ADDRESS:PORT/?join=CODE`). The server does not look up its public address yet. **Copy link** works even though the game is served over plain `http` on the local network, where browsers do not provide the clipboard API: it selects the link in a hidden box and copies that, falls back to the clipboard API if that fails, and if nothing can copy it says "Not copied: select the link above and copy it" instead of doing nothing. (The join code is shown large beside it; there is no separate Copy code button.)

**"Listening on the whole network"** means the server accepts connections on every network interface the computer has (Wi-Fi, Ethernet, VPN), not only from the same machine, so another computer can connect to `your-ip:8080`. That is the default, because the point is to let someone else join. `--local-only` restricts it to the host machine. Your operating system's firewall may ask whether to allow Node.js: allow it on private networks.

### Joining

Either scan the host's QR code (or open the link it contains), which fills in everything but your name; or open the host's address in a browser (`http://192.168.1.23:8080`), press **Join online game** and enter the code; or open any saved copy of `mexican-train.html`, press **Join online game**, and type the address as well as the code. The address may be written as `192.168.1.23:8080`, `192.168.1.23` (port 8080 is assumed) or pasted as a full `http://...` link.

### Over the internet

On the same network (home Wi-Fi, an office) it just works. Over the internet the guest has to be able to reach the host's computer: forward the port on the host's router to the computer running the server, or put both computers on a VPN (Tailscale, ZeroTier and similar), or use a tunnel service. The connection is plain HTTP and WebSocket, **not encrypted**, which is fine on a home network or a VPN. The page must be opened over `http://` (or from a file): a browser will not let an `https://` page connect to a plain `ws://` server.

### During a game

- Everything works as in the game against the computer: tapping, dragging, **Build my longest train**, taking tiles back, the flying tiles and the click sounds. Your opponent's tiles click too. **Build my longest train** lays the tiles down one at a time with a random pause of 0.5 to 3 seconds between them, so the others see the train go down at a person's pace instead of all at once, and then a last pause before the opening is finished for that person (no Done to press).
- **A low, short tone says it is your move.** It sounds when a new turn of yours begins, not for the rest of the same turn (covering your own double, or playing a tile you just drew), not while you build your opening train, and not when the dialogs appear. It is much lower and softer than the high click of a domino, and **Mute** silences it. It plays in online games only.
- **Say something** lets you talk to the other person: type a message and press Enter (or Send), or tap one of twelve quick phrases ("Nice play!", "Hurry up!"...). A typed message is plain text on one line, at most 80 characters: control characters, new lines, invisible characters and the ones that flip the direction of text are removed, and spaces are collapsed (by the page, and again by the server). It goes only to the other person (never to the computer player), is shown in a speech bubble in your name, and is always drawn as text, never as markup, so nothing in it can do anything on the other screen. You may send one message every 1.5 seconds and ten a minute; a message that is refused says so, where "You said" would be. The box you type in is kept outside the part of the page that is redrawn on every move (it is made once and only shown or hidden), so the words, the cursor and, on a phone, the keyboard are not lost when the other player moves; it sits at the top of the screen so a phone's keyboard never covers it, Escape closes it (what was typed is kept), and it hides while a dialog is open. The computer player's own comments (with their Comments switch) are separate from this.
- **If someone's connection drops**, nothing happens for the first 8 seconds: most blips (a Wi-Fi hiccup, a page reconnecting by itself) mend within a second, and the other player never sees them. If the player is still gone after 8 seconds, the game pauses for both and the other screen shows a 3-minute countdown. The dropped player's page reconnects by itself (first try after a quarter of a second) and puts them back in their seat with the same hand (a reloaded page rejoins from a remembered code). If they do not return in time, the game ends and the other player is told why. See *When connections drop* below.
- **Leave game** ends the game for both players (after a confirmation). Closing the page does not: you have the three minutes to come back.
- If the same game is opened in a second window, the first window is closed rather than the two fighting over the seat.

### The computer player talks

A computer player in an online game talks just as it does in a game against the computer: it rates each person's moves, remarks on their draws, passes and opening trains, teases whoever is taking too long (getting hungry as it goes), in its own voice: a character's own lines with The Lord of the Rings theme, its level's lines otherwise, and now and then its own language for players like Dmitri or Keiko.

- **Each comment goes only to the person it is about.** It says "you", so Ann's slow-player jabs and Ben's bad moves are each heard only by the one they are about.
- **The server decides what it says** (in `online-match.js`, with the same line-picking code as the page, `composeComment` in `game.js`) and sends it as `{ t: 'say', from, kind, text, lang?, trans? }`.
- **Each player can turn it off** with the **Comments** button on the computer's row. That only hides the bubbles on that player's screen.
- **It changes nothing in play.** It uses its own random numbers, so a game plays out the same whatever it says. It says nothing while the game is paused.
- **When it may speak.** A reaction comes a moment after the move (0.6 to 1.1 seconds), by chance, and no more often than once every 7 seconds to the same person (each person has their own count; a few kinds, such as an awful move or no train at all, always get through). Jabs for a slow player start after 25 seconds. Nothing is ever said to the computer's own seat, and when the match ends, anything still on its way is dropped.
- **The page trusts nothing it is sent.** A comment's text and name are escaped, the text is cut to 160 characters, empty or non-text comments are ignored, and a language is accepted only if it is one of the game's own (with a translation).

### Fair play and safety

- **The server runs the rules**, using the same engine as the game against the computer. Every move is checked there; an illegal or out-of-turn move changes nothing.
- **Nobody is told what is in your hand before you act.** When you have nothing to play, the others see the same "X is choosing a tile." as for any turn; they learn you drew only when you actually draw (and that you passed, when you pass). The computer's own situation is still announced.
- **Neither browser is ever sent a tile it should not see**, the host's included. Your opponent's hand and the boneyard arrive as counts only. While your opponent is still building their opening train it arrives as face-down placeholders: only which of them are doubles shows, as in the game against the computer.
- Join codes are six random characters from an alphabet without look-alikes (no 0/O, 1/I/L), and a client that guesses wrong codes is made to wait. Anyone who has the address **and** the code can take the second seat of an open game, so give them only to the person you mean to play.
- Names are cleaned (letters, digits, spaces and `. _ - '`, 20 characters) on the server and again on the page, and everything that arrives from the network is escaped before it is drawn. The server serves only the game page (no other files), limits message size and rate, caps connections and games, and drops connections that stop answering.

### How it works

The server (`server.js`) serves the page at `/` and a WebSocket at `/ws`. A small hand-written WebSocket implementation (`ws-lite.js`, RFC 6455, text frames only) avoids any dependency. `online-match.js` runs a match between two seats using the real engine and builds a separate **view** for each player. The page sends **intents** (`play`, `draw`, `done`, `undo`, `autoBuild`, `ok`) and draws the views it is sent; each intent is answered with an `ack` that carries the sequence number of the last state sent before the move was processed, so the page can tell which later states already include its move. Messages are JSON:

| Page to server | Meaning |
|---|---|
| `create`, `join`, `resume` | open a game, join one by code, or take your seat back with the token you were given |
| `settings`, `start` | the host sets the length, hand size, computer player, theme and whether hints are allowed (any of them alone), and starts. (The page chooses everything on the Host screen when it creates the game and never sends `settings` from the lobby; the server still accepts it from the host, for other clients.) |
| `i` | an intent (`a`: what, `tile`, `train`, and an `id` that comes back in the `ack`) |
| `chat`, `leave`, `ping` | a quick phrase by number or typed text (`{ t: 'chat', text }`), leave, keep-alive |

| Server to page | Meaning |
|---|---|
| `created`, `joined`, `resumed`, `lobby` | you are in; who is here; the settings and the addresses |
| `state` | the full view for this player, plus the events that led to it (so tiles can fly) |
| `presence` | the other player dropped or came back, and when the wait runs out |
| `ack`, `error`, `chat`, `ended`, `pong` | answers, a phrase from the other player, the game is over and why |

### When connections drop (and how to find out why)

**How a drop is detected.** The server pings every connection every **5 seconds** (a browser answers by itself, without the page). A connection counts as alive when *anything at all* has arrived from it: a game message, a ping reply, even part of a message. It is dropped only after **30 seconds of complete silence**, not when one ping goes unanswered. If the server itself was not running for a while (it was stalled, or the computer slept) it says so in its log and does not blame anyone for the silence. The page does the same from its side: any message from the server proves the connection is alive, a quiet connection is pinged after 10 seconds, and it is given up after 30 seconds of silence. If the *page* was not running for a while (a hidden tab, a locked phone) it does not conclude the server is dead: it checks the connection at once when it wakes up, and reconnects immediately if there is no answer.

**What the other player sees.** A player who drops is not announced, and the game is not paused, for the first **8 seconds**. If they are back by then, nobody notices. Otherwise the game pauses for both and the other screen counts down the 3 minutes they have to return.

All of these can be changed when starting the server in code (`createGameServer({ heartbeatMs, deadAfterMs, softGraceMs, graceMs })`): `heartbeatMs` 5000, `deadAfterMs` 30000, `softGraceMs` 8000, `graceMs` 180000. `softGraceMs: 0` pauses at once, as before.

**Finding out why it happened.** Every drop now explains itself.
- **The server's log** says, for each drop, *how the connection ended* ("the page gave up waiting for this server", "the page was closed or left", "it vanished without a goodbye: Wi-Fi dropping, a phone locking, a tab being suspended or killed", "no sign of life for 30 s"), how long it was up, when it was last heard from, the ping round-trip times (last, average, worst), whether the server's own thread was ever busy, and the device ("iPhone, Safari"). When the player comes back it adds *the page's own account*: how long the page was in the background, how long it had heard nothing, how many reconnection attempts it took. While games are on, a line about the health of the connections appears every minute. `--quiet` silences all of it.
- **`http://host:port/netstats`** (open it in any browser) shows who is connected, each connection's ping times and when it was last heard, how busy the server has been, and the last 30 drops with their reasons.
- **The page** writes every connection event to the browser's console as `[net] ...` (last 60 kept). Open the game with **`?debug=1`** in the address (for example `http://192.168.1.10:8080/?debug=1`) to show the same log in a small panel on the page, with a Copy button: useful on a phone, which has no console.

**Reading a drop.** *Vanished without a goodbye* plus *in the background for N s* in the page's account: the device suspended the page (a locked phone, a tab in the background): keep the screen awake while playing. *The page gave up waiting for this server* with a server line saying its thread was busy: the server was stalled (on Windows, clicking inside the console window freezes a running program until you press a key). Many `slow-reply` events and high ping times: a weak or crowded Wi-Fi signal. *No sign of life for 30 s* with nothing in the page's account: the device or its network went away. `code 1001`: a tab was closed or reloaded.

### Limits

- Two people, with or without one computer as a third player. No more than three at the table, no two computers, and no spectators. The computer does not comment on the play online.
- Games live in the server's memory: stopping or restarting the server ends every game.
- Tested with real sockets (see Testing), but **not yet in real browsers, on separate computers, or across a real network with a firewall and router**. Treat the first game between two machines as the real test.

---

## Look, feel and sound

**Markers are toy trains.** When a player passes, a small toy locomotive appears at the far left of their train to show it is open, as the colored train pieces do in the physical game. It is glossy and 3D-looking but a single color per player. The color belongs to the **seat**, so every screen shows the same colors: online, the host is red, the second person blue and the computer yellow (a fourth seat is green); against the computer, you are red and it is blue. Each train is lighter on top, darker underneath, with a white shine, all shades of that one color. It is about 52 x 34 pixels, with two wheels whose upper halves are hidden behind the body. It stays at the left edge as a long train scrolls past underneath it, never catches a click, and the "Open: ... can play here" note says the same in words. The Mexican train, which is always open, has none.

**Hints.** The main screen has an **Allow hints** switch (on by default). With it off, nothing highlights the tiles you can play or the trains they can go on, nothing is picked or played for you, and "Build my longest train" is hidden: you pick a tile and then a train, and a wrong guess is refused with a message. With it on, your hand has a **Show hints** button to switch the highlights off and on during a game. The train with an open double to cover is always outlined, and the hand always has its Draw button.

**In an online game the host's choice applies to everyone at the table.** The Host screen has an **Allow hints** switch (starting from the host's own main-screen setting), and the lobby afterwards only says whether hints are allowed (there is nothing to change there, for the host or for guests). With hints allowed, each player still has their own **Show hints** button; with them off nobody has one, and nobody is offered **Build my longest train**. The server enforces it as well: with hints off it does not send how long a train could be built, and it refuses a request to build one. Against the computer, the player's own main-screen setting is what counts.

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
- Colored pips are only one of two tile styles: **Large numbers** (the **Show numbers** button in the game, which is remembered; there is no such choice on the main screen) is there for anyone who finds the colors hard to tell apart.

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
| `test_boot` | The real built page, run in a sandbox with a fake DOM and audio | 54 |
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
| `test_online_match` | Whole two-human matches: no hidden tile is ever sent (checked on every message of 36 matches, and shown to catch three injected leaks), both views agree, no tile is lost, every bad intent is refused, rigged first-train wins | 101 |
| `test_server` | The server over real sockets: the page and path tricks, which network address is shown (ranking, `/info`, never localhost), codes and the lobby (including the computer player option), hostile clients, flooding, 12 simultaneous games, whole games with a computer, dropping and returning, the time limit, chat, the heartbeat, the command line | 196 |
| `test_online_client` | The real page logic against the real server, played through the same actions a person triggers: Host and Join screens, lobby, whole games, a rigged first-turn win, chat, reconnecting, the paused screen, reload and resume, a hostile server trying to inject markup, and the turn sound checked against the engine's own record of turns | 135 |
| `test_three_players` | The rules with three players: the deal, who may play where, a marker, an open double travelling past a player who cannot cover it, ties and blocked rounds among three, the three-way opening, and 1,500 simulated rounds with all invariants checked at every play | 37 |
| `test_online_three` | A server-side match with two people and a computer: nothing hidden is ever sent to either person (checked on every message of 30 matches, and shown to catch leaks of the second opponent), both views agree under their different labels, the computer builds and plays by itself, pausing, a rigged win | 37 |
| `test_three_client` | The real page against the real server with a computer player, through the screens: the Computer player option, the lobby, two opponent rows, whole games, each opponent's animations, the turn sound against the engine's record, chat attribution, a dropped connection, a rigged win, a hostile server describing three players | 52 |
| `test_hints` | Allow hints and Show hints: no hint of any kind on any screen of whole games with hints off (played by guessing tile and train), wrong guesses change nothing, nothing is picked for you, the toggles and their saving, the opening, dragging, online, the always-on double outline and Draw button | 69 |
| `test_toy_train` | The toy train marker: its drawing (shades of one color, two wheels half covered by the body, same height), the three colors and its size, when it appears (every screen of six whole games), the wording with no lanterns left, three players online | 38 |
| `test_two_computers` | One person against two computers: the setup form (and the real page's form), names and skills, whole games of up to 13 rounds with every screen inspected, that each computer really plays at its own skill in either seat (Easy and Hard build very different opening trains), the narration naming the right computer, the commentary speakers, the toy train colors | 43 |
| `test_bubble_flash` | A speech bubble fades in once, when it first appears, and not again each time the page is redrawn for a move (the computer's comments and online chat); not at all behind an open dialog; the stylesheet and the real browser's measured opacity and running animations | 22 |
| `test_dim_spacing` | The hand is dimmed on every screen where it is not your turn (against the computer and online) and not on your turn; the end-of-train padding is two dominoes | 12 |
| `test_browser.py` | The real page in real Chromium (Playwright) against the real server: measured opacity of the hand, measured empty space after each train's last tile (wide and phone-sized screens), the host address field (an IP, read-only, cannot be edited), the QR code as the browser really draws it decoded by OpenCV, layout of the three-player table, and whole games between two and three real browser pages with no JavaScript errors. Skipped if Playwright is not installed; saves screenshots | 95 |
| `test_qr` | The QR generator: a published Reed-Solomon example, the standard's block tables and format and version strings, and 52 codes across all ten versions read back by an independent decoder (OpenCV, skipped if python3 with OpenCV is not installed) | 35 |
| `test_join_link` | The real built page opened from a scanned link (`?join=`), the Host screen's address, the lobby's QR code and Copy link button, several network addresses, and the lobby's QR decoded back to its link | 45 |
| `test_theme` | The Lord of the Rings theme: the cast and their levels, every character's full set of lines (mild, American spelling, none shared, placeholders right), their food, picking names and lines, the golden ring, whole games where every speech bubble is checked against the speaker's own lines and every open train wears the ring, the classic game unchanged, the setup form | 70 |
| `test_connection` | The server's handling of connections: any traffic counts as proof of life, real silence is dropped, a stalled server blames nobody, the soft grace (a drop that mends itself is invisible; a longer one pauses and announces; coming back unpauses; never coming back ends the game), every drop explained in the log, the page's account sanitized, `/netstats`, the health line | 37 |
| `test_connection_client` | The page's side: any message counts, quiet connections are pinged, 30 s of silence ends one (saying why), the quick first retry and back-off, a suspended page is not held against the server, waking up checks at once, the account sent on reconnecting, the event log (console, reconnect screen, `?debug=1` panel) | 40 |
| `test_browser_connection.py` | Real Chromium and the real server: a guest's connection is cut mid-game; what the other player sees (run with `--original` against older code to compare) | 6 |
| `test_auto_done` | The opening finishing by itself when "Build my longest train" has laid the whole train (also after a tile was laid by hand and taken back by the plan); a plan that goes wrong hands control back instead; laying tiles by hand never finishes it; no Build button with hints off | 13 |
| `test_say_text` | Typed messages on the page: cleaning (new lines, control, invisible and direction-flipping characters, emoji and other languages kept, 80 characters counted as people see them), sending only what is clean, escaping what is shown, ignoring junk, how long a message stays up, a refused message saying so, and the separate text box (shown, hidden, cleared; hidden under dialogs) | 44 |
| `test_browser_say.py` | Real Chromium, two people: the text box is the very same element with the same text, cursor and focus after the page is redrawn many times; Enter sends, Escape closes and keeps the draft, a quick phrase works, hostile text is only text, a second message straight away is refused with a message, a dialog hides it, it fits a 390-pixel phone | 24 |
| `test_browser_hints.py` | Real Chromium, two people: the host's Allow hints setting reaches the guest (Host screen, the lobbies, the game), the guest's own Show hints button, nothing highlighted or offered with hints off, and Build my longest train finishing the opening by itself, seen by the other player | 19 |
| `test_browser_final.py` | Real Chromium, two people, a one-round game played to the end: the host presses "See final score" and has the final score at once (not waiting for the guest), the guest still has their own dialog, the host goes back to the menu and the guest's game is not ended, is told Ann has gone, and gets the final score too | 8 |
| `test_browser_cleanup.py` | Real Chromium, two people: the Host screen's first computer choice is just "None"; after Create game neither lobby has any inputs; in the game the players' rows have no "Needs N" (the Mexican train's still does, exactly once on the whole screen); and the join code is on neither screen in any of 18 samples (start, the Rules dialog, the Leave question, during play, round end, final score) | 14 |
| `test_cleanup` | The screen clean-ups: no "Needs N" on any player's row (one and two computers, while building and after, and in a hosted game) but still on the Mexican train; an open train still says it is open; "None" as the first computer choice; no inputs in the lobby after Create game, with the join code, Copy link, Leave and Start still there; no join code in a hosted game's header | 19 |
| `test_markers` | Where the marker goes: after every turn of 1,500 rounds (two and three players, the boneyard empty or nearly empty) a pass puts it on the passing player's own train and changes nothing else, and playing on your own train takes it off; hand-made cases (a player who must draw the last tile and still cannot play, nothing to draw so a pass at once, a drawn tile that fits); the simultaneous opening where several players want the last tile; and, in 100 hosted matches, every person's own screen after every pass | 20 |
| `test_browser_copy.py` | Real Chromium: on a plain-http network address (no clipboard API) Copy link copies the link (read back from the real clipboard), says "Copied", leaves nothing behind; the same on localhost; no Copy code button | 9 |
| `test_online_talk_more` | The hosted computer's talk, rule by rule and end to end: when it may speak (a beat after a move, a 7-second cooldown that is each person's own, the kinds that always get through, never to the computer's seat, nothing left on the clock when the match ends); the page receiving a comment (escaped, a real language with a translation, never an inherited property such as `constructor`, cut to 160 characters, empty or non-text ignored, fades in once, the Comments switch); and through the real server with a clock the test controls, in both the Lord of the Rings and classic themes, including a player dropping and returning mid-wait and a paused game | 54 |
| `test_browser_talk.py` | Real Chromium, a hosted game with a computer character in each theme: it speaks to both people after a long think, in its own name, beside that theme's own markers (rings or toy trains), and the Comments switch takes the bubble away | 13 |
| `test_theme_online` | The theme in online games: the server's settings (creating with it, changing it in the lobby, a new level keeping it, unknown themes ignored, only the host may change it, no computer with a person's name), the Host screen's Theme choice, whole online games with a computer character and golden rings on both screens, the guest seeing a switch at once, Classic online games unchanged | 37 |
| `test_online_talk` | The online computer player's comments: whole matches where every comment is checked against the speaker's own lines, comments go only to the person they are about, the slow-player jabs (timing, getting ruder, hunger for its own food, stopping when you act, silence while paused), a classic player's native language, no comments without a computer, the same game whether it talks or not, and the real server and page (bubbles, the Comments switch) | 25 |
| `test_turn_sound` | The turn sound as numbers (pitch, length, no clicks, unlike the domino click), its audio plumbing, and when it plays: once per turn, not once per prompt | 53 |

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
- **Two or three players.** The rules engine seats two players (you and the computer, or two people online) or three (two people and a computer, online only). There is no hot-seat second human on one screen, and no more than three at the table. (Against the computer you can play one or two computers; online it is two people with an optional computer.)
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
- **More than three players**, or two people sharing a screen. (Three at the table is done, as two people and a computer, online.)
- **Online play over the internet without port forwarding.** (The server does not look up its public address.)
- **The computer commenting online**, as it does in the game against the computer.

---

## License

No license has been chosen yet. Until one is added, all rights are reserved by default. A permissive license such as MIT would be a natural fit for a project like this; add a `LICENSE` file and update this section.
