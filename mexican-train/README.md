# Mexican Train

A single-file, browser-based **Mexican Train** domino game (double-12 set) for one player against a computer opponent, with four skill levels, a talkative opponent, and a lot of polish on how it looks and sounds.

- **One file, no dependencies.** The whole game is a self-contained HTML page (about 160 KB) with no libraries, no fonts, no images, no audio files and no network requests. Tile art is inline SVG and the tile click is synthesized with Web Audio.
- **Plays offline.** Open `mexican-train.html` in a modern browser. That's it.
- **Heavily tested.** About 170,000 automated checks run in Node with no browser (see [Testing](#testing)).

> **Status:** playable and feature-rich, but so far tested only through Node-based simulations and fake DOMs. It has not yet had a systematic pass in real browsers. See [Known limitations](#known-limitations).

---


## Running all the tests

`./run_tests.sh` runs every test one at a time (Node suites, then the real-browser suites if Playwright is installed: `pip3 install playwright && python3 -m playwright install chromium`), prints one line per suite and writes `test-report-<date>/report.txt` (a summary, plus the last 60 lines of every failing suite) and `test-report-<date>/screenshots/`. Send me `report.txt`. Options: `--node-only`, `--browser-only`, or a word to pick suites (`./run_tests.sh four`). It needs only node, python3 and perl (all on a Mac); the whole run takes a while, so start it and leave it.

## Contents

1. [Quick start](#quick-start)
2. [How to play](#how-to-play)
3. [Controls](#controls)
4. [Settings](#settings)
5. [The computer opponent](#the-computer-opponent)
6. [Playing online](#playing-online)
7. [The game log (for debugging)](#the-game-log-for-debugging)
8. [Look, feel and sound](#look-feel-and-sound)
9. [Accessibility](#accessibility)
10. [Project layout and building](#project-layout-and-building)
11. [How the code is organized](#how-the-code-is-organized)
12. [Testing](#testing)
13. [The terminal version](#the-terminal-version)
14. [Known limitations](#known-limitations)
15. [Ideas under consideration](#ideas-under-consideration)
16. [License](#license)

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
- The computer builds too, but **its tiles stay face down** until it finishes. (Its doubles are shown standing across the train even while face down.) **The back of a domino is the same off-white (cream) as the face of a blank tile, `#f6f0e0`, with no line and no dot on it** (a soft shadow tells the tiles apart): in a train, in the opponent's row, and in the boneyard's stack.
- **The computer changes its mind while it builds.** It lays a tile, sometimes takes the last one back (one at a time, with a click, and its train gets shorter on your screen), lays one again, and goes on until it finally finishes. **Easy does it most, then Medium, then Hard, then Expert** (taking tiles back per opening, on average with 15-tile hands: Easy about 2.4, Medium 1.9, Hard 0.9, Expert 0.3). Never twice running, and each level has a limit per opening (5, 3, 2, 1). It is the same plan carried out with second thoughts on the way: **Medium, Hard and Expert finish with exactly the train they would have built without them**, and Easy's is no shorter. The choice is made from the position itself (its hand, its train and how many it has taken back), not from the game's random numbers, so the same position always gives the same answer and the deals and everything else decided by random numbers are undisturbed. A take-back has its own quick wait (0.4 to 1.4 seconds) and so does laying a tile straight after one (0.42 to 1.5 seconds), instead of the longer think before a first tile. A hosted game's computer does the same, and both people are shown it.
- **Done** is not allowed while your train ends on an uncovered double. Cover it or take it back.
- If nothing in your hand fits the engine, you draw one tile. If it still doesn't fit, you pass and a toy train marker goes on your train.
- Using up **every tile** in the opening wins the round on the spot. If both players do it, the round is a tie.

### Normal turns

Play one tile that matches the number a train needs onto one of:

- your own train,
- the **Mexican train**, or
- the **computer's train, but only if it has a toy train marker on it**.

Each train has its own row. A row shows the train's name and, when the train is open, "Open: ... can play here". It does not say which number the train needs: that is the number on its last tile.

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
| **Your hand is a row of slots** | When you play a tile, **its slot is left empty** (a faint dashed outline) and nothing else in your hand moves: the tiles do not close up or re-wrap as the hand shrinks. A tile you draw goes into the **first empty slot** (at the end when there is none), and a tile you take back (Undo in the opening) returns to **its own slot**. A new round deals a fresh hand, heaviest tiles first, with no gaps. |
| **Rearrange your hand** | Drag a tile to any slot, in any row: **into an empty slot** and it moves there, leaving the slot it came from empty; **onto a tile** and the two swap places. **Nothing in the hand moves while you drag**; the tile only takes its new place (a swap, or a move into an empty slot) when you let go of it over that slot. There is no Sort button. |
| **Move a tile with the keyboard** | Focus it, then **Shift + Left/Right arrow**: one slot at a time, into an empty slot or swapping with the tile there. |
| **Turn a tile around** | **Double-click** a tile (or double-tap it; or focus it and press **R**): it turns 180 degrees in your hand. The game then leaves it as you turned it: its own idea of which way round the like halves should face no longer applies to that tile (it still turns the *other* tiles to face it). A double looks the same either way up, so it does nothing. A double-click is not a pick-up: a tile you had picked up stays picked up, and one you had not stays down. **With hints on, a mouse click or tap on a tile that would be played at once (it has only one place to go) waits about a quarter of a second (280 ms) to see whether a second click follows**; a click from the keyboard, or with hints off (where a click only picks the tile up), does not wait. A click on a different tile in that moment plays the first one. Turned tiles are forgotten when a new round starts. |
| **Like halves face each other** | When two tiles lie **side by side** in your hand and have a number in common, one of them is drawn the other way round so that the like halves touch (a 3\|5 beside a 3\|7 becomes 5\|3 beside 3\|7; 2\|3, 4\|3 and 4\|5 line up as 2\|3 3\|4 4\|5). It only changes how a tile *looks*: playing it does not depend on it. It makes the most facing pairs there can be in each row (a tile has only one 3, so it can face a 3 on only one of its two sides), turning as few tiles as possible, and a tile is **not turned back** just because its neighbour has been played. Tiles with an empty slot between them, or in different rows, are not side by side. Which tiles are in a row is read from how the screen really lays the hand out (it wraps to the width of the window: a phone has fewer to a row), and again when the window is resized. While you drag a tile about nothing turns; they turn when you let go. A new round starts with nothing turned. |
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
| Second computer's level | **Easy**, **Medium**, **Hard**, **Expert** (only with two or three computers; each has its own) | Medium |
| Third computer's level | the same (only with three computers) | Medium |
| Theme | **Classic** or **The Lord of the Rings** (see [Themes](#themes)) | Classic |
| Hints | **Allow hints** on / off (see Hints under Look, feel and sound). In an online game it is the host's choice, for everyone | on |
| Sound | on / off (also the Mute button) | on |
| Computer comments | on / off (the Comments button) | on |

---

## The computer opponent

### One computer, or two

Choose **Two computer players** (three at the table) or **Three computer players** (four at the table, the most there can be) and you play against that many computers at once, each with **its own skill**: an Easy and a Hard one, say, or two of the same. They get different names from the lists for their own skill, play at their own skill (an Easy computer builds short trains, a Hard one long ones), and the header says which is which ("Computers: Easy and Hard", or "Computers: Easy, Medium and Hard"). The turns go round the table and who plays first rotates every round; a marker on a train lets *both* of the others play there; and the usual tie rules apply (two players who go out together tie, a blocked round goes to the lowest hand, and the final can be "A tie between ..."). Their comments are spoken by one computer at a time, in its own voice: during one long wait the same computer does all the "you are taking too long" jabs, getting ruder.

### Four skill levels

| Level | How it plays |
|---|---|
| **Easy** | Plays a random legal move a good share of the time and builds short opening trains (about 2 tiles on average). |
| **Medium** | A sensible heuristic: heavy tiles first, prefers its own train, covers doubles it can follow up, and builds the longest possible opening train. |
| **Hard** | Medium plus true pip counting (0-0 costs 50), a **lookahead** that keeps long chains buildable, and **a rule against leaving you a play**: it estimates the chance that the other player holds a tile for each end they could play on after its move, and avoids moves that leave them one. It reads the table the way anyone could: the tiles on the trains and in its own hand tell it which numbers are finished, and when a player has had to pass, everybody knows they hold no tile for the ends they could have played on (until they draw again). |
| **Expert** | Hard, and it also **thinks several moves ahead**: it takes its five best-looking moves, guesses 16 times at what the other player and the boneyard hold (always consistent with the tiles it can see and with what passes have shown), plays each move out to the end of the round with Hard on every side, and chooses the move that works out best on average. It does this when it plays **one other player**; at a table of three or four (two or three computers, or a hosted game with a computer) it plays like Hard, because the look-ahead was measured to help only against one opponent. A decision takes about 20 milliseconds. |

Measured with the real engine, every deal played twice with the seats swapped (`t/sim_levels.js` runs the full study; `t/test_expert_strength.js` checks the main results):

| Matchup | Result |
|---|---|
| Hard (before the new rule) vs Medium | 54.7% to 44.0% of rounds (1,400 rounds) |
| **New Hard vs old Hard**, two players, 15 / 12 / 8 tiles | 51.6 / 51.0 / 51.1% to 47.6 / 48.4 / 48.4% (16,000 rounds each), about 2 pips fewer left per round |
| New Hard vs old Hard at a three-player table | 34.2% of the rounds against a fair share of 33.3% (15,000 rounds) |
| **Expert vs new Hard**, two players | 53.5% to 46.3% (1,040 rounds); 53.7% to 45.8% in the repeat in the test suite |
| Expert at a three-player table | no better than Hard (30.6% and 33.1% of the rounds in two tries, against a fair 33.3%), so it plays as Hard there |
| Medium vs Easy | 60.6% to 38.3% |
| Hard (before the new rule) vs Easy | 67.2% to 31.9% |
| Easy vs a purely random player | 56.6% to 42.3% |

(The game has a lot of luck, so each step up is real but modest. The new rule helps almost entirely when the other player's own train is marked: they have been unable to play, and leaving them an end they can use hands them a way out. The rule was first tuned on one batch of deals; the figures above are from fresh deals. Hard's comments about a human's moves still rate them with the plain evaluation, so Hard itself is rated "poor" a little more often than before.)

### Pacing like a person

Every tile the computer places waits a random **0.5 to 4 seconds**. The exceptions are covers: when a double is open and the computer holds a tile that covers it, it plays it **immediately**, with no thinking time.

### Names, tags and voices

- There are **48 computer players**: 16 Easy, 16 Medium, 8 Hard and 8 Expert (the old 16 Hard names are shared out between the last two: Ingrid, Dmitri, Arjun, Kwame, Tariq, Elsa, Diego and Stefan stay Hard; Chiara, Amara, Leon, Odile, Rafael, Kenji, Selam and Paloma are the Experts). Each name always plays at one level, and the level is shown as a colored tag next to the name. The name is drawn from the pool for the level you chose.
- **Each level has its own voice.** Easy is a flustered beginner, Medium is sassy, and Hard is smug and exact; the Expert talks like Hard. Easy, Medium and Hard each have their own full set of lines (no line is shared).

### It talks about your play

- **The computer cannot see the tiles in your hand that are not on the table.** It knows what you can see of a player: how many tiles you hold, every tile on the table, what your passes and draws showed (a player who passes has no tile for the open ends, which everybody saw), and so which tiles it has not seen (yours and the boneyard's, which it cannot tell apart). Hard and Expert reason from that (the chance that you hold a tile it could be giving you; the Expert guesses at your hand 16 times, each guess consistent with what your passes showed); Easy and Medium use only their own hand and the table. This is **tested**, not just read: `test_hidden_hand` takes thousands of real positions and **swaps your hand with other tiles from the boneyard** (which the computer cannot tell apart) and the decision of every level, in the opening and in normal turns, at a table of two and of three, never changes (0 of 619 and 444 decisions at each of Easy, Medium and Hard, 110 at Expert, 673 in the opening at every level); a computer that really looked at your hand is shown to decide differently in about a third of the positions, so the test would notice; and planting a peek in the real code (in the denial calculation, the Expert's guesses, the count of unseen tiles, Normal's or Easy's scoring, or the opening) makes it fail every time. (In a hosted game the server runs the same code, and nobody is ever sent a tile they should not see.) **The one place the code does look at your real hand is the commentary:** the remarks on your moves (great, good, poor, awful, a missed chance to go out) are judged against the moves you really had. That cannot influence how the computer plays (the commentary is separate and uses its own random numbers), but it is a use of your hand, and you can switch the comments off with the **Comments** button.
- It **rates each of your moves** against the best available one using the Hard evaluation (great, good, poor, awful, or a missed chance to go out) and sometimes comments, with a cooldown so it isn't constant. **It never remarks that a move was your only one** (or forced, or that you had no choice): it cannot see your hand, so it does not know. A move that was the only legal one earns no remark at all, however it scores.
- **It notices when you try a move that is not allowed** (dropping a tile on a train it cannot go on, or tapping a tile that does not fit) and remarks on it, in its own voice, with the usual cooldown. This works in hosted games too (the server is told of the attempt and the computer answers that person only). Nothing is said with Comments off or when it is not your turn. `test_invalid_try` covers it.
- It reacts to your **draws, passes and opening trains** (including quoting how many tiles you built versus how many you could have).
- **It grumbles about its own luck**, each in its own voice, about things it can know (its own hand and what is on the table, never yours): **nothing fits and it must draw** (`ownDraw`), **it keeps drawing the wrong tile** turn after turn (`ownDrawAgain`, more readily than the first), **it cannot play and cannot draw so it passes** (`ownBlocked`), **its opening train is very short** (one or two tiles; it can say how many: `ownShort`), and **the round is blocked** (`roundBlocked`). It does not grumble about drawing or passing only to cover its last double. The count of bad draws restarts when it plays a tile (and when the opening ends). The very short train and the blocked round always get through the cooldown; the others take their turn. With two computers, the one it happened to speaks. In a hosted game the computer says it once, to everyone at the table, so they all hear the same words; with no computer nothing is said. Easy is a clumsy, cheerful beginner, Medium is sarcastic, Hard is cold and annoyed (Expert speaks like Hard); the players with a native language say these in it, with a translation; and each of the 14 Lord of the Rings characters has lines of their own (none shared with another character, none generic).
- **If you take too long**, it taunts you after 25 seconds, then again every 20 to 26 seconds, getting ruder each time.
- The tone is cheeky and rude in a game-night way, with mild language. A blocklist test checks that every line stays that way. The **Comments** button turns it all off.
- Comments never affect the game: a game plays out identically with comments on or off.

### Players with foreign names

- **17 players speak in their own script**, sometimes (about 40% of their comments), with an English translation underneath: Russian (Dmitri), Japanese (Keiko, Hiro, Kenji), Chinese (Mei, Wen), Korean (Joon), Hindi (Ravi, Priya, Arjun, Anil, Sunita) and Arabic (Omar, Aisha, Zainab, Tariq, Noor). Arabic is shown right to left.
- **All 48 players have a home country and three dishes from it.** While you dither they may announce they are hungry and go off to get one, escalating from peckish, to off to get it, to back and finished it. They keep the same dish through a wait. Players with a native language say this in it too, with the dish in its own script.

### Themes

The **Theme** setting swaps the classic computer players for a cast of characters. There is one so far, **The Lord of the Rings**:

- **14 characters, each at a fixed level.** Easy: Pippin, Merry, Gollum, Treebeard. Medium: Frodo, Sam, Gimli, Legolas, Boromir. Hard: Aragorn, Elrond. Expert: Gandalf, Galadriel, Saruman. (Two computers can sit at one table, so two characters per level is the least that works.) They play exactly like any other computer player of their level; only who they are changes.
- **Each character has their own voice**, with a full set of lines for every kind of comment (448 lines in all): Gollum hisses about tricksy moves, Treebeard thinks everything is hasty, Gimli swears by his beard, Saruman is smug about your mistakes. The lines are original, written in each character's spirit rather than quoted from the books or films.
- **They get hungry for their own food** while you dither: Sam for rabbit stew, Gollum for raw fish, Treebeard for Ent-draught.
- **An open train is marked with a golden ring** instead of a toy train, and the header says *Double-12 in Middle-earth*.
- **The board has scenery behind it:** distant mountains across the top, a very faint golden ring in the middle, and rolling hills with a line of trees along the bottom. It is original artwork (plain shapes: no text, no scripts, nothing taken from any book or film), applies to hosted games as well as games against the computer, and is **designed not to make the board harder to read**. The one rule it is drawn by: **nothing in it is brighter than the classic felt's brightest point**, so every piece of text on the board has at least the contrast it has in the classic theme. It is made of dark silhouettes, a soft glow and a ring that stay under that limit (the glow and the ring add at most about 0.015 of luminance, and are most of the way to invisible), and it fades out rather than ending in a hard edge. It is measured, not just judged by eye: on the drawn pixels, at four screen sizes, the brightest background pixel is 0.064 to 0.073 (relative luminance) against 0.085 for the classic board, and the same texts have a worst-case contrast of 5.4:1 to 5.8:1 against it, against 4.9:1 on the classic board (one extra faded text on a phone: 3.9:1 against 3.5:1). The scenery is switched off for anyone who has asked their system for **more contrast** (`prefers-contrast: more`), who gets the plain board. The pictures are `art/lotr-top.svg`, `art/lotr-ring.svg` and `art/lotr-bottom.svg`, drawn by `art/make_lotr_art.py` (run it, then `python3 build.py`, to change them), inlined into the page by the build (still one file, nothing to fetch), and covered by the page's version stamp.
- **Online too.** The host picks the theme on the Host screen. It applies to the whole online game: the computer player (if there is one) is a character of its level, and an open train wears the golden ring on everyone's screen. The guest's lobby says which theme was chosen. The server sends the theme with the other settings (`settings.theme`, `classic` or `lotr`) and ignores anything else.

Themes live in `THEMES` in `game.js`: a theme lists its characters by level, their lines (`voices`), their food (`food`) and how they say they are hungry (`foodLines`). Adding another theme means adding another entry; the setup screen lists it automatically.

---

## Playing online

Two or three people can play each other over a network (with up to two computers, never more than four players in all). One of you runs a small game server on their own computer; everyone plays in an ordinary browser. There is no account, no website and nothing to install for the others.


### The end of a game

Between rounds, each person presses the button on the round-end dialog and the next round starts once **both** have, because the next round needs both of them. After the **last** round there is nothing left to start, so nobody waits: whoever presses **See final score** gets the final score at once, even if the other person has not pressed theirs yet (that person still has their own dialog, and gets their own score when they press it). Someone who has seen the final score may go back to the menu or close the page straight away: the game is not treated as abandoned, there is no pause, and the other person is told they have gone and can still press their button and see the final score. (Someone who leaves *before* pressing the button, or at the end of any round but the last, still ends the game for the other person, as before.)

### What you need

- **The host** needs [Node.js](https://nodejs.org) (developed and tested on Node 22; the code uses nothing newer than Node 14, but that is untested) and these seven files in one folder: `server.js`, `ws-lite.js`, `online-match.js`, `history.js`, `gamelog.js`, `game.js` and `mexican-train.html`. There are no packages to install.
- **The guests** need only a browser and the host's address.

### Hosting

```bash
node server.js                  # listen on port 8080, on every network interface
node server.js --port 3000      # another port
node server.js --local-only     # only this computer may connect (for trying it out)
node server.js --no-public-ip   # never ask an internet service what this computer's public address is
node server.js --name table1    # a label of your choice, to tell this server from other processes (see below)
node server.js --games-dir DIR  # keep the log of every game in DIR instead of games/ (see "The game log")
node server.js --no-game-log    # keep no log of the games
node server.js --help
```

**Telling the server from other processes.** The server renames itself, so that in `ps -ef` (or `top`, `htop`, Activity Monitor, `pgrep -f`) it is not just `node` but `mexican-train-server :8080` (with the port it is really listening on), or `mexican-train-server table1 :8080` if you started it with `--name table1`. Find it with `ps -ef | grep mexican-train-server`, or one of several with `pgrep -f "mexican-train-server table1"`; stop it with `pkill -f mexican-train-server`. The label may have 1 to 40 letters, digits, dots, dashes, underscores or colons (no spaces). The server prints its process name when it starts. **Note:** because the process is renamed, the original command line (`node server.js ...`) is no longer what `ps` shows, so `pkill -f server.js` and the like no longer match it: search for `mexican-train-server` instead. On Windows the title is that of the console window.

The server prints the address to open, for example:

```
  Open  http://192.168.1.23:8080  in your browser to host a game.
  The other player opens the same address to join.
```

That is this computer's address on your network, never `localhost` (home and office addresses, 192.168.x.x, 10.x.x.x or 172.16-31.x.x, are preferred when there are several; the others are listed under it). Open it in your own browser, press **Host online game**, and pick the game length. The Host screen offers it as the first of **three ways for the other player to join** (below). The server tells the page what it is (through `/info`) and the page shows it as the way to join *on this network*, but **the host's own page connects to the address it was loaded from**, which always works, whichever way the host got there (the local address, the public one, a forwarded port, a name): the addresses the server reports are for the OTHER players, and may not be reachable from the host's own window. Nothing typed on the Host screen changes where the host's page connects. A page opened from a file (no address it came from) has only the server's reported address to use, and if it was not opened from the game server at all it says so and offers no Create button. A server started with `--local-only` has no network address and shows `127.0.0.1`. You get a **join code** like `K7Q-F2M`. Give the guest the address (the lobby lists every address the server found) and the code. When they have joined, press **Start game**.

**Three people.** The Host screen's **Third player** choice is *None*, a computer of each level, or **Add a third person**. With a third person, three people play: everyone joins with the same join code (the second guest takes the second free seat), the lobby has three places and the host's Start button says how many are still to come (*Waiting for 2 players...*, then *Waiting for a player...*, then *Start game*), and the game starts only when all three are in and connected. A fourth person is told the game already has three players, and who is in it ("That game already has three players (Ann, Ben and Cat)."); someone who comes to a game that has already begun is told it has already started, and the server's console says why anyone was turned away (a game for 2 or 3 people, and who is in it). A guest who leaves or closes the page in the lobby frees their place for the next to join, and the host leaving closes the game. A game for three people can have **one computer as a fourth player** (see *Four players*); never more than four players in all. **A game server that is an older version cannot seat a third person** (a page replaced while the old `node server.js` keeps running looks exactly like the new one, and the old server silently makes a game for two, so the second guest is turned away with "That game already has two players"): the server therefore announces what it can seat in `/info` (`maxHumans: 3`), the Host screen does not let you ask a server that says nothing for a third person (the choice is greyed, with a note to stop the server, start it again from the new files and reload the page), and if a game for three is asked for and the answer says two, the game is closed again at once with the same advice. After replacing the files, **restart the server** and **reload the page in the browser**: a tab that was open before keeps running the old page.

**Playing again.** After the final score of a hosted game the dialog offers **Play again** as well as **Back to the menu**. Anyone who has seen their final score can ask (even while the others are still at their last-round dialog); everyone is told who has asked (\"Ann wants to play again.\", \"Ann and Ben want to play again.\") and the person who asked sees who they are waiting for. When **every person at the table** has asked, a new game starts at once with the same people in the same seats, the same settings (rounds, hand size, theme, hints) and the same computer player, with a new deal; nothing carries over from the finished game, and it can be played again and again. A computer player never needs asking. If anyone leaves, or closes their page, after the final score, nobody can play again and the others are told (\"Cat has left, so there is nobody to play again with.\"): there is only Back to the menu. The server refuses a request from someone who has not yet seen their final score. A game against the computer on your own computer has always had its own **Play again**.

**The tab icon.** The page has a small icon for the browser tab, the same for every theme (a generic Mexican Train game, not the Lord of the Rings one): a bone-coloured domino with a brass divider and four big pips on the game's felt green, in the game's own colours, kept to a few large shapes so it can be told apart at 16 pixels. It is `art/favicon.svg` (what Chrome, Edge and Firefox use), with `art/favicon-32.png` (for a browser that takes no SVG icon) and `art/favicon-180.png` (the icon of the page when it is added to a phone's home screen), drawn by `art/make_favicon.py` (it needs Playwright, only to draw the two PNGs; the files are committed). They are inlined into the page's head by the build, so the page is still one file and the browser asks for nothing, and they are covered by the page's version stamp. The page also sets `theme-color` to its own dark green for a phone's browser bar. At 16 pixels, measured in Chromium: the four pips are four separate dots, the tile takes about half of the icon and the felt about a third, they contrast at 6.8:1, and the icon shows on both a light and a dark tab strip.

**Which version of the page.** `build.py` stamps the page it builds with a short build id (a hash of the template, the stylesheet and the game code; `window.MT_BUILD` in the page). The page sends it when it creates or joins a game, and `node server.js` (which serves that very file, and notices when it is replaced) turns away a page that is not the one it serves, with "The game page you are using is out of date. Reload it (Ctrl+F5, or Cmd+Shift+R on a Mac) and try again." (a page from before there were stamps has none, so it is turned away too, which is exactly the old tab left open after the files were replaced). It does this before looking at anything else, so an old page learns nothing about which games exist. A page that is behind its server also says so on the Host screen (Create game is not available until it is reloaded), and joining or hosting is never refused for a page the server cannot compare (no stamp in the file it serves). Coming back to a game already in progress needs no version. `/info` reports the build, and so does the server's start-up banner (`Serving the game page, build 1b4715a15d.`), so you can see which version of the page a running server has. The server's console now also says how each game was made (`game CJP-CYZ created by hosty: three people, 4 rounds of 15 tiles`, or `two people`, or `two people and a hard computer`) and why a page or a person was turned away. A lobby says whether it is a game for two or three people. Each person sees the other two as opponent rows, in seat order after themselves (Ben sees Cat, then Ann), each with a connection dot; the shared Mexican train says it is open to all players; every player's toy train has the same colour (by seat) on every screen. Between rounds the next one starts when **all three** have pressed their button; after the last round each person has the final score as soon as they press theirs. If anyone's connection drops for more than 8 seconds the game is paused for everybody, and the pause dialog names whoever is gone (with two gone it names both) and shows the time left; the game goes on only when **all** of them are back, and if one does not return in time, or anyone leaves, the game ends for everyone and says who. A message you send with **Say something** goes to both of the others, and the server stamps whom it is from, so each sees it in the sender's name.

**A computer player.** When the host creates the game, they can add a computer as a **third player** (on the Host screen: the first choice is **None**, then Easy, Medium, Hard or Expert; at a table of three the Expert plays like Hard) (the same players and skill as in the game against the computer). All three are at the table from the start, and each person sees the other person and the computer as two opponents, each with a row of face-down tiles and a train. The computer runs on the server, so the server must stay up for the whole game; it thinks for the same human-like pause as in the single-player game and plays a tile that covers an open double at once.

**Four players.** A table can have four players, you and three computers on one page, or online. **On this page** the setup screen's *Computer players* is *One*, *Two* or *Three*, and each computer has its own skill (*Computer skill*, *Second computer's skill*, *Third computer's skill*); the three get different names, three opponent rows, a train and a colour each, and the header says *Computers: Easy, Medium and Hard*. **Online** the Host screen has a **Fourth player** choice below *Third player*: it is a computer, it is available only once a third player has been chosen, and it makes either *two people and two computers* (third player a computer) or *three people and a computer* (third player a person). Never more than four players in all: the server drops a second computer from a game for three people, ignores a second computer when there is no first, and `/info` says `maxPlayers: 4` (a server that does not is an older version: the Fourth player choice is greyed with a note, and if a fourth player was asked for and the answer has none, the game is closed at once with the same advice). The computers take the last seats, so the people keep seats 0 to 2. At a table of four the Expert plays like Hard, and everything else (the deal, the opening, markers, an open double, ties, blocked rounds) is as at a table of three, with everyone's own train open to all the others when it has a marker. Each person sees the others as up to three opponent rows, in seat order after themselves. Only the first computer talks online. The game log and its checker accept two to four players.

**The rules with three players** are the usual ones. Everyone has a train of their own and there is the shared Mexican train; a marker on someone's train lets *both* of the others play on it. The turns go round the table, and who starts changes every round. All three build their opening trains at the same time. An open double must be covered by whoever is next able to, and the players who cannot pass and get a marker. A double as someone's last tile cannot go out: if it is then covered, its owner has gone out, and if the player who covers it also plays their last tile, those two tie (as do any players who are out together in the opening). A blocked round goes to the lowest hand; if two or three share the lowest, nobody wins it. Lowest total wins the game, and a shared lowest is "A tie between ...".

**There is nothing to fill in after Create game.** Everything is chosen on the Host screen (game length, tiles each, computer player, theme, whether hints are allowed). The lobby that follows has no inputs: it shows the join code, the QR code and link, who has joined, a one-line summary of how the game was set up, **Leave**, and **Start game** (which waits for the other player). The join code is only shown there; once the game starts, the header just says "Online game".

The lobby also shows a **QR code** for the join link, for example `http://192.168.1.23:8080/?join=K7QF2M`, with a **Copy link** button under it. A phone on the same network can scan it and lands on the Join screen with the server address and the code already filled in, so it only has to type a name and tap Join. If the computer has more than one network address (Wi-Fi and a VPN, say), each one gets a **Show QR** button and the QR code shows one at a time. The QR code and link use the way to join the host chose on the Host screen (below); the other addresses are listed with their own **Show QR** buttons, each marked *on this network*, *over the internet* or *typed by you*. **Copy link** works even though the game is served over plain `http` on the local network, where browsers do not provide the clipboard API: it selects the link in a hidden box and copies that, falls back to the clipboard API if that fails, and if nothing can copy it says "Not copied: select the link above and copy it" instead of doing nothing. (The join code is shown large beside it; there is no separate Copy code button.)

**"Listening on the whole network"** means the server accepts connections on every network interface the computer has (Wi-Fi, Ethernet, VPN), not only from the same machine, so another computer can connect to `your-ip:8080`. That is the default, because the point is to let someone else join. `--local-only` restricts it to the host machine. Your operating system's firewall may ask whether to allow Node.js: allow it on private networks.

### Joining

Either scan the host's QR code (or open the link it contains), which fills in everything but your name; or open the host's address in a browser (`http://192.168.1.23:8080`), press **Join online game** and enter the code; or open any saved copy of `mexican-train.html`, press **Join online game**, and type the address as well as the code. The address may be written as `192.168.1.23:8080`, `192.168.1.23` (port 8080 is assumed) or pasted as a full `http://...` link.

### How the other player joins: this network, the internet, or an address you type

The Host screen asks **How will the others join?** and offers three choices:

- **On this network:** the server's local address (as above). For players on the same Wi-Fi or network. This is the default.
- **Over the internet:** this computer's **public address** with the server's port, for players on other networks. The server finds it by asking a public "what is my address" service (`api.ipify.org`, then `checkip.amazonaws.com`, then `icanhazip.com`: the first that answers). Until the answer arrives (a few seconds) the choice says it is looking and cannot be picked; if nothing answers (no internet, or the lookup is blocked) it says so and stays unavailable. The answer is accepted only if it is a plain public IPv4 address (not a private, loopback, link-local, carrier-grade-NAT, multicast or reserved one, and nothing else in the reply), and the reply is limited to a few bytes and a time limit. **Your router must forward that port to this computer** for it to work, and it will not work behind carrier-grade NAT (some mobile and cable providers): the server cannot check that the address is reachable from outside, it only reports what the service saw.
- **Type an address:** an IP address (or a name) and a port, such as `203.0.113.9:8080`, for a router that forwards a *different* port to this computer, or a name you have for it. With no port typed, the server's own port is used. An entry that is not an address is refused, with the reason, and what was typed stays on the screen.

Whatever is chosen decides which address the lobby shows first (QR code, link and Copy link); the other addresses are listed under it. **The lookup contacts a third party and tells it this computer's public address** (that is what such a service is for), so it is done only when the Host screen is opened (every time someone clicks **Host online game**, because a public address can change), never when the server starts or while a game is running. An answer is reused for no more than 5 seconds (a failure too), so a double click, or anyone asking over and over, cannot make the server ask the service over and over, and it can be switched off for good with `node server.js --no-public-ip`: the internet choice then says it is not offered, and typing an address still works. When the public address turns up while the host is already typing a name or an address, only that one choice changes: nothing typed is touched.

### Over the internet

On the same network (home Wi-Fi, an office) it just works. Over the internet the guest has to be able to reach the host's computer: forward the port on the host's router to the computer running the server, or put both computers on a VPN (Tailscale, ZeroTier and similar), or use a tunnel service. The connection is plain HTTP and WebSocket, **not encrypted**, which is fine on a home network or a VPN. The page must be opened over `http://` (or from a file): a browser will not let an `https://` page connect to a plain `ws://` server.

### During a game

- Everything works as in the game against the computer: tapping, dragging, **Build my longest train**, taking tiles back, the flying tiles and the click sounds. Your opponent's tiles click too. **Build my longest train** lays the tiles down one at a time with a random pause of 0.5 to 3 seconds between them, so the others see the train go down at a person's pace instead of all at once, and then a last pause before the opening is finished for that person (no Done to press).
- **A low, short tone says it is your move.** It sounds when a new turn of yours begins, not for the rest of the same turn (covering your own double, or playing a tile you just drew), not while you build your opening train, and not when the dialogs appear. It is much lower and softer than the high click of a domino, and **Mute** silences it. It plays in online games only.
- **Say something** lets you talk to the other person (or, at a table of three, to both of the others): type a message and press Enter (or Send), or tap one of twelve quick phrases ("Nice play!", "Hurry up!"...). A typed message is plain text on one line, at most 80 characters: control characters, new lines, invisible characters and the ones that flip the direction of text are removed, and spaces are collapsed (by the page, and again by the server). It goes only to the other person (never to the computer player), is shown in a speech bubble in your name, and is always drawn as text, never as markup, so nothing in it can do anything on the other screen. You may send one message every 1.5 seconds and ten a minute; a message that is refused says so, where "You said" would be. The box you type in is kept outside the part of the page that is redrawn on every move (it is made once and only shown or hidden), so the words, the cursor and, on a phone, the keyboard are not lost when the other player moves; it sits at the top of the screen so a phone's keyboard never covers it, Escape closes it (what was typed is kept), and it hides while a dialog is open. The computer player's own comments (with their Comments switch) are separate from this.
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

### Recent games (the server's history)

The server keeps a list of the games played on it in a **SQLite database**, `history.db`, in the games folder (`--games-dir`; `--no-history` switches it off). When a hosted game finishes (or is stopped early, for instance when someone leaves) it is stored with the time it ended, how long it took, the rounds played, each player's name (computers marked with their level), final score and rounds won, and who won (the lowest score; a tie names everyone tied). Only the newest 500 are kept. The database uses the SQLite built into Node (`node:sqlite`, **Node 22.5 or newer**), so there is still nothing to install; on an older Node the list is kept only while the server runs, and the server says so. Open the file with any SQLite tool, e.g. `sqlite3 games/history.db "select * from players"`.

On the **main screen**, **Recent games** shows the last 10, 25, 50 or 100 of them, newest first, with a Refresh button: when, finished or stopped, the winner, and every player's final score. `GET /history?n=25` gives the same list as JSON. It holds names and scores only (no hands, no join codes). The page has to be opened from the server to see it (opened as a file there is nobody to ask, and it says so). Tests: `test_history` (the store, the endpoint, whole hosted games through the real server) and `test_history_page` (the screen).

### How it works

The server (`server.js`) serves the page at `/` and a WebSocket at `/ws`. A small hand-written WebSocket implementation (`ws-lite.js`, RFC 6455, text frames only) avoids any dependency. `online-match.js` runs a match between two seats using the real engine and builds a separate **view** for each player. The page sends **intents** (`play`, `draw`, `done`, `undo`, `autoBuild`, `ok`) and draws the views it is sent; each intent is answered with an `ack` that carries the sequence number of the last state sent before the move was processed, so the page can tell which later states already include its move. Messages are JSON:

| Page to server | Meaning |
|---|---|
| `create`, `join`, `resume` | open a game, join one by code, or take your seat back with the token you were given |
| `settings`, `start` | the host sets the length, hand size, computer player, theme and whether hints are allowed (any of them alone, and `humans`: 2 or 3), and starts. (The page chooses everything on the Host screen when it creates the game and never sends `settings` from the lobby; the server still accepts it from the host, for other clients.) |
| `i` | an intent (`a`: what, `tile`, `train`, and an `id` that comes back in the `ack`) |
| `chat`, `leave`, `ping` | a quick phrase by number or typed text (`{ t: 'chat', text }`), leave, keep-alive |
| `rematch` | ask to play again, once you have seen the final score (see below) |

| Server to page | Meaning |
|---|---|
| `created`, `joined`, `resumed`, `lobby` | you are in; who is here; the settings and the addresses |
| `state` | the full view for this player, plus the events that led to it (so tiles can fly) |
| `presence` | someone dropped or came back, and when the wait runs out: `oppConnected` and `graceUntil` for the others together, and `opps` (each other person's seat, whether they are connected, and their own time left) |
| `again` | who has asked to play again and who has gone: `{ asked: [seats], gone: [seats] }`, sent to everyone after every change |
| `rematch` | a new game is starting with the same people: the page forgets the finished one (the numbering of its updates starts again) |
| `ack`, `error`, `chat`, `ended`, `pong` | answers, a message from another player (`{ text, from }`: `from` is the sender's seat, filled in by the server), the game is over and why |

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

- Two people with up to two computers, or three people with up to one computer: **never more than four players in all**, and no spectators. The computer does not comment on the play online (only the first computer ever speaks).
- Games live in the server's memory: stopping or restarting the server ends every game.
- Tested with real sockets (see Testing), but **not yet in real browsers, on separate computers, or across a real network with a firewall and router**. Treat the first game between two machines as the real test.

---

## The game log (for debugging)

If something in a game looks wrong, there is a record of exactly what happened. **The server writes a log of every game** into the **`games/`** directory next to `server.js` (it is made when the server starts, if it is not there; `--games-dir DIR` puts it elsewhere and `--no-game-log` turns it off). The start-up banner says where the logs go.

**Nothing is written while a round is being played.** The log holds the boneyard and every hand, so a log that grew during a round would show anyone who could read it what the others hold and what will be drawn. Each round's events are kept in memory (on the server, or in the page) and written **together, when the round has ended**: so the file does not even exist until the first round is over, and the second round is not in it until the second round is over. A game that is **stopped or left half way**, or that hits an error, writes the round it was in then (nobody can play on in it, so there is nothing left to give away) with its end, marked `aborted` or `error`. The price: if the server (or the page) is killed in the middle of a round, that round's log is lost.

**What is in a log:** the **boneyard** as dealt (in the order it will be drawn from) and **every player's hand**, then **every domino drawn** and **every play**, in order, with the time of each; also each tile taken back during the opening, each pass, when the opening ends, how each round ended (who went out, the hands and pips left, the totals) and how the game ended. A draw you choose to make while you have a play (hints off) is in it too. One file per game, named for the moment it began (`20261012-143905-local-ab12cd34.jsonl`, or `-hosted-CODE.jsonl` for a game between people), in **JSON Lines** (one event per line, so a game that stops half way still leaves everything up to there). `games/README.md` describes every kind of event.

**Games in the browser against the computer** are played in the page, which cannot write a file, so the page sends the events to the server it was served from (`POST /gamelog`), one round's events at a time, when that round has ended (there is no timer, and **nothing is sent when the page is closed**: a page can come back with the browser's Back button with its game still going, so sending then would let someone read a round that is still being played). The server **accepts them from this computer only** (the loopback address or one of its own network addresses, never anyone else on the network), takes at most 256 KB at a time, accepts only a plain list of events under an id made of letters, digits, `_` and `-` (nothing from the page ever becomes part of a path), and stops a game's file growing at 20 MB. A page that was not served by the game server (opened as a file), or a server that refuses (an older one, or one started with `--no-game-log`), is simply not logged: the first refusal switches the page's logging off and the game goes on as usual. **Games between people** run on the server, which writes their logs itself.

**Checking a log.** `node tools/check_gamelog.js games/FILE.jsonl` **replays** it and says whether it adds up: every round starts with all 90 tiles of the double-12 set (all but the engine) exactly once; every tile drawn is the top of the boneyard (and the number left is right); every tile played is one that player held, goes on a train they may play on (their own; in the opening only their own; later the Mexican train or one with a marker) and fits its end; a tile taken back is the last one laid; a pass puts a marker on; and at the end of each round the hands left, their pips and the totals agree. A log that does not add up points at the first event that does not (exit status 1). Add `--print` to read the game as a transcript. (It checks that what is written could have happened, not that a move was wise, and it does not know the rules about doubles. The 0-0 tile counts 50 pips there, as in the game.)

**Things to know.** The logs hold **every hand, the computer's and the other player's too**: they stay on this computer's disk and nothing is sent anywhere else, but do not post one if the hands matter. They are not deleted (do that whenever you like; `games/.gitignore` keeps them out of the repository). Chat, the computer's comments, hints, selecting and rotating tiles, and the pace of the animations are **not** recorded: only the moves of the game. Logging never stops a game: if the disk fails the log switches itself off and the server says so once. Test servers keep no log unless asked (`gameLog: true`), so running the tests writes nothing to `games/`.

Someone could still look at the computer's hand another way (the page's own memory, for one, in a browser's developer tools), as with any game played in a browser: this keeps the *log files* from being a window onto a round in progress, which is what a log that is written as it goes would be.

---

## Look, feel and sound

**Markers are toy trains.** When a player passes, a small toy locomotive appears at the far left of their train to show it is open, as the colored train pieces do in the physical game. It is glossy and 3D-looking but a single color per player. The color belongs to the **seat**, so every screen shows the same colors: online, the host is red, the second person blue and the computer yellow (a fourth seat is green); against the computer, you are red and it is blue. Each train is lighter on top, darker underneath, with a white shine, all shades of that one color. It is about 52 x 34 pixels, with two wheels whose upper halves are hidden behind the body. It stays at the left edge as a long train scrolls past underneath it, never catches a click, and the "Open: ... can play here" note says the same in words. The Mexican train, which is always open, has none.

**Hints.** The main screen has an **Allow hints** switch (on by default). With it off, nothing highlights the tiles you can play or the trains they can go on, nothing is picked or played for you, and "Build my longest train" is hidden: you pick a tile and then a train, and a wrong guess is refused with a message. **You may also draw even if you have a play** (the game does not refuse a draw because you have one: that refusal would tell you that you do): press **Draw** and a tile comes from the boneyard into your hand, and your turn goes on with the new tile as one more choice. Only **one draw in a turn, of any kind**: if you had nothing to play and drew the ordinary draw, and the tile you drew fits so your turn goes on, you cannot draw again either (you never draw twice without playing in between). **Never while a double has to be covered** (the draw is refused with a message, and the plays on that double are all there is), and not from an empty boneyard. In the opening it is allowed before you put any tile down, and once. With hints on nothing changes: the Draw button only appears when you have nothing to play. With it on, your hand has a **Show hints** button to switch the highlights off and on during a game. The train with an open double to cover is always outlined, and the hand always has its Draw button.

**In an online game the host's choice applies to everyone at the table.** (A draw you did not have to make is accepted by the server on the same terms, and the other person sees "Ann draws a tile" and nothing more: exactly what any draw looks like to them.) The Host screen has an **Allow hints** switch (starting from the host's own main-screen setting), and the lobby afterwards only says whether hints are allowed (there is nothing to change there, for the host or for guests). With hints allowed, each player still has their own **Show hints** button; with them off nobody has one, and nobody is offered **Build my longest train**. The server enforces it as well: with hints off it does not send how long a train could be built, and it refuses a request to build one. Against the computer, the player's own main-screen setting is what counts.

- **Flying tiles.** A tile taken back from a train in the opening flies back into the hand it came from (yours, or the face-down row of a computer or another player), instead of just vanishing. A hand tile you had turned round flies as it is drawn, with no extra half turn. Played tiles fly from where they were (your hand, the spot where you let go of a drag, or the computer's row of face-down tiles) to their place on the train, and turn face up in flight when they become public. Drawn tiles fly from the boneyard into the hand. Nothing flies if your system asks for reduced motion.
- **Trains** scroll themselves to follow the newest tile. There are no scroll bars: a soft fade appears on the left edge when older tiles are out of sight.
- **The boneyard button** is pinned to the top right of the opponent row and never moves or resizes.
- **The end-of-round dialog** shows each player's tiles in the ordinary off-white of the game's tiles (`#f6f0e0`, the same as every other tile face) on the **deep felt green** of the game's own palette (`--felt-deep`), with its writing in the game's bone colour. (On the old cream background the tiles were the very same colour as it, so there was nothing to tell them apart: 1:1; now the tiles stand out at 8.8:1 in the light scheme and 11.9:1 in the dark, the writing likewise, and the small writing is at least 6.4:1.) The pips, middle line and brass pin are as on every tile; your hand and the trains are unchanged, and the final-score dialog keeps its look.
- **The score counts up, tile by tile.** When the **round-end dialog** opens, each player in turn puts their leftover tiles up **one at a time, two a second** (biggest first, each with a click that rises in pitch). Each tile's dots are added to "+N this round" and to the player's total, which starts from what it was before the round and ends exactly on the new total. A short pause, then the next player. The tiles' places are kept from the start, so nothing moves as they appear. The **final score** dialog still counts each total up from nothing. The numbers are changed in place (the dialog is not redrawn, so the button keeps the focus), the button never waits for the count, a screen reader is given the real numbers at once, and with reduced motion there is no count.
- **The game's history.** The messages at the bottom left ("You played 8-9 on Ben's train.", "Priya draws a tile.", ...) are the **whole history of the game**, not just the latest few: the **newest on top**, the oldest further down, in a panel that **scrolls** (mouse wheel or touch; or click it or Tab to it and use the arrow keys, Page Up/Down, Home for the newest and End for the oldest). It is the same size as before (so the layout does not move) and does not pass the scrolling on to the page when it reaches its end. **It is kept from round to round** (the start of each round is in bold with a line above it: "Round 2: the engine is double-11..."); a new game starts a clean history. **Reading it is not interrupted by the game going on:** when the page is drawn again as the game moves, a reader part-way down stays at the same message (the panel is moved down by as much as was added above them), and one at the top keeps seeing each new message as it comes. In a hosted game each update carries the latest 120 lines with their place in the whole history (it does not grow without end) and the page keeps what it has been sent, so the history builds up on each screen (a page that is reloaded or comes back starts with the latest 120 and goes on from there). At most the latest 600 lines are drawn, so the page stays light in a very long game.
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
├── build.py               stitches the three files above into mexican-train.html (and inlines the board's scenery from art/)
├── art/                   the Lord of the Rings board scenery (three small SVGs and the script that draws them) and the tab icon (an SVG, two PNGs and the script that draws them)
├── mexican-train.html     the built, single-file game (generated, but committed so you can just play it)
├── server.js              the online game server (see "Playing online"); no dependencies
├── ws-lite.js             a small WebSocket (RFC 6455) implementation for the server
├── online-match.js        a two-human match run on the server with the real engine, and each player's view
├── gamelog.js             the game log: the games/ directory and the files in it (see "The game log")
├── games/                 the log of every game that is played (made if it is missing; the logs are git-ignored); its README describes the format
├── tools/check_gamelog.js replays a game log and says whether it adds up; --print reads it as a transcript
├── mexican-train.js       the separate, older terminal version (see below)
├── game_v4_rule.js        a frozen reference engine used by test_levels
├── t/sim_levels.js        the strength study: `node t/sim_levels.js <tested> <baseline> <deals> <hand> <2|3 players>`, with oldhard, normal, hard, expert
├── .gitignore
└── t/                     the tests
    ├── test_*.js          the test suites (see below)
    ├── mexican-train.js   a 7-line shim that lets test_rules and test_sim use the browser engine
    ├── game_before_cover.js   a frozen earlier build, used by test_cpu_cover
    ├── game_before_sound.js   a frozen earlier build, used by test_sound
    └── game.js            a copy of ../game.js made by the test command below (git-ignored)
```

Edit `game.js`, `style.css` or `template.html`, then run `python3 build.py`. The build asserts that the code doesn't contain `</script>` or `</style>`, which would break the single-file page, and turns each `url(art:NAME)` in the stylesheet, and each `href="art:NAME.svg"` or `href="art:NAME.png"` in the page's head, into the inlined picture from `art/` (refusing an SVG that contains a script or an address, and a "PNG" that is not one).

Nothing is minified or bundled, so the built file is readable.

**Browser features used:** Pointer Events (mouse, touch and pen dragging), the Web Audio API, the Web Animations API, CSS Grid and custom properties, and `localStorage` (always wrapped in `try/catch`).

---

## How the code is organized

`game.js` is one file in labelled sections:

| Section | What it does |
|---|---|
| **Engine** | Pure game rules: tiles, deals, legal moves, turns, doubles and markers, blocked-round detection, scoring. No UI. |
| **The opening** | The simultaneous opening phase, the exact longest-train search, and the computer's opening play. |
| **Skill levels** | The Easy, Medium, Hard and Expert move choosers (including what a pass reveals, the reading of unseen tiles, and the Expert's look-ahead), and the move-rating function used for comments. |
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
| `test_levels` | Skill levels: Medium is move-for-move identical to the original; every pairing of the four levels plays legally; strength ordering | ~82,500 |
| `test_expert` | The new Hard rule and the Expert: what a pass tells everyone is always true (500 rounds, two and three players); the tiles nobody can see always add up; the chance of holding a tile checked against counting every possible hand; a dead end changes Hard's choice and so does what a pass showed; the Expert returns a legal move, leaves the real game untouched, uses one random number of the game's, is repeatable, plays as Hard at a table of three, and its guesses honour what passes showed; the fourth level in the pools, names, tags and comments | 40 |
| `test_expert_strength` | The new Hard beats the old Hard (15 and 8 tiles, 5,000 rounds each) and the Expert beats Hard (760 rounds); slow, about two minutes | 3 |
| `test_browser_expert.py` | Real Chromium: the four levels in the setup dialog, an Expert decision measured inside the browser (typically well under 80 ms), a whole round played against an Expert, its tag, and the themed Experts and Hard characters (`quick` runs everything but the round, `round` only the round) | 10 + 10 |
| `test_ui` | The whole interface by playing complete matches through the actions | 75,687 |
| `test_boot` | The real built page, run in a sandbox with a fake DOM and audio | 54 |
| `test_fx` | Flying-tile and draw animations, hand dragging, scroll behavior | ~7,100 |
| `test_drag_play` | Dragging a tile onto a train, the no-pause double cover, the fixed boneyard | 53 |
| `test_hand_layout` | The flat multi-row hand, the Draw spot, dropping into rows | 77 |
| `test_wobble` | The computer changing its mind while it builds, on thousands of real openings (15 and 8 tiles): take-backs per opening strictly ordered Easy > Medium > Hard > Expert (and Expert does it a little), never over a level's limit, never two running, every opening finishes and never on an uncovered double, never a take-back followed at once by finishing; **Medium, Hard and Expert finish with exactly the train they would have built without it (in all 600), the game's own random numbers untouched**, Easy's no shorter; the same deal gives the same answer; the train changes by one tile at a time; its pace entries | 26 |
| `test_wobble_games` | In whole games: against the computer (every level: the train changes by one tile at a time, finishes as it ended, the quick take-back wait and the quick re-lay wait for each, a click for each; take-backs per opening ordered by level) and in hosted matches (every take-back shown to both people as an undo of the computer's train, the same waits) | 22 |
| `test_white_tiles` | The back of a tile is one rectangle of exactly the off-white of a blank tile's face (#f6f0e0, not pure white) with nothing else (no outline, dot, line, dashes), still a face-down tile to everything that finds it; the small backs and the boneyard's stack the same colour (the palette's --bone) with no border and a soft shadow; the old teal gone; the end-of-round dialog (pips and numbers) with four ordinary off-white tiles and its own look, and the final dialog, the hand and the trains unchanged; its colours from the game's palette with the contrast of tiles, writing, small writing and focus outline worked out for light and dark | 43 |
| `test_browser_white.py` | Real Chromium, on pixels and computed styles: a face-down tile in a train is at least 99.5% exactly (246, 240, 224), the off-white of a blank tile, with no pure white on it (and one rectangle in its drawing); the small backs and the boneyard's stack the same colour with no border; the end-of-round dialog in both themes: the felt green, tiles of that off-white with no pure white on screen standing out at 7:1, writing 7:1 and small writing 4.5:1, the button as readable as before; and the computer's train getting SHORTER live while it builds, by one tile at a time, with the face-down tiles on screen as many as it has laid | 26 |
| `test_facedown_doubles` | The computer's face-down doubles stand upright | 7 |
| `test_double_ui` | Selection rules and last-tile-double flows through the page | 30 |
| `test_cpu_cover` | The computer's no-delay cover, compared with the previous build | 18 |
| `test_first_turn_win` | Using every tile on your first train, played through the game from a rigged deal | 54 |
| `test_count_up` | The score counting up: the click as numbers (16 ms, never above full scale, starts and ends at exactly nothing, no DC, high and crisp, much shorter and quieter than the clack, the same each time) and played (before unlocking nothing, afterwards each tick with its pitch rising within range); then against a fake clock: the dialog opens at the previous totals with the real ones for a screen reader, nothing for the first 450 ms, one player after another, 35 ms between clicks, 260 ms between players, a player with nothing to add skipped, a big score within 28 clicks and landing exactly, pitch rising to the last click, muted counts in silence, a redraw or the same dialog sent again as a new object does not restart it, a different dialog starts its own, the dialog going away stops it, the final dialog from nothing, reduced motion and switching it off show the real totals at once; **real games** (two and three players, 12 round-end and 3 final dialogs: right start, in order, in range, exact end, one click per step); and the button not waiting | 57 |
| `test_browser_count_up.py` | Real Chromium with the audio replaced by a recorder: the numbers begin at the previous totals, never go down, change one player after another, end on the real totals, a click for each step (about 35 ms apart, pitch within range), changed IN PLACE (the very same elements all through), the focus staying on the button, the number being counted swelling and then not, a screen reader given the real totals; the final dialog counting from nothing, silently when muted; and the button closing the dialog at once in the middle of the count and the clicks stopping | 20 |
| `test_sound` | The synthesized click as numbers (spectrum, timing, two contacts), against the old sound | 43 |
| `test_own_luck` | The computer's remarks about its own luck, and no remark that your move was your only one: no line anywhere (generic, six languages, 14 characters) says it was your only move or that you had no choice, the `forced` kind is gone, a forced move is given no remark whatever it scores; the five new kinds in every voice (three or more distinct short lines per level, only the short-train lines quote a number, the six languages in their own script with a translation, each of the 14 characters with lines of their own, none shared, none generic); and **120 real games** with over 4,600 events in which every remark came on exactly the right event (a bad draw, a run of them, no move, a very short opening train, a blocked round), from the right computer (also with two computers, Easy and Hard), in the voice of its own level or character, and none came otherwise (not for a draw or pass only to cover a last double); the Comments switch, the dice, and the cooldown | 35 |
| `test_own_luck_online` | The same in HOSTED matches (180 whole matches, classic and Lord of the Rings): the right remark on each event derived from the log the people see, each one reaching BOTH people with the same words in the same order, from the computer character and in its voice, nothing sent to the computer's seat, nothing said in a game of three people, the dice, and the cooldown shared by everybody at the table | 10 |
| `test_chat` | Move rating, thresholds, comment timing, per-level voices, the Comments toggle | 136 |
| `test_native` | Every native-language line is in the right script and translated | ~140 |
| `test_food` | Every player's home country, dishes and hunger remarks | ~200 |
| `test_spelling` | Everything a player can read uses American spelling | 6 |
| `test_ws` | The WebSocket layer over real sockets: handshake, every frame size, fragmentation, every protocol violation and its close code, 600 connections of garbage | 74 |
| `test_online_match` | Whole two-human matches: no hidden tile is ever sent (checked on every message of 36 matches, and shown to catch three injected leaks), both views agree, no tile is lost, every bad intent is refused, rigged first-train wins | 101 |
| `test_server` | The server over real sockets: the page and path tricks, which network address is shown (ranking, `/info`, never localhost), codes and the lobby (including the computer player option), hostile clients, flooding, 12 simultaneous games, whole games with a computer, dropping and returning, the time limit, chat, the heartbeat, the command line | 196 |
| `test_online_client` | The real page logic against the real server, played through the same actions a person triggers: Host and Join screens, lobby, whole games, a rigged first-turn win, chat, reconnecting, the paused screen, reload and resume, a hostile server trying to inject markup, and the turn sound checked against the engine's own record of turns | 137 |
| `test_three_players` | The rules with three players: the deal, who may play where, a marker, an open double travelling past a player who cannot cover it, ties and blocked rounds among three, the three-way opening, and 1,500 simulated rounds with all invariants checked at every play | 37 |
| `test_online_three` | A server-side match with two people and a computer: nothing hidden is ever sent to either person (checked on every message of 30 matches, and shown to catch leaks of the second opponent), both views agree under their different labels, the computer builds and plays by itself, pausing, a rigged win | 37 |
| `test_three_client` | The real page against the real server with a computer player, through the screens: the Computer player option, the lobby, two opponent rows, whole games, each opponent's animations, the turn sound against the engine's record, chat attribution, a dropped connection, a rigged win, a hostile server describing three players | 52 |
| `test_process_name` | The server told from other processes: the title ("mexican-train-server :PORT", with a label "mexican-train-server table1 :PORT"), then real server processes started with and without `--name`, checked with the real `ps`: each shows as expected, a search for the name finds exactly those and not an ordinary Node process, the label picks out one, the renamed server still serves (`/info`, the page) and stops cleanly; and `--name` refuses a space, an empty label, 41 characters, a slash, a semicolon, `$(...)` and a missing value, accepts the allowed ones, and is described by `--help` | 27 |
| `test_draw_anyway` | Hints off: the engine's draw you did not have to make (the tile joins the hand, what the others inferred about that hand is forgotten, refused during an open double and from an empty boneyard), the opening (offered with a tile that fits and nothing down, once, never with a tile down, no tile invented if the last one was taken meanwhile, the computer never does it), the game against the computer under every condition (allowed with a play and no double, the turn goes on with exactly what the hand can now play including the new tile, a second draw refused with a message, refused for a double, refused from an empty boneyard, nothing changes with hints on, the ordinary draw as ever) **after the ordinary draw (nothing fitted, and the tile drawn fits) a second draw is refused**, and **8 whole games** with draws thrown in: no tile lost or made twice, and never two draws of yours with nothing between them | 43 |
| `test_draw_anyway_online` | The same in hosted matches: the opening and a turn accepted, the other person shown "draws a tile" and not which, a second draw / a double / an empty boneyard / a seat not being asked all refused with the reason, and 12 whole matches (with and without a computer) with draws thrown in: no tile lost or made twice, the plays offered always what the hand can now play | 31 |
| `test_rotate` | Double-click to turn a tile: the facing logic leaves a turned tile alone (cases, and **3,000 random rows against every way round**), the tile turns in what it says and in the pips, stays turned through redraws, plays and draws, is counted once when the gesture is heard twice, doubles and tiles not in the hand do nothing, a new round forgets the turns; a click that would play a tile waits to see if it is a double-click (not played in the double-click time, played once after it, a double-click cancels it, a click elsewhere plays the first, a keyboard click plays at once, hints off waits for nothing, leaving the game forgets it); a double-click is not a pick-up; and the real page's events (double-click, the second click of a pair, R, Ctrl+R and Cmd+R left alone) | 49 |
| `test_browser_draw_rotate.py` | Real Chromium: hints off against the computer (the plain Draw button draws with a play, the counts change, nothing says you had a play, a second draw is refused with a message, a tile is then played with the mouse), double-click turning a tile that one click would have played (not played, pips turned, turned back by a second double-click, a single click plays it a moment later), R, hints off (turned, not picked up, a single click picks up at once), and a hosted game between two people with hints off (Ann's draw accepted, Ben sees \"Ann draws a tile\", a second draw refused, the round played to the end) | 27 |
| `test_gamelog` | The game log: 60 whole rounds (two and three players, every level) recorded the way the page and the server record them and replayed by the checker (the 0-0 counts 50 there too); the recorder changes nothing (the hooks wrapper passes everything through, a failing log never stops a game, a round plays out the same with and without it); the round buffer (nothing is let go until the round, or the game, has ended); the checker notices 13 kinds of tampering **and names the right reason** (a wrong top of the boneyard, a tile the wrong way round, a missing event, a tile dealt twice, wrong totals and pips, a tile not held, a stranger, time going backwards, ...) and a log cut off mid-line; the files (the directory and its parents are made, JSON Lines, names that cannot escape the directory, a size limit that says so once, the directory removed while running, a disk that fails, a file that cannot be written); the server's `/gamelog` (this computer only: **a request from another address is refused**, POST only, rubbish, too much at once, off unless asked for, the directory made before anyone plays); a hosted match writing its own log: **no file at all while a round is under way**, the first of four rounds written when it ends and the second not in the file until it ends, a game stopped half way writing its dead round with `aborted`, and **draws made while holding a play (hints off) in the log**; the page: **nothing sent mid-round, even after waiting past the old batch time**, one batch as each round ends, a game left half way sending its last round as aborted, the same draws, over real HTTP into a real server's directory (no request and no file mid-round, the finished game checked), a refusing server stopping the page's attempts; the tools' exit statuses; `--games-dir` and `--no-game-log` on the real command line | 117 |
| `test_browser_four.py` | Real Chromium, four players: the Host screen's Fourth player (disabled until there is a third player, computers only), the lobby with two people and two computers, a third person turned away, three opponent rows that do not overlap each other or the boneyard, the round played to its end and the same four scores on both final screens; and one page with three computers at desktop and phone width (rows, names, no sideways scroll, round-end dialog fits) | 32 |
| `test_browser_names.py` | Real Chromium: in the end-of-round dialog **a player's name never runs into the tiles, "No tiles left" or the points**: every computer name in the game and the LotR characters, a 20-letter name (the most a person can type), at a wide and a phone-sized window, with a full hand and with none, at a table of two and of three (280 dialogs per width; on the old 3.2 rem name column even "Tamsin" overflowed); a very long name wraps inside its own column, and on a phone the name has its own line | 3 |
| `test_browser_gamelog.py` | Real Chromium against a real `node server.js` (its timers shortened so that a real round takes seconds): the games directory, and the directory above it that did not exist, is made at start-up; **while a round is being played the directory has no log in it, even after waiting longer than the old batch time**; when the round ends its log appears, from the game and the deal (both hands and the whole boneyard) to the result, naming the page's build, and the checker says it adds up; a page reloaded mid-round writes nothing (the round is lost, by design); a new game started in the page over a half-played one writes the dead round at once, ending `aborted`, and it adds up; the banner says where the logs go | 17 |
| `test_hidden_hand` | The computer cannot see your tiles that are not on the table: thousands of real positions (two and three players, 8, 12 and 15 tiles) decided twice, once as played and once with your hand swapped for tiles from the boneyard: **never a different decision** at Easy, Medium, Hard or Expert, in normal turns and in the opening; the same position asked twice always answers the same (so a difference could only come from what was hidden); a control that really peeks is detected in about a third of the positions; and told that your passes showed you cannot match nine numbers, Hard does decide differently (it does use what is public) | 35 |
| `test_invalid_try` | The computer's remarks on invalid tries: lines in every voice and language, the page (hints off and on, cooldown, Comments off, nothing awaited), and the hosted match | 29 |
| `test_browser_undo_fly` | Real Chromium: Take back makes the tile fly into your hand and land visible (the fake-page cases are in `test_fx`) | 5 |
| `test_history` | The server's SQLite history: the store (numbering, ties, stopped games, the newest-N limit, reopening the file, names and scores cleaned), `GET /history`, what a hosted match hands over, and a whole hosted game through the real server being kept with the scores the players saw | 33 |
| `test_history_page` | The Recent games screen: the button, the cards (winner, scores, computers, times, stopped games, ties), choosing how many, Refresh, Back, an empty list, no server, rubbish from a server, names cleaned | 18 |
| `test_browser_history` | Real Chromium: the Recent games button, the cards, choosing 100, Back, and a phone-sized screen (the server's answer is supplied by the test) | 8 |
| `test_hints` | Allow hints and Show hints: no hint of any kind on any screen of whole games with hints off (played by guessing tile and train), wrong guesses change nothing, nothing is picked for you, the toggles and their saving, the opening, dragging, online, the always-on double outline and Draw button | 69 |
| `test_toy_train` | The toy train marker: its drawing (shades of one color, two wheels half covered by the body, same height), the three colors and its size, when it appears (every screen of six whole games), the wording with no lanterns left, three players online | 38 |
| `test_four_players` | Four players: the deal at two, three and four (15 tiles each, every tile once, the first three hands dealt as at three), who sits where online (the computers in the last seats, never fewer than two people, the old single-`computer` option still working), what each person sees (table order after themselves, three opponents, which is a computer, five trains and four scores), 24 whole hosted matches in each layout (three people and a computer, two people and two computers) with every message inspected for another's hand, the boneyard or a face-down train and for lost tiles, the server's settings (never more than four players: a second computer is dropped for three people and ignored without a first; changing between two and three people; `/info`), a hosted game played through the server, and one page with three computers (setup form, names, rows, header, colours, a whole game, the final screen) | 70 |
| `test_two_computers` | One person against two computers: the setup form (and the real page's form), names and skills, whole games of up to 13 rounds with every screen inspected, that each computer really plays at its own skill in either seat (Easy and Hard build very different opening trains), the narration naming the right computer, the commentary speakers, the toy train colors | 43 |
| `test_bubble_flash` | A speech bubble fades in once, when it first appears, and not again each time the page is redrawn for a move (the computer's comments and online chat); not at all behind an open dialog; the stylesheet and the real browser's measured opacity and running animations | 22 |
| `test_dim_spacing` | The hand is dimmed on every screen where it is not your turn (against the computer and online) and not on your turn; the end-of-train padding is two dominoes | 12 |
| `test_browser.py` | The real page in real Chromium (Playwright) against the real server: measured opacity of the hand, measured empty space after each train's last tile (wide and phone-sized screens), the host address field (an IP, read-only, cannot be edited), the QR code as the browser really draws it decoded by OpenCV, layout of the three-player table, and whole games between two and three real browser pages with no JavaScript errors. Skipped if Playwright is not installed; saves screenshots | 93 |
| `test_qr` | The QR generator: a published Reed-Solomon example, the standard's block tables and format and version strings, and 52 codes across all ten versions read back by an independent decoder (OpenCV, skipped if python3 with OpenCV is not installed) | 35 |
| `test_join_link` | The real built page opened from a scanned link (`?join=`), the Host screen's address, the lobby's QR code and Copy link button, several network addresses, and the lobby's QR decoded back to its link | 45 |
| `test_theme` | The Lord of the Rings theme: the cast and their levels, every character's full set of lines (mild, American spelling, none shared, placeholders right), their food, picking names and lines, the golden ring, whole games where every speech bubble is checked against the speaker's own lines and every open train wears the ring, the classic game unchanged, the setup form | 80 |
| `test_connection` | The server's handling of connections: any traffic counts as proof of life, real silence is dropped, a stalled server blames nobody, the soft grace (a drop that mends itself is invisible; a longer one pauses and announces; coming back unpauses; never coming back ends the game), every drop explained in the log, the page's account sanitized, `/netstats`, the health line | 37 |
| `test_connection_client` | The page's side: any message counts, quiet connections are pinged, 30 s of silence ends one (saying why), the quick first retry and back-off, a suspended page is not held against the server, waking up checks at once, the account sent on reconnecting, the event log (console, reconnect screen, `?debug=1` panel) | 40 |
| `test_browser_connection.py` | Real Chromium and the real server: a guest's connection is cut mid-game; what the other player sees (run with `--original` against older code to compare) | 6 |
| `test_auto_done` | The opening finishing by itself when "Build my longest train" has laid the whole train (also after a tile was laid by hand and taken back by the plan); a plan that goes wrong hands control back instead; laying tiles by hand never finishes it; no Build button with hints off | 13 |
| `test_say_text` | Typed messages on the page: cleaning (new lines, control, invisible and direction-flipping characters, emoji and other languages kept, 80 characters counted as people see them), sending only what is clean, escaping what is shown, ignoring junk, how long a message stays up, a refused message saying so, and the separate text box (shown, hidden, cleared; hidden under dialogs) | 44 |
| `test_browser_say.py` | Real Chromium, two people: the text box is the very same element with the same text, cursor and focus after the page is redrawn many times; Enter sends, Escape closes and keeps the draft, a quick phrase works, hostile text is only text, a second message straight away is refused with a message, a dialog hides it, it fits a 390-pixel phone | 24 |
| `test_browser_hints.py` | Real Chromium, two people: the host's Allow hints setting reaches the guest (Host screen, the lobbies, the game), the guest's own Show hints button, nothing highlighted or offered with hints off, and Build my longest train finishing the opening by itself, seen by the other player | 19 |
| `test_browser_final.py` | Real Chromium, two people, a one-round game played to the end: the host presses "See final score" and has the final score at once (not waiting for the guest), the guest still has their own dialog, the host goes back to the menu and the guest's game is not ended, is told Ann has gone, and gets the final score too | 8 |
| `test_publicip` | The server finding its public address (`/publicip`) against small local "services" so the real request code runs: which addresses count as public (private, loopback, link-local, carrier-grade NAT, multicast, reserved and malformed ones do not), a good answer, eleven kinds of untrusted answer (HTML, empty, private, IPv6, two addresses, text around the address, error statuses, a redirect), a reply that is too long, one service failing and the next being tried, a service that never answers, remembered answers and one question at a time (twelve at once are one), a failing service not asked every time, recovery, nothing asked unless the Host screen asks, `--no-public-ip` and `--local-only`, and `--help`; an address that changes being noticed on the next click (answers are reused for 5 seconds at most), and a failed lookup not keeping the old address | 45 |
| `test_log_order` | The game's history at the bottom of the game: every message shown (not five), the newest on top and the oldest further down, the highlight on the top line, the label for a screen reader and the panel able to take the focus, a very long game limited to the latest 600, the start of each round picked out, the log itself still kept oldest first; in a real game the panel is always exactly the log, newest first; the second round does not wipe the history; a new game starts clean | 16 |
| `test_history_log` | The panel's stylesheet (fixed size, scrolls, does not pass the scrolling on, focus ring, round starts in bold); the server keeping each person's history from round to round and sending the latest 120 lines with where they begin so that they add up exactly (and not growing in a long game); the page keeping what it is sent in a hosted game (overlaps put in place with no repeats, a long gap tolerated, a shorter history meaning a new game, an older server, markup cleaned); and the scroll position when the page is drawn again (top stays at the top, part-way down stays on the same message when lines are added above, nothing breaks with no panel) | 25 |
| `test_browser_history.py` | Real Chromium: the panel is 7.2 rem and scrolls (overflow, no scroll-chaining), holds every message of the game (not five), can take the keyboard focus; the mouse wheel takes it to the oldest message ("Round 1: ...") without scrolling the page; Page Down, End and Home work from the keyboard; and as the game goes on and redraws the page a reader part-way down keeps the very same message at the same place on the screen, while one at the top keeps seeing the newest | 18 |
| `test_rematch` | Playing again on the server (real sockets, real matches): everyone asking and the game starting again with the same people, seats and settings and a new deal (and again, and again), asking twice being the same as once, the rules of asking (not in the lobby, not mid-game, not before your own final score), three people with someone quicker than the others, someone leaving after the final score, closing their page, asking and then leaving, asking and then closing the page (not there to play), the one who asked leaving, and a computer player | 36 |
| `test_rematch_client` | Playing again on real pages against a real server: what the final dialog offers, "Waiting for Ben...", "Ann wants to play again.", "Ann and Ben want to play again.", the buttons for each situation, the new game starting on every page (nothing scored, a new deal, the new game's updates accepted), a second game to its end, someone leaving, three people, a computer player | 27 |
| `test_hand_slots` | Your hand as a row of slots: a played tile leaves its slot empty and nothing moves, the row's width, a drawn tile into the first empty slot (else the end), a tile taken back to its own slot, a new hand with no gaps, dragging or using the keyboard to move a tile into an empty slot or swap with a tile, and a property test over six real games (no tile of yours ever changes slot) | 41 |
| `test_browser_slots.py` | Real Chromium: a whole game against the computer with the hand's layout measured on every step (no tile ever pushed to another place, an empty slot exactly where a played tile was, a drawn tile into the first empty slot, the row not changing width), and real pointer drags: a tile dragged into an empty slot, and onto the tile beside it | 15 |
| `test_build_check` | The server and which version of the page: `/info` reports the stamp of the page file (empty when there is none); a page with no version, or a different one, is refused when it creates or joins (with the reload message, the console naming both builds, no game made, and before the code is looked at); the matching one is let in (and a game for three is one for three); coming back to a game needs none; a replaced page file is noticed without a restart; a server made without the check lets any page in; `node server.js` turns the check on and reports the stamp of the real page (in `/info` and its banner); the console says how a game was made | 22 |
| `test_join_choices` | The Host screen's three ways to join, on the page: what a typed address may be (valid and invalid forms), the states while looking up, found, not found, switched off, failing, junk and very late answers, the form not being redrawn when the public address arrives, remembering the choice, creating with each choice, the lobby's order, QR code, link and notes, errors that keep what was typed, nothing injected; the host's own page connecting to the address it was loaded from even when the local address is unreachable (whichever way the others are to join), falling back to the server's address for a page opened from a file, and a typed address with no port getting the server's real port; a game for three against an older server that cannot seat one (the choice greyed with a warning, and a game made for two when three were asked for being closed again at once); the page sending its version when creating or joining, the "reload this page" notice and the disabled Create button for a page that is behind its server, and a refusal for an old page being shown on the Host and Join screens | 132 |
| `test_browser_join.py` | Real Chromium: a name and a half-typed address surviving the public address arriving mid-typing (same text, still in the box), the keyboard skipping a choice that cannot be made, the lobby for the internet and for a typed address, Show QR changing the link and the QR code, refusing a bad address with what was typed kept, a guest joining through the link, the lookup failing; the lookup is faked, so nothing contacts the internet; the public address changing between two clicks of Host online game (a quick second click gets the same answer, a later one the new address, and the lobby uses it); hosting working when Chromium is told the local address is one it cannot reach and the host chose the internet (the window opens no connection to it) | 31 |
| `test_three_humans` | The server with THREE people (real sockets): the lobby filling (seats 1 and 2, who is told what, Start waiting for all three, a fourth person refused), the table size (junk means two, no computer at a table of three, changing it only while there is room), names (a second Ben, case-insensitive, 20 characters), places freed by leaving or closing the page, a whole match to the final score with the same scores on all three screens, between rounds waiting for all three, messages to both others stamped with the real sender (a forged sender is ignored) with each person's own rate limits, one person dropping (the pause, who is named, how long they have), two dropping (paused until both are back), a blip that mends being invisible, a timeout naming the person, leaving ending it for the others, the last round (each gets the final score on pressing; leaving or closing the page after seeing it harms nobody), and coming back to your own seat; being turned away (who is in a full game, a game that has begun, the server console's reason) and `/info` announcing it can seat three | 73 |
| `test_three_humans_client` | THREE real pages against a real server: the Host screen's "Third player > Add a third person", the lobby (three places, "Waiting for 2 players...", Start only when all three are in, a fourth refused), two human opponent rows in seat order, one Say something, messages shown in the sender's name on both other pages, whom the pause dialog names (one person, then both), which opponent's dot is down, each page keeping its own seat after reconnecting, played to the end with the same scores on every screen, whom each is told they played, toy-train colours by seat, and someone leaving; wording for two and for three | 34 |
| `test_browser_three.py` | Real Chromium, three separate windows: Add a third person, the lobby filling up (and a fourth refused), the game with two opponent rows each, a message from one window in both others in the sender's name, one window closed (both others told it is Cat) and reopened (back in her seat, the pause gone), the round played to the end, the same scores on all three final screens; an older server (the option greyed in real Chromium) and a server answer that says two being stopped at once; the messages at the bottom newest-first all through the game; an old page left open in a tab (no version, or an old one) being turned away or warned, with the version check on for the whole test; playing again in three windows (each told who has asked, a new game on all three, a second game, one window going back to the menu) | 30 |
| `test_art` | The Lord of the Rings scenery's files and build: each picture a plain, closed, small SVG with nothing that could run, link to or load anything (no text, no fonts, no addresses), no colour brighter than the classic felt's centre and the gold only at a low opacity, the stylesheet's names replaced by inlined pictures in the built page (nothing fetched), the page's version stamp covering the pictures, the build refusing a picture with a script, the "more contrast" rule, and the scenery on a Lord of the Rings board and not on a classic one | 40 |
| `test_browser_lotr_bg.py` | Real Chromium, at four screen sizes (desktop, wide, tablet, phone): the scenery MEASURED on the drawn pixels. Everything but the board's background is hidden and photographed, the board's plain gradient is subtracted to leave the scenery alone, and: no pixel is brighter than the classic board's brightest, the scenery brightens the board by at most 0.03, every colour of text sitting on the board is at least 3:1 against the brightest background pixel and no worse than against the classic board, the bone tiles keep a strong contrast, the mountains, the hills and trees and the ring are really there, the classic board has none, and with "more contrast" asked for there are no pictures | 53 |
| `test_hand_facing` | Like halves facing in your hand: the cases (one shared number turns exactly one tile, a chain lines up, doubles never turn, nothing in common turns nothing, an empty slot or a row boundary breaks "side by side", a tile that has one 3 can face a 3 on one side only), stickiness (a tile is not turned back when its neighbour goes), **every way round tried against the result in 4,000 random hands** (6,783 rows of tiles side by side, 3,015 with a pair to face: always the most facing pairs, with the fewest turns), the same on the drawn page in real games (the numbers read from the drawn pips; every row as good as it can be; a row that is unchanged is never turned about), the real row length measured from the grid (and again when the window changes, with at most one extra drawing), nothing turning while a tile is dragged, and a new round starting with nothing turned | 35 |
| `test_browser_hand_facing.py` | Real Chromium at a desktop and a phone width: which tiles are side by side is read from where they really are on the screen, and every row has the most facing pairs possible, on the first look and through a game played; the page measured the real row length; the window made narrower and wider re-measures and re-faces | 12 |
| `test_favicon` | The tab icon's files and head: a small plain SVG with nothing that could run or load anything, four colours that are the game's own (the stylesheet's felt and bone), four pips and nothing tilted or fine, nothing of the Lord of the Rings theme; the two PNGs really decoded (size, transparent rounded corners, the felt, the bone, the brass divider and all four pips at the right places); the three links in the page's head inlined and exactly the files; the version stamp covering the icon; the build refusing a non-PNG and an SVG with a script | 34 |
| `test_browser_favicon.py` | Real Chromium: the icons decode (32 x 32 and 180 x 180), the same icon after choosing the Lord of the Rings theme, and at tab size (16 x 16 and 32 x 32 on a light and a dark tab strip, measured on the pixels): the four pips are four separate dots, the tile and the felt both take a real share, they contrast strongly, the tile spans most of the width, and the icon shows on both strips | 20 |
| `test_browser_cleanup.py` | Real Chromium, two people: the Host screen's first computer choice is just "None"; after Create game neither lobby has any inputs; in the game no row says "Needs N" (the word is nowhere on the screen); and the join code is on neither screen in any of 18 samples (start, the Rules dialog, the Leave question, during play, round end, final score) | 14 |
| `test_cleanup` | The screen clean-ups: no "Needs N" on any train's row, the Mexican train included (one and two computers, while building and after, and in a hosted game); an open train still says it is open; "None" as the first computer choice; no inputs in the lobby after Create game, with the join code, Copy link, Leave and Start still there; no join code in a hosted game's header | 19 |
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
- **Two to four players.** The rules engine seats two, three or four players (you and one to three computers; online, two or three people with up to two computers, never more than four in all). There is no hot-seat second human on one screen, and no more than four at the table.
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
- **More than three players**, or two people sharing a screen. (Four at the table is done: you and three computers, or two or three people with computers, online.)
- **Online play over the internet without port forwarding.** (The server can look up its public address, but cannot open the port or check that it is reachable from outside.)
- **The computer commenting online**, as it does in the game against the computer.

---

## License

No license has been chosen yet. Until one is added, all rights are reserved by default. A permissive license such as MIT would be a natural fit for a project like this; add a `LICENSE` file and update this section.
