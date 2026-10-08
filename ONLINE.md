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

The server prints where it can be reached, for example:

```
  On this computer:   http://localhost:8080
  From other computers on your network:
                      http://192.168.1.23:8080
```

Open the first address in your own browser, press **Host online game**, and pick the game length. You get a **join code** like `K7Q-F2M`. Give the guest the address (the lobby lists every address the server found) and the code. When they have joined, press **Start game**.

**"Listening on the whole network"** means the server accepts connections on every network interface the computer has (Wi-Fi, Ethernet, VPN), not only from the same machine, so another computer can connect to `your-ip:8080`. That is the default, because the point is to let someone else join. `--local-only` restricts it to the host machine. Your operating system's firewall may ask whether to allow Node.js: allow it on private networks.

### Joining

Either open the host's address in a browser (`http://192.168.1.23:8080`), press **Join online game** and enter the code; or open any saved copy of `mexican-train.html`, press **Join online game**, and type the address as well as the code. The address may be written as `192.168.1.23:8080`, `192.168.1.23` (port 8080 is assumed) or pasted as a full `http://...` link.

### Over the internet

On the same network (home Wi-Fi, an office) it just works. Over the internet the guest has to be able to reach the host's computer: forward the port on the host's router to the computer running the server, or put both computers on a VPN (Tailscale, ZeroTier and similar), or use a tunnel service. The connection is plain HTTP and WebSocket, **not encrypted**, which is fine on a home network or a VPN. The page must be opened over `http://` (or from a file): a browser will not let an `https://` page connect to a plain `ws://` server.

### During a game

- Everything works as in the game against the computer: tapping, dragging, **Build my longest train**, taking tiles back, the flying tiles and the click sounds. Your opponent's tiles click too.
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

- Two human players only; the computer does not join online games, and there are no spectators.
- Games live in the server's memory: stopping or restarting the server ends every game.
- Tested with real sockets (see Testing), but **not yet in real browsers, on separate computers, or across a real network with a firewall and router**. Treat the first game between two machines as the real test.

---

