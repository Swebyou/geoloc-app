import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(express.json());
app.use(express.static("public"));

// sessions: pin -> {name, avatar, sharerWS, viewers:Set, expiresAt}
const sessions = new Map();

// Nettoyage automatique des sessions expirées toutes les 30 sec
setInterval(() => {
  const now = Date.now();
  for (const [pin, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(pin);
  }
}, 30_000);

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // Création session
      if (data.type === "create") {
        const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6 chiffres
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min
        sessions.set(pin, {
          name: data.name || "Sharer",
          avatar: data.avatar || "",
          sharerWS: ws,
          viewers: new Set(),
          expiresAt
        });
        ws.sessionPin = pin;
        ws.send(JSON.stringify({ type: "pin", pin, expiresAt }));
      }

      // Rejoindre session (multi-viewers)
      if (data.type === "join") {
        const s = sessions.get(data.pin);
        if (!s) {
          ws.send(JSON.stringify({ type: "error", msg: "PIN invalide ou expiré" }));
          return;
        }
        s.viewers.add(ws);
        ws.sessionPin = data.pin;
        ws.send(JSON.stringify({ type: "success", sharer: { name: s.name, avatar: s.avatar } }));
      }

      // Position sharer → viewers
      if (data.type === "location") {
        const s = sessions.get(data.pin);
        if (!s) return;
        for (const v of s.viewers) {
          if (v.readyState === 1) v.send(JSON.stringify({
            type: "location",
            lat: data.lat,
            lng: data.lng,
            name: s.name,
            avatar: s.avatar
          }));
        }
      }

    } catch (e) {
      console.error("WS ERROR", e);
    }
  });

  ws.on("close", () => {
    if (ws.sessionPin) {
      const s = sessions.get(ws.sessionPin);
      if (!s) return;
      if (ws === s.sharerWS) s.sharerWS = null;
      else s.viewers.delete(ws);
    }
  });
});

// Upgrade HTTP → WS
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`✅ Serveur multi-viewers lancé sur http://localhost:${PORT}`));
