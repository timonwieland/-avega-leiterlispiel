/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { fieldByNumber } from "../lib/game-data";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type Player = {
  id: string;
  name: string;
  color: string;
  position: number;
  ready: boolean;
  skipTurns: number;
  nextRollMultiplier: number;
  isBot?: boolean;
  joinedAt: number;
  lastSeen: number;
};

type GameState = {
  roomId: string;
  roomCode: string;
  status: "lobby" | "playing" | "finished";
  createdAt: number;
  hostId: string;
  players: Player[];
  playerOrder: string[];
  activePlayer: string;
  diceResult: number | null;
  turnState: "waiting" | "moving" | "event" | "finished";
  specialActions: Record<string, unknown>;
  winner: string | null;
  lastAction: string;
  lastEvent: { id: string; fieldNumber: number; playerId: string; actionLabel: string; affectedPlayerIds: string[] } | null;
  lastMove: { id: string; playerId: string; path: number[]; secondary?: { playerId: string; from: number; to: number } } | null;
  updatedAt: number;
  turnNumber: number;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms(updated_at)"),
  ]);
}

async function loadRoom(db: D1Database, code: string) {
  const row = await db.prepare("SELECT state, version FROM rooms WHERE code = ?").bind(code).first<{ state: string; version: number }>();
  if (!row) return null;
  return { state: JSON.parse(row.state) as GameState, version: row.version };
}

async function saveRoom(db: D1Database, code: string, state: GameState, version: number) {
  state.updatedAt = Date.now();
  const result = await db.prepare("UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?")
    .bind(JSON.stringify(state), state.updatedAt, code, version).run();
  return Boolean(result.meta.changes);
}

const cleanName = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
const cleanCode = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
const makeId = () => crypto.randomUUID();
const die = () => crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1;

function advanceTurn(state: GameState, currentIndex: number) {
  for (let offset = 1; offset <= state.playerOrder.length; offset++) {
    const id = state.playerOrder[(currentIndex + offset) % state.playerOrder.length];
    const player = state.players.find((entry) => entry.id === id);
    if (!player) continue;
    if (player.skipTurns > 0) {
      player.skipTurns -= 1;
      state.lastAction += ` ${player.name} setzt diese Runde aus.`;
      continue;
    }
    state.activePlayer = id;
    state.turnNumber += 1;
    return;
  }
  state.activePlayer = state.playerOrder[(currentIndex + 1) % state.playerOrder.length];
  state.turnNumber += 1;
}

function applyFieldAction(state: GameState, player: Player, landingField: number) {
  const field = fieldByNumber[landingField];
  const affected: string[] = [];
  let extraRoll = false;
  let secondary: { playerId: string; from: number; to: number } | undefined;
  if (!field || !field.actionType || field.actionType === "start") return { extraRoll, affected, secondary };

  if (field.actionType === "move" && field.targetField) {
    player.position = field.targetField;
    affected.push(player.id);
  } else if (field.actionType === "skip") {
    player.skipTurns += field.skipTurns ?? 1;
    affected.push(player.id);
  } else if (field.actionType === "extraRoll") {
    extraRoll = true;
  } else if (field.actionType === "doubleNext") {
    player.skipTurns += field.skipTurns ?? 1;
    player.nextRollMultiplier = field.nextRollMultiplier ?? 2;
    affected.push(player.id);
  } else if (field.actionType === "leaderBack") {
    const lead = Math.max(...state.players.map((entry) => entry.position));
    if (lead > 65) {
      state.players.filter((entry) => entry.position === lead).forEach((entry) => {
        entry.position = 65;
        affected.push(entry.id);
      });
    }
  } else if (field.actionType === "swapNearest") {
    const others = state.players.filter((entry) => entry.id !== player.id);
    const ranked = others.sort((a, b) => {
      const distance = Math.abs(a.position - landingField) - Math.abs(b.position - landingField);
      if (distance) return distance;
      const ahead = Number(b.position > landingField) - Number(a.position > landingField);
      if (ahead) return ahead;
      return state.playerOrder.indexOf(a.id) - state.playerOrder.indexOf(b.id);
    });
    const nearest = ranked[0];
    if (nearest) {
      const otherFrom = nearest.position;
      nearest.position = landingField;
      player.position = otherFrom;
      affected.push(player.id, nearest.id);
      secondary = { playerId: nearest.id, from: otherFrom, to: landingField };
    }
  } else if (field.actionType === "goal") {
    state.status = "finished";
    state.turnState = "finished";
    state.winner = player.id;
    affected.push(player.id);
  }

  state.lastEvent = {
    id: makeId(),
    fieldNumber: landingField,
    playerId: player.id,
    actionLabel: field.actionLabel ?? "AVEGA Ereignis",
    affectedPlayerIds: affected,
  };
  return { extraRoll, affected, secondary };
}

async function api(request: Request, env: Env, url: URL) {
  await ensureSchema(env.DB);
  const segments = url.pathname.split("/").filter(Boolean);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) as Record<string, unknown> : {};

  if (request.method === "POST" && url.pathname === "/api/rooms/create") {
    const name = cleanName(body.name);
    if (!name) return json({ error: "Bitte gib einen Anzeigenamen ein." }, 400);
    let code = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      code = `AVEGA${10 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90)}`;
      if (!(await loadRoom(env.DB, code))) break;
    }
    const now = Date.now();
    const player: Player = { id: makeId(), name, color: String(body.color || "#0b70b7"), position: 1, ready: true, skipTurns: 0, nextRollMultiplier: 1, joinedAt: now, lastSeen: now };
    const state: GameState = { roomId: makeId(), roomCode: code, status: "lobby", createdAt: now, hostId: player.id, players: [player], playerOrder: [player.id], activePlayer: player.id, diceResult: null, turnState: "waiting", specialActions: {}, winner: null, lastAction: `${name} hat den Raum eröffnet.`, lastEvent: null, lastMove: null, updatedAt: now, turnNumber: 0 };
    await env.DB.prepare("INSERT INTO rooms (code, state, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)").bind(code, JSON.stringify(state), now, now).run();
    return json({ state, playerId: player.id });
  }

  const code = cleanCode(segments[2] ?? "");
  if (!code) return json({ error: "Dieser Raumcode sieht noch nicht richtig aus." }, 400);
  const room = await loadRoom(env.DB, code);
  if (!room) return json({ error: "Diesen Raum gibt es nicht (mehr)." }, 404);
  const { state, version } = room;

  if (request.method === "POST" && segments[3] === "join") {
    const requestedId = String(body.playerId ?? "");
    const returning = state.players.find((entry) => entry.id === requestedId);
    if (returning) {
      returning.lastSeen = Date.now();
      await saveRoom(env.DB, code, state, version);
      return json({ state, playerId: returning.id });
    }
    if (state.status !== "lobby") return json({ error: "Die Partie läuft bereits. Mit demselben Gerät kannst du wieder einsteigen." }, 409);
    if (state.players.length >= 8) return json({ error: "Dieser Raum ist bereits voll." }, 409);
    const name = cleanName(body.name);
    if (!name) return json({ error: "Bitte gib einen Anzeigenamen ein." }, 400);
    const uniqueName = state.players.some((entry) => entry.name.toLowerCase() === name.toLowerCase()) ? `${name} 2` : name;
    const now = Date.now();
    const player: Player = { id: makeId(), name: uniqueName, color: String(body.color || "#e94f37"), position: 1, ready: false, skipTurns: 0, nextRollMultiplier: 1, joinedAt: now, lastSeen: now };
    state.players.push(player); state.playerOrder.push(player.id); state.lastAction = `${uniqueName} ist dem Spiel beigetreten.`;
    if (!(await saveRoom(env.DB, code, state, version))) return json({ error: "Fast gleichzeitig! Bitte versuche es nochmals." }, 409);
    return json({ state, playerId: player.id });
  }

  if (request.method === "GET") {
    const playerId = url.searchParams.get("playerId") ?? "";
    const player = state.players.find((entry) => entry.id === playerId);
    if (player) player.lastSeen = Date.now();
    const host = state.players.find((entry) => entry.id === state.hostId);
    if (host && Date.now() - host.lastSeen > 45000) {
      const successor = state.players.filter((entry) => Date.now() - entry.lastSeen < 20000).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (successor && successor.id !== host.id) { state.hostId = successor.id; state.lastAction = `${successor.name} übernimmt die Raumleitung.`; }
    }
    if (player || state.hostId !== host?.id) await saveRoom(env.DB, code, state, version);
    return json({ state });
  }

  if (request.method === "POST" && segments[3] === "action") {
    const playerId = String(body.playerId ?? "");
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) return json({ error: "Deine Spielsitzung wurde nicht gefunden." }, 403);
    player.lastSeen = Date.now();
    const action = String(body.action ?? "");
    if (action === "ready" && state.status === "lobby") {
      player.ready = !player.ready;
      state.lastAction = player.ready ? `${player.name} ist bereit.` : `${player.name} wartet noch.`;
    } else if (action === "start") {
      if (state.hostId !== playerId) return json({ error: "Nur die raumleitende Person kann starten." }, 403);
      if (state.players.length < 2) return json({ error: "Mindestens zwei Spielende gehören auf dieses Brett." }, 409);
      if (!state.players.every((entry) => entry.ready || entry.isBot)) return json({ error: "Noch sind nicht alle bereit." }, 409);
      state.status = "playing"; state.activePlayer = state.playerOrder[0]; state.turnNumber = 1; state.lastAction = `${state.players[0].name} beginnt.`;
    } else if (action === "roll") {
      if (state.status !== "playing" || state.activePlayer !== playerId || state.turnState !== "waiting") return json({ error: "Gerade ist eine andere Person am Zug." }, 409);
      const forced = Number(state.specialActions.forcedDice);
      const rolled = forced >= 1 && forced <= 6 ? forced : die();
      delete state.specialActions.forcedDice;
      const multiplier = player.nextRollMultiplier || 1;
      player.nextRollMultiplier = 1;
      const from = player.position;
      const to = Math.min(100, from + rolled * multiplier);
      const path = Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index + 1);
      player.position = to;
      state.diceResult = rolled;
      state.turnState = "moving";
      state.lastAction = `${player.name} würfelt ${rolled}${multiplier > 1 ? ` × ${multiplier}` : ""} und zieht auf Feld ${to}.`;
      const event = applyFieldAction(state, player, to);
      state.lastMove = { id: makeId(), playerId, path, secondary: event.secondary };
      if (state.status !== "finished") {
        state.turnState = "waiting";
        if (!event.extraRoll) advanceTurn(state, state.playerOrder.indexOf(playerId));
        else state.lastAction += " Nochmals würfeln!";
      }
    } else if (action === "rematch") {
      if (state.hostId !== playerId) return json({ error: "Nur die raumleitende Person kann die Revanche starten." }, 403);
      state.players.forEach((entry) => { entry.position = 1; entry.skipTurns = 0; entry.nextRollMultiplier = 1; entry.ready = entry.id === state.hostId || Boolean(entry.isBot); });
      state.status = "lobby"; state.winner = null; state.diceResult = null; state.lastEvent = null; state.lastMove = null; state.turnNumber = 0; state.lastAction = "Bereit für die Revanche?";
    } else if (action === "dev") {
      if (body.addBot && state.players.length < 8) {
        const now = Date.now(); const number = state.players.length + 1; const bot: Player = { id: makeId(), name: `Testperson ${number}`, color: ["#e94f37", "#f5a623", "#4a9d72", "#7757a8"][number % 4], position: 1, ready: true, skipTurns: 0, nextRollMultiplier: 1, isBot: true, joinedAt: now, lastSeen: now };
        state.players.push(bot); state.playerOrder.push(bot.id); state.lastAction = `${bot.name} wurde simuliert.`;
      } else if (body.forceDice) {
        state.specialActions.forcedDice = Math.max(1, Math.min(6, Number(body.forceDice)));
        state.lastAction = `Testmodus: Der nächste Wurf ist ${state.specialActions.forcedDice}.`;
      } else {
        const target = Math.max(1, Math.min(100, Number(body.fieldNumber) || 1));
        player.position = target;
        state.lastAction = `Testmodus: ${player.name} wurde auf Feld ${target} gesetzt.`;
        applyFieldAction(state, player, target);
      }
    } else return json({ error: "Diese Aktion ist gerade nicht möglich." }, 400);

    if (!(await saveRoom(env.DB, code, state, version))) return json({ error: "Die Partie wurde gleichzeitig aktualisiert. Bitte noch einmal." }, 409);
    return json({ state });
  }
  return json({ error: "Nicht gefunden." }, 404);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/rooms")) {
      try { return await api(request, env, url); }
      catch (error) { console.error(error); return json({ error: "Das Spielbrett braucht kurz eine Pause. Bitte versuche es gleich nochmals." }, 500); }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
