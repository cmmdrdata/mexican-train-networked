# Mexican Train: playing online

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

- Everything works as in the game against the computer: tapping, dragging, **Build my longest train**, taking tiles back, the flying tiles and the click sounds. Your opponent's tiles click too. **Build my longest train** lays the tiles down one at a time with a random pause of 0.5 to 3 seconds between them, so the others see the train go down at a person's pace instead of all at once.
- **A low, short tone says it is your move.** It sounds when a new turn of yours begins, not for the rest of the same turn (covering your own double, or playing a tile you just drew), not while you build your opening train, and not when the dialogs appear. It is much lower and softer than the high click of a domino, and **Mute** silences it. It plays in online games only.
- The computer's comments are replaced by **Say something**: twelve quick phrases ("Nice play!", "Hurry up!"...). Nothing anyone types can reach the other screen.
- **If someone's connection drops**, the game pauses for both players and the other screen shows a 3-minute countdown. The dropped player's page reconnects by itself (and a reloaded page rejoins from a remembered code), landing back in the same game with the same hand. If they do not return in time, the game ends and the other player is told why.
- **Leave game** ends the game for both players (after a confirmation). Closing the page does not: you have the three minutes to come back.
- If the same game is opened in a second window, the first window is closed rather than the two fighting over the seat.

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

