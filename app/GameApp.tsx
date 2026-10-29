"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { exactFinishPath, fieldByNumber, fields, playerColors } from "../lib/game-data";

type Player = { id: string; name: string; color: string; position: number; ready: boolean; skipTurns: number; nextRollMultiplier: number; isBot?: boolean };
type GameState = {
  roomCode: string; status: "lobby" | "playing" | "finished"; hostId: string; players: Player[]; playerOrder: string[]; activePlayer: string;
  diceResult: number | null; winner: string | null; placements?: string[]; lastAction: string; updatedAt: number; turnNumber: number;
  lastEvent: { id: string; fieldNumber: number; playerId: string; actionLabel: string; affectedPlayerIds: string[] } | null;
  lastMove: { id: string; playerId: string; path: number[]; secondary?: { playerId: string; from: number; to: number } } | null;
};
type BoardPoint = { x: number; y: number };

const api = async (path: string, options?: RequestInit) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Etwas ist schiefgelaufen.");
  return payload;
};

function Logo() {
  return <div className="logo"><img src="/assets/avega-logo.png" alt="avega – passion for IT." /></div>;
}

const newId = () => crypto.randomUUID();
const pawnColor = (color: string) => {
  const normalized = color.toLowerCase();
  if (["#0069b4", "#0b70b7", "#0874bb"].includes(normalized)) return playerColors[0];
  if (["#f5f3ea", "#ffffff", "white"].includes(normalized)) return "#25292C";
  return color;
};

function fieldCenter(fieldNumber: number): BoardPoint {
  const zero = fieldNumber - 1; const gameRow = Math.floor(zero / 10); const offset = zero % 10;
  const column = gameRow % 2 === 0 ? offset : 9 - offset;
  return { x: (column + .5) * 10, y: (9 - gameRow + .5) * 10 };
}

const snakeControls: Record<number, [BoardPoint, BoardPoint]> = {
  3: [{ x: 20, y: 88 }, { x: 10, y: 101 }],
  11: [{ x: 84, y: 76 }, { x: 68, y: 91 }],
  49: [{ x: 73, y: 88 }, { x: 42, y: 48 }],
  58: [{ x: 15, y: 56 }, { x: 45, y: 41 }],
  77: [{ x: 52, y: 34 }, { x: 36, y: 48 }],
  93: [{ x: 70, y: 34 }, { x: 31, y: 2 }],
};

function specialMotionPath(from: number, to: number) {
  const start = fieldCenter(from); const end = fieldCenter(to); const field = fieldByNumber[from];
  const steps = field.connectionVisual === "graphic" ? 10 : 24;
  const controls = snakeControls[from];
  return Array.from({ length: steps }, (_, index) => {
    const t = (index + 1) / steps;
    if (!controls) return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    const u = 1 - t; const [first, second] = controls;
    return {
      x: u ** 3 * start.x + 3 * u ** 2 * t * first.x + 3 * u * t ** 2 * second.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u ** 2 * t * first.y + 3 * u * t ** 2 * second.y + t ** 3 * end.y,
    };
  });
}

function movementAngle(from: BoardPoint, to: BoardPoint) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

function advanceLocalTurn(state: GameState, currentIndex: number) {
  for (let offset = 1; offset <= state.playerOrder.length; offset++) {
    const id = state.playerOrder[(currentIndex + offset) % state.playerOrder.length];
    const player = state.players.find((entry) => entry.id === id);
    if (!player || player.position === 100) continue;
    if (player.skipTurns > 0) { player.skipTurns -= 1; state.lastAction += ` ${player.name} setzt diese Runde aus.`; continue; }
    state.activePlayer = id; state.turnNumber += 1; return;
  }
}

function applyLocalField(state: GameState, player: Player, landingField: number) {
  const field = fieldByNumber[landingField];
  const affected: string[] = []; let extraRoll = false;
  let secondary: { playerId: string; from: number; to: number } | undefined;
  if (!field?.actionType || field.actionType === "start") return { extraRoll, secondary };
  if (field.actionType === "move" && field.targetField) { player.position = field.targetField; if (field.skipTurns) player.skipTurns += field.skipTurns; affected.push(player.id); }
  else if (field.actionType === "skip") { player.skipTurns += field.skipTurns ?? 1; affected.push(player.id); }
  else if (field.actionType === "extraRoll") extraRoll = true;
  else if (field.actionType === "doubleNext") { player.skipTurns += field.skipTurns ?? 1; player.nextRollMultiplier = field.nextRollMultiplier ?? 2; affected.push(player.id); }
  else if (field.actionType === "leaderBack") {
    const eligible = state.players.filter((entry) => entry.position < 100);
    const lead = eligible.length ? Math.max(...eligible.map((entry) => entry.position)) : 0;
    if (lead > 65) eligible.filter((entry) => entry.position === lead).forEach((entry) => { entry.position = 65; affected.push(entry.id); });
  } else if (field.actionType === "swapNearest") {
    const nearest = state.players.filter((entry) => entry.id !== player.id && entry.position < 100).sort((a, b) => Math.abs(a.position - landingField) - Math.abs(b.position - landingField) || Number(b.position > landingField) - Number(a.position > landingField) || state.playerOrder.indexOf(a.id) - state.playerOrder.indexOf(b.id))[0];
    if (nearest) { const otherFrom = nearest.position; nearest.position = landingField; player.position = otherFrom; affected.push(player.id, nearest.id); secondary = { playerId: nearest.id, from: otherFrom, to: landingField }; }
  } else if (field.actionType === "goal") {
    state.placements ??= [];
    if (!state.placements.includes(player.id)) state.placements.push(player.id);
    state.winner ??= player.id;
    const remaining = state.players.filter((entry) => entry.position < 100);
    if (remaining.length <= 1) { state.status = "finished"; state.activePlayer = remaining[0]?.id ?? player.id; }
    affected.push(player.id);
  }
  state.lastEvent = { id: newId(), fieldNumber: landingField, playerId: player.id, actionLabel: field.actionLabel ?? "AVEGA Ereignis", affectedPlayerIds: affected };
  return { extraRoll, secondary };
}

function localAction(current: GameState, action: string, extra: Record<string, unknown> = {}) {
  const state = structuredClone(current) as GameState;
  const player = state.players.find((entry) => entry.id === state.activePlayer)!;
  if (action === "rematch") {
    state.players.forEach((entry) => { entry.position = 1; entry.skipTurns = 0; entry.nextRollMultiplier = 1; });
    state.status = "playing"; state.winner = null; state.placements = []; state.diceResult = null; state.lastEvent = null; state.lastMove = null; state.activePlayer = state.playerOrder[0]; state.turnNumber = 1; state.lastAction = `${state.players[0].name} beginnt die Revanche.`;
  } else if (action === "roll" && state.status === "playing") {
    state.lastEvent = null;
    const rolled = crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1;
    const multiplier = player.nextRollMultiplier || 1; player.nextRollMultiplier = 1;
    const from = player.position; const path = exactFinishPath(from, rolled * multiplier); const to = path.at(-1) ?? from;
    player.position = to; state.diceResult = rolled;
    const bounced = from + rolled * multiplier > 100;
    state.lastAction = `${player.name} würfelt ${rolled}${multiplier > 1 ? ` × ${multiplier}` : ""}${bounced ? `, erreicht Feld 100 und geht zurück auf Feld ${to}.` : ` und zieht auf Feld ${to}.`}`;
    const event = applyLocalField(state, player, to);
    state.lastMove = { id: newId(), playerId: player.id, path, secondary: event.secondary };
    if (state.status === "playing" && !event.extraRoll) advanceLocalTurn(state, state.playerOrder.indexOf(player.id));
    else if (event.extraRoll) state.lastAction += " Nochmals würfeln!";
  } else if (action === "dev") {
    const target = Math.max(1, Math.min(100, Number(extra.fieldNumber) || 1)); player.position = target; applyLocalField(state, player, target);
  }
  state.updatedAt = Date.now();
  return state;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <button className="icon-button close" onClick={onClose} aria-label="Schliessen">×</button>
      <h2 id="dialog-title">{title}</h2>{children}
    </section>
  </div>;
}

function EntryForm({ mode, presetCode, onDone, onCancel }: { mode: "create" | "join"; presetCode: string; onDone: (state: GameState, playerId: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(""); const [code, setCode] = useState(presetCode); const [color, setColor] = useState(playerColors[mode === "create" ? 0 : 1]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const previous = mode === "join" ? localStorage.getItem(`avega:${code.toUpperCase()}`) : null;
      const payload = mode === "create"
        ? await api("/api/rooms/create", { method: "POST", body: JSON.stringify({ name, color }) })
        : await api(`/api/rooms/${code}/join`, { method: "POST", body: JSON.stringify({ name, color, playerId: previous }) });
      localStorage.setItem(`avega:${payload.state.roomCode}`, payload.playerId);
      onDone(payload.state, payload.playerId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bitte versuche es nochmals."); }
    finally { setBusy(false); }
  }
  return <Dialog title={mode === "create" ? "Spiel erstellen" : "Spiel beitreten"} onClose={onCancel}>
    <form onSubmit={submit} className="entry-form">
      {mode === "join" && <label>Raumcode<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AVEGA42" autoComplete="off" required /></label>}
      <label>Dein Anzeigename<input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Alex" maxLength={24} autoFocus required /></label>
      <fieldset><legend>Deine Spielfarbe</legend><div className="color-row">{playerColors.map((entry) => <button key={entry} type="button" className={`color-choice ${color === entry ? "selected" : ""}`} style={{ background: entry }} onClick={() => setColor(entry)} aria-label={`Farbe ${entry}`} aria-pressed={color === entry} />)}</div></fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary wide" disabled={busy}>{busy ? "Einen Moment …" : mode === "create" ? "Raum eröffnen" : "Beitreten"}</button>
    </form>
  </Dialog>;
}

function LocalSetup({ onDone, onCancel }: { onDone: (state: GameState) => void; onCancel: () => void }) {
  const [names, setNames] = useState(["", ""]);
  const [computerOpponent, setComputerOpponent] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    const players = names.map((name, index) => { const computer = computerOpponent && index > 0; return { id: newId(), name: computer ? names.length > 2 ? `Computer ${index}` : "Computer" : name.trim() || `Spieler ${index + 1}`, color: playerColors[index], position: 1, ready: true, skipTurns: 0, nextRollMultiplier: 1, isBot: computer }; });
    onDone({ roomCode: "LOKAL", status: "playing", hostId: players[0].id, players, playerOrder: players.map((player) => player.id), activePlayer: players[0].id, diceResult: null, winner: null, placements: [], lastAction: `${players[0].name} beginnt.`, updatedAt: Date.now(), turnNumber: 1, lastEvent: null, lastMove: null });
  }
  return <Dialog title="Auf einem Gerät spielen" onClose={onCancel}><form className="entry-form" onSubmit={submit}><p className="local-intro">Spielt gemeinsam am selben Gerät oder tritt alleine gegen den Computer an.</p><label className="computer-option"><input type="checkbox" checked={computerOpponent} onChange={(event) => setComputerOpponent(event.target.checked)} /><span><b>Gegen den Computer spielen</b><small>Die Computer würfeln und ziehen automatisch.</small></span></label><div className="local-player-list">{names.map((name, index) => { const computer = computerOpponent && index > 0; const computerName = names.length > 2 ? `Computer ${index}` : "Computer"; return <label key={index}><span className="mini-token" style={{ background: playerColors[index] }} />{computer ? computerName : `Spieler ${index + 1}`}<input value={computer ? computerName : name} onChange={(event) => setNames((old) => old.map((entry, i) => i === index ? event.target.value : entry))} placeholder={`Name ${index + 1}`} maxLength={24} autoFocus={index === 0} disabled={computer} /></label>; })}</div><div className="local-buttons">{names.length < 8 && <button type="button" className="secondary compact" onClick={() => setNames((old) => [...old, ""])}>+ {computerOpponent ? "Computer" : "Person"}</button>}{names.length > 2 && <button type="button" className="text-button" onClick={() => setNames((old) => old.slice(0, -1))}>{computerOpponent ? "Letzten Computer" : "Letzte Person"} entfernen</button>}</div><button className="primary wide">Lokales Spiel starten</button></form></Dialog>;
}

function StartScreen({ onCreate, onJoin, onLocal, onRules, onResume, resumeLabel }: { onCreate: () => void; onJoin: () => void; onLocal: () => void; onRules: () => void; onResume?: () => void; resumeLabel?: string }) {
  return <main className="start-screen">
    <header className="topbar"><Logo /><button className="text-button" onClick={onRules}>Spielregeln</button></header>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">10 Jahre · 100 Felder · eine Geschichte</p><h1>Das avega<br /><em>Leiterlispiel.</em></h1><p className="lede">Gemeinsam würfeln, avega-Geschichten entdecken und als erste Person Feld 100 erreichen.</p>
        {onResume && <button className="resume-game" onClick={onResume}><span><b>Angefangenes Spiel fortsetzen</b><small>{resumeLabel}</small></span><strong>→</strong></button>}
        <div className="hero-actions"><button className="primary" onClick={onCreate}>Online-Spiel erstellen <span>↗</span></button><button className="secondary" onClick={onJoin}>Online beitreten</button><button className="secondary local-play" onClick={onLocal}>Auf einem Gerät spielen</button></div>
        <div className="facts"><span>2–8 Spielende</span><span>Keine Anmeldung</span><span>Direkt im Browser</span></div>
      </div>
      <div className="hero-board" aria-hidden="true"><img src="/avega-board-reference.png" alt="" /><div className="hero-token one" /><div className="hero-token two" /><div className="hero-die"><DieFace value={5} /></div></div>
    </section>
    <footer><span>Eine digitale Reise durch zehn Jahre avega.</span><span>passion for IT.</span></footer>
  </main>;
}

function PlayerChip({ player, active, host }: { player: Player; active?: boolean; host?: boolean }) {
  return <div className={`player-chip ${active ? "active" : ""}`}><span className="mini-token" style={{ background: pawnColor(player.color) }} /><div><strong>{player.name}</strong><small>{host ? "Raumleitung" : player.ready ? "Bereit" : "Wartet"}</small></div>{active && <b>am Zug</b>}</div>;
}

function Lobby({ state, me, act, error, onExit }: { state: GameState; me: string; act: (action: string, extra?: object) => void; error: string; onExit: () => void }) {
  const invite = typeof window === "undefined" ? "" : `${window.location.origin}/?room=${state.roomCode}`;
  const own = state.players.find((entry) => entry.id === me)!;
  const allReady = state.players.length >= 2 && state.players.every((entry) => entry.ready || entry.isBot);
  return <main className="lobby-page"><header className="game-header"><Logo /><div><span className="online-dot">● Live verbunden</span><button className="back-button" onClick={onExit}>← Startmenü</button></div></header>
    <section className="lobby-shell"><div className="lobby-main"><p className="eyebrow">Euer Spielraum</p><h1>Alle an Bord?</h1><p className="lede">Teilt den Code oder lasst den QR-Code scannen. Sobald alle bereit sind, geht’s los.</p>
      <div className="room-code"><span>Raumcode</span><strong>{state.roomCode}</strong><button onClick={() => navigator.clipboard?.writeText(state.roomCode)}>Kopieren</button></div>
      <div className="invite-row"><img src={`https://quickchart.io/qr?size=220&text=${encodeURIComponent(invite)}`} alt={`QR-Code für Raum ${state.roomCode}`} /><div><h3>Einfach scannen</h3><p>Der Einladungslink erkennt den Raum automatisch.</p><button className="secondary compact" onClick={() => navigator.clipboard?.writeText(invite)}>Link kopieren</button></div></div>
    </div><aside className="lobby-side"><div className="panel-heading"><h2>Mitspielende</h2><span>{state.players.length}/8</span></div><div className="player-list">{state.players.map((player) => <PlayerChip key={player.id} player={player} host={player.id === state.hostId} />)}</div>
      {error && <p className="error">{error}</p>}
      {me === state.hostId ? <button className="primary wide" disabled={!allReady} onClick={() => act("start")}>{allReady ? "Spiel starten" : state.players.length < 2 ? "Noch jemand fehlt" : "Noch nicht alle bereit"}</button> : <button className={own.ready ? "secondary wide" : "primary wide"} onClick={() => act("ready")}>{own.ready ? "Doch noch nicht" : "Ich bin bereit"}</button>}
      <p className="hint">{state.lastAction}</p></aside></section>
  </main>;
}

function MotionLines({ color, angle }: { color: string; angle: number }) {
  return <span className="motion-lines" style={{ "--motion-color": color, "--motion-angle": `${angle}deg` } as React.CSSProperties} aria-hidden="true"><i /><i /><i /></span>;
}

function Board({ state, me, displayPositions, motionPositions, focusField, movingPlayerId, highlightedPlayerId, motionAngle, showMotionLines, specialMotion }: { state: GameState; me: string; displayPositions: Record<string, number>; motionPositions: Record<string, BoardPoint>; focusField: number; movingPlayerId?: string; highlightedPlayerId?: string; motionAngle: number; showMotionLines: boolean; specialMotion: boolean }) {
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = boardRef.current;
    const target = viewport?.querySelector(`[data-field="${focusField}"]`) as HTMLElement | null;
    if (!viewport || !target) return;
    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const horizontalMargin = Math.min(viewport.clientWidth * .2, 110);
    const verticalMargin = Math.min(viewport.clientHeight * .2, 110);
    let left = 0; let top = 0;
    if (targetRect.left < viewportRect.left + horizontalMargin) left = targetRect.left - viewportRect.left - horizontalMargin;
    else if (targetRect.right > viewportRect.right - horizontalMargin) left = targetRect.right - viewportRect.right + horizontalMargin;
    if (targetRect.top < viewportRect.top + verticalMargin) top = targetRect.top - viewportRect.top - verticalMargin;
    else if (targetRect.bottom > viewportRect.bottom - verticalMargin) top = targetRect.bottom - viewportRect.bottom + verticalMargin;
    if (Math.abs(left) > 1 || Math.abs(top) > 1) viewport.scrollBy({ left, top, behavior: "smooth" });
  }, [focusField]);
  useEffect(() => {
    let frame = 0; let layoutFrame = 0;
    const syncFullscreenPosition = () => {
      window.cancelAnimationFrame(frame); window.cancelAnimationFrame(layoutFrame);
      frame = window.requestAnimationFrame(() => {
        layoutFrame = window.requestAnimationFrame(() => {
          const viewport = boardRef.current;
          if (!viewport) return;
          if (document.fullscreenElement) {
            viewport.scrollTo({ left: 0, top: 0, behavior: "auto" });
            return;
          }
          const target = viewport.querySelector(`[data-field="${focusField}"]`) as HTMLElement | null;
          if (!target) return;
          viewport.scrollTo({ left: target.offsetLeft + target.offsetWidth / 2 - viewport.clientWidth / 2, top: target.offsetTop + target.offsetHeight / 2 - viewport.clientHeight / 2, behavior: "smooth" });
        });
      });
    };
    document.addEventListener("fullscreenchange", syncFullscreenPosition);
    return () => { document.removeEventListener("fullscreenchange", syncFullscreenPosition); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(layoutFrame); };
  }, [focusField]);
  const ordered = useMemo(() => Array.from({ length: 10 }, (_, visualRow) => {
    const gameRow = 9 - visualRow;
    return Array.from({ length: 10 }, (_, col) => gameRow % 2 === 0 ? gameRow * 10 + col + 1 : gameRow * 10 + (10 - col));
  }).flat(), []);
  return <div className="board-viewport" ref={boardRef}><div className="board" aria-label="AVEGA Spielfeld mit 100 Feldern">
    {ordered.map((number) => { const field = fieldByNumber[number]; const occupants = state.players.filter((player) => !motionPositions[player.id] && displayPositions[player.id] === number); const tokenLayout = occupants.length <= 1 ? "solo" : occupants.length === 2 ? "duo" : occupants.length === 3 ? "trio" : occupants.length === 4 ? "quartet" : occupants.length <= 6 ? "dense" : "crowded";
      return <div key={number} data-field={number} aria-label={`Feld ${number}${field.fieldType !== "normal" ? ", Spezialfeld" : ""}`} className={`field ${field.fieldType}`}>
        <span className="field-number">{number}</span>
        <div className={`tokens ${tokenLayout}`}>{occupants.map((player) => { const color = pawnColor(player.color); const highlighted = player.id === highlightedPlayerId; return <span key={player.id} className={`token-wrap ${highlighted ? "active-token" : ""}`} style={highlighted ? { "--active-token-color": color } as React.CSSProperties : undefined}>{showMotionLines && player.id === movingPlayerId && <MotionLines color={color} angle={motionAngle} />}<span className={`token ${player.id === me ? "mine" : ""}`} style={{ background: color }} title={player.name}><i /></span></span>; })}</div>
      </div>;
    })}
    {Object.entries(motionPositions).map(([playerId, point]) => { const player = state.players.find((entry) => entry.id === playerId); if (!player) return null; const color = pawnColor(player.color); return <span key={playerId} className={`token-wrap moving-token ${specialMotion ? "special-motion" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>{showMotionLines && playerId === movingPlayerId && <MotionLines color={color} angle={motionAngle} />}<span className={`token ${playerId === me ? "mine" : ""}`} style={{ background: color }} title={player.name}><i /></span></span>; })}
  </div></div>;
}

const diePips: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function DieFace({ value }: { value: number }) {
  return <span className="die-face" aria-hidden="true">{diePips[value].map((position) => <i key={position} className={`pip pip-${position}`} />)}</span>;
}

type GameAudio = { dice: () => void; goal: () => void; stop: () => void };

function createGameAudio(): GameAudio | null {
  const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  const context = new AudioContextConstructor();
  const master = context.createGain();
  master.gain.value = .42;
  master.connect(context.destination);
  const musicFilter = context.createBiquadFilter();
  const musicBus = context.createGain();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 4400;
  musicFilter.Q.value = .2;
  musicBus.gain.value = .76;
  musicBus.connect(musicFilter).connect(master);
  let stopped = false;
  let loopTimer = 0;
  const beat = .43;
  const melody: Array<[number | null, number]> = [
    [67, 1.5], [69, .5], [71, 1], [72, 1], [71, 1], [69, 1],
    [64, 1.5], [67, .5], [69, 1], [71, 1], [69, 1], [67, 1],
    [65, 1.5], [69, .5], [72, 1], [74, 1], [72, 1], [69, 1],
    [67, 2], [64, 1], [62, 1], [64, 1], [67, 1],
    [69, 1.5], [71, .5], [72, 1], [76, 1], [74, 1], [72, 1],
    [71, 1.5], [69, .5], [67, 1], [66, 1], [67, 1], [69, 1],
    [67, 1], [64, 1], [62, 1], [65, 1], [64, 1], [62, 1],
    [60, 2], [64, 1], [67, 1], [64, 1], [60, 1],
  ];
  const harmony = [[48, 52, 55], [52, 55, 59], [53, 57, 60], [48, 52, 55], [45, 48, 52], [50, 53, 57], [43, 47, 50], [48, 52, 55]];
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  function tone(midi: number, start: number, duration: number, volume: number, type: OscillatorType = "triangle") {
    if (stopped) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency(midi);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + .04);
  }
  function musicTone(midi: number, start: number, duration: number, volume: number) {
    if (stopped) return;
    const noteLength = Math.min(2.8, Math.max(.72, duration * 1.65));
    const partials = [
      { multiple: 1, level: 1, type: "triangle" as OscillatorType },
      { multiple: 2, level: .2, type: "sine" as OscillatorType },
      { multiple: 3, level: .075, type: "sine" as OscillatorType },
      { multiple: 4, level: .035, type: "sine" as OscillatorType },
    ];
    partials.forEach(({ multiple, level, type }, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency(midi) * multiple;
      oscillator.detune.value = index % 2 === 0 ? -1.2 : 1.2;
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume * level, start + .009);
      gain.gain.exponentialRampToValueAtTime(volume * level * .24, start + Math.min(.34, noteLength * .3));
      gain.gain.exponentialRampToValueAtTime(.0001, start + noteLength);
      oscillator.connect(gain).connect(musicBus);
      oscillator.start(start);
      oscillator.stop(start + noteLength + .04);
    });
  }
  const phraseBeats = melody.reduce((total, [, duration]) => total + duration, 0);
  const phraseDuration = phraseBeats * beat;
  let nextPhrase = context.currentTime + .08;
  function schedulePhrase() {
    const start = nextPhrase;
    let cursor = 0;
    melody.forEach(([note, duration]) => {
      if (note !== null) musicTone(note, start + cursor * beat, duration * beat * .94, .042);
      cursor += duration;
    });
    harmony.forEach(([root, third, fifth], bar) => {
      const barStart = start + bar * beat * 6;
      musicTone(root, barStart, beat * 5.7, .018);
      musicTone(root + 12, barStart + beat * .15, beat * 1.7, .015);
      musicTone(third + 12, barStart + beat * 2.15, beat * 1.7, .014);
      musicTone(fifth + 12, barStart + beat * 4.15, beat * 1.55, .014);
    });
    nextPhrase += phraseDuration;
  }
  schedulePhrase();
  loopTimer = window.setInterval(() => { if (nextPhrase < context.currentTime + 4) schedulePhrase(); }, 1000);
  void context.resume();
  return {
    dice() {
      const now = context.currentTime + .01;
      [76, 72, 79].forEach((note, index) => tone(note, now + index * .055, .07, .09, "square"));
    },
    goal() {
      const now = context.currentTime + .03;
      [60, 64, 67, 72].forEach((note, index) => tone(note, now + index * .13, .3, .12, index === 3 ? "sine" : "triangle"));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(loopTimer);
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + .18);
      window.setTimeout(() => { void context.close(); }, 220);
    },
  };
}

function Game({ state, me, act, error, localMode = false, onExit }: { state: GameState; me: string; act: (action: string, extra?: object) => Promise<void>; error: string; localMode?: boolean; onExit: () => void }) {
  const active = state.players.find((entry) => entry.id === state.activePlayer)!; const ownTurn = localMode ? !active?.isBot : active?.id === me; const [rolling, setRolling] = useState(false); const [animatedFace, setAnimatedFace] = useState(5);
  const [eventVisible, setEventVisible] = useState(false); const [placementPlayerId, setPlacementPlayerId] = useState<string | null>(null); const [rematchPromptVisible, setRematchPromptVisible] = useState(false); const [rulesVisible, setRulesVisible] = useState(false); const [sound, setSound] = useState(false); const [actingPlayerId, setActingPlayerId] = useState<string | null>(null); const [positions, setPositions] = useState<Record<string, number>>(() => Object.fromEntries(state.players.map((entry) => [entry.id, entry.position]))); const [motionPositions, setMotionPositions] = useState<Record<string, BoardPoint>>({}); const [isMoving, setIsMoving] = useState(false); const [specialMotion, setSpecialMotion] = useState(false); const [motionAngle, setMotionAngle] = useState(0); const [showMotionLines, setShowMotionLines] = useState(false);
  const audioRef = useRef<GameAudio | null>(null);
  const seenMove = useRef(state.lastMove?.id ?? "");
  useEffect(() => () => { audioRef.current?.stop(); audioRef.current = null; }, []);
  useEffect(() => {
    if (state.lastMove || isMoving) return;
    setPositions(Object.fromEntries(state.players.map((entry) => [entry.id, entry.position])));
    setMotionPositions({});
  }, [state.updatedAt, state.lastMove?.id, isMoving]);
  useEffect(() => {
    if (rolling || !state.lastMove || seenMove.current === state.lastMove.id) return;
    seenMove.current = state.lastMove.id; const move = state.lastMove; const finalPositions = Object.fromEntries(state.players.map((entry) => [entry.id, entry.position])); let cancelled = false;
    const moveStart = positions[move.playerId] || 1; const firstStep = move.path[0];
    if (firstStep) setMotionAngle(movementAngle(fieldCenter(moveStart), fieldCenter(firstStep)));
    setIsMoving(true); setSpecialMotion(false); setEventVisible(false); setShowMotionLines(Boolean(firstStep));
    const pause = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));
    async function animate() {
      await pause(400);
      if (cancelled) return;
      let previousField = moveStart;
      setMotionPositions((old) => ({ ...old, [move.playerId]: fieldCenter(previousField) }));
      await pause(40);
      for (const next of move.path) { setMotionAngle(movementAngle(fieldCenter(previousField), fieldCenter(next))); setMotionPositions((old) => ({ ...old, [move.playerId]: fieldCenter(next) })); await pause(320); if (cancelled) return; setPositions((old) => ({ ...old, [move.playerId]: next })); previousField = next; }
      const landing = move.path.at(-1); const finalField = finalPositions[move.playerId];
      const event = state.lastEvent;
      const hasCurrentEvent = Boolean(landing && event && event.playerId === move.playerId && event.fieldNumber === landing);
      const reachedGoal = Boolean(hasCurrentEvent && landing === 100);
      setShowMotionLines(false);
      if (hasCurrentEvent && !reachedGoal) setEventVisible(true);
      if (landing && finalField && landing !== finalField) {
        await pause(1700);
        if (cancelled) return;
        let previousPoint = fieldCenter(landing); const specialPath = specialMotionPath(landing, finalField);
        if (specialPath[0]) setMotionAngle(movementAngle(previousPoint, specialPath[0]));
        setSpecialMotion(true); setShowMotionLines(Boolean(specialPath[0]));
        for (const point of specialPath) { setMotionAngle(movementAngle(previousPoint, point)); await pause(75); if (cancelled) return; setMotionPositions((old) => ({ ...old, [move.playerId]: point })); previousPoint = point; }
      }
      if (cancelled) return;
      setMotionPositions((old) => { const next = { ...old }; delete next[move.playerId]; return next; });
      setPositions(finalPositions); setSpecialMotion(false); setShowMotionLines(false);
      if (reachedGoal) {
        audioRef.current?.goal();
        await pause(800);
        if (cancelled) return;
        setPlacementPlayerId(move.playerId);
      }
      setIsMoving(false); setActingPlayerId(null);
    }
    void animate();
    return () => { cancelled = true; };
  }, [state.lastMove?.id, rolling]);
  useEffect(() => { if (state.lastMove?.id) setEventVisible(false); }, [state.lastMove?.id]);
  const placements = state.placements ?? (state.winner ? [state.winner] : []);
  const remainingPlayers = state.players.filter((entry) => entry.position < 100);
  const gameOver = state.status === "finished" || (placements.length > 0 && remainingPlayers.length <= 1);
  async function performRoll() {
    if (rolling || isMoving) return;
    if (gameOver) { setRematchPromptVisible(true); return; }
    setActingPlayerId(active.id);
    audioRef.current?.dice();
    setEventVisible(false); setRolling(true);
    const timer = window.setInterval(() => setAnimatedFace(crypto.getRandomValues(new Uint32Array(1))[0] % 6 + 1), 75);
    await Promise.all([act("roll"), new Promise((resolve) => window.setTimeout(resolve, 850))]);
    window.clearInterval(timer); setRolling(false);
  }
  async function roll() { if (!ownTurn) return; await performRoll(); }
  const focusField = positions[state.lastMove?.playerId || state.activePlayer] || active?.position || 1;
  const placedPlayer = state.players.find((entry) => entry.id === placementPlayerId);
  const placement = placementPlayerId ? placements.indexOf(placementPlayerId) + 1 : 0;
  async function startRematch() {
    await act("rematch");
    setPositions(Object.fromEntries(state.players.map((entry) => [entry.id, 1])));
    setMotionPositions({});
    setPlacementPlayerId(null);
    setRematchPromptVisible(false);
  }
  function toggleSound() {
    if (sound) {
      audioRef.current?.stop();
      audioRef.current = null;
      setSound(false);
      return;
    }
    const audio = createGameAudio();
    if (!audio) return;
    audioRef.current = audio;
    setSound(true);
  }
  useEffect(() => {
    if (!localMode || !active?.isBot || rolling || isMoving || gameOver || placementPlayerId || rematchPromptVisible || rulesVisible) return;
    const timer = window.setTimeout(() => { void performRoll(); }, 1300);
    return () => window.clearTimeout(timer);
  }, [localMode, active?.id, active?.isBot, rolling, isMoving, gameOver, placementPlayerId, rematchPromptVisible, rulesVisible, state.turnNumber]);
  const displayedPlayer = state.players.find((entry) => entry.id === actingPlayerId) ?? active;
  const dev = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev");
  return <main className="game-page"><header className="game-header"><Logo /><div><button className="back-button" onClick={onExit}>← Startmenü</button><span className="room-pill">{localMode ? "Ein Gerät" : state.roomCode}</span><button className={`icon-button sound-toggle ${sound ? "active" : ""}`} onClick={toggleSound} aria-label={sound ? "Musik ausschalten" : "Musik einschalten"} aria-pressed={sound} title={sound ? "Musik ausschalten" : "Musik einschalten"}>♪</button></div></header>
    <div className="game-layout"><section className="board-panel"><div className="turn-banner"><span className="mini-token" style={{ background: pawnColor(displayedPlayer?.color || playerColors[0]) }} /><div><small>Am Zug</small><strong>{displayedPlayer?.name}</strong></div><p>{state.lastAction}</p></div><Board state={state} me={localMode ? displayedPlayer?.id : me} displayPositions={positions} motionPositions={motionPositions} focusField={focusField} movingPlayerId={isMoving ? state.lastMove?.playerId : undefined} highlightedPlayerId={!rolling && !isMoving ? state.activePlayer : undefined} motionAngle={motionAngle} showMotionLines={showMotionLines} specialMotion={specialMotion} /></section>
      <aside className="game-sidebar"><div className="dice-panel"><p className="eyebrow">Zug {state.turnNumber}</p><button className={`die ${rolling ? "rolling" : ""}`} onClick={() => void roll()} disabled={rolling || isMoving || (!gameOver && !ownTurn)} aria-label={gameOver ? "Revanche anfragen" : "Würfeln"}><DieFace value={rolling ? animatedFace : state.diceResult || 5} /></button><h2>{isMoving ? `${displayedPlayer?.name} ist unterwegs …` : rolling ? `${displayedPlayer?.name} würfelt …` : gameOver ? "Partie beendet" : localMode && active?.isBot ? "Computer ist dran." : localMode ? `${active?.name} ist dran.` : ownTurn ? "Du bist dran." : `${active?.name} würfelt.`}</h2><p>{isMoving ? "Die Figur folgt dem Spielweg." : rolling ? "Der Würfel entscheidet den nächsten Schritt." : gameOver ? "Klicke auf den Würfel, um eine Revanche zu starten." : localMode && active?.isBot ? "Der Computer würfelt gleich automatisch." : localMode ? "Würfeln und danach das Gerät weitergeben." : ownTurn ? "Tippe auf den Würfel." : "Auf allen Geräten geht es gleich weiter."}</p>{error && <p className="error">{error}</p>}</div>
        <div className={`event-dock ${eventVisible ? "has-event" : ""}`} aria-live="polite"><div className="panel-heading"><h3>Hinweis</h3>{eventVisible && state.lastEvent && <span>Feld {state.lastEvent.fieldNumber}</span>}</div>{eventVisible && state.lastEvent ? <div className="event-dock-content"><p className="eyebrow">{fieldByNumber[state.lastEvent.fieldNumber].date || "AVEGA Geschichte"}</p><strong>{fieldByNumber[state.lastEvent.fieldNumber].title}</strong><p className="event-description">{fieldByNumber[state.lastEvent.fieldNumber].description}</p><div className="event-dock-action"><span>Spielaktion</span><b>{state.lastEvent.actionLabel}</b></div></div> : <p className="event-dock-empty">Beim nächsten Spezialfeld erscheint der aktuelle Hinweis hier.</p>}<button className="event-rules-link" onClick={() => setRulesVisible(true)}>Spielregeln anzeigen <span aria-hidden="true">→</span></button></div>
        <div className="score-panel"><div className="panel-heading"><h3>Auf dem Weg</h3><span>Feld</span></div>{[...state.players].sort((a,b) => b.position-a.position).map((player) => <div className="score" key={player.id}><span className="mini-token" style={{ background: pawnColor(player.color) }} /><b>{player.name}</b><strong>{player.position}</strong></div>)}</div>
        {dev && <div className="dev-panel"><strong>Testmodus</strong><select onChange={(e) => act("dev", { fieldNumber: Number(e.target.value) })} defaultValue=""><option value="" disabled>Feld testen …</option>{fields.filter((f) => f.fieldType !== "normal").map((f) => <option key={f.fieldNumber} value={f.fieldNumber}>{f.fieldNumber} · {f.title}</option>)}</select><select onChange={(e) => act("dev", { forceDice: Number(e.target.value) })} defaultValue=""><option value="" disabled>Nächsten Wurf setzen …</option>{[1,2,3,4,5,6].map((n) => <option key={n}>{n}</option>)}</select><button className="secondary compact" onClick={() => act("dev", { addBot: true })}>Testperson hinzufügen</button></div>}
      </aside></div>
    {placedPlayer && placement > 0 && <div className="winner-overlay"><div className="winner-card"><button className="icon-button close" onClick={() => setPlacementPlayerId(null)} aria-label="Weiterspielen">×</button><Logo /><div className="winner-token" style={{ background: pawnColor(placedPlayer.color) }} /><p className="eyebrow">Feld 100 · {placement}. Platz</p><h1>{placement}. Platz für {placedPlayer.name}!</h1><p>{remainingPlayers.length > 1 ? "Die übrigen Spielenden können weiter bis ins Ziel ziehen." : "Die Platzierungen stehen fest. Zeit für eine Revanche!"}</p><div className="winner-actions">{remainingPlayers.length > 1 && <button className="secondary" onClick={() => setPlacementPlayerId(null)}>Weiterspielen</button>}<button className="primary" onClick={startRematch}>Revanche</button></div></div></div>}
    {rulesVisible && <Rules onClose={() => setRulesVisible(false)} />}
    {rematchPromptVisible && <Dialog title="Neue Revanche starten?" onClose={() => setRematchPromptVisible(false)}><div className="rematch-prompt"><p>Diese Partie ist beendet. Sollen alle Töggeli wieder auf Feld 1 starten?</p><button className="primary wide" onClick={startRematch}>Revanche starten</button></div></Dialog>}
  </main>;
}

function Rules({ onClose }: { onClose: () => void }) {
  return <Dialog title="So wird gespielt" onClose={onClose}><div className="rules"><div className="rule-cards"><article><b>Das Ziel</b><p>Wer genau auf Feld 100 landet, gewinnt. Ist der Wurf zu hoch, läuft die Figur bis 100 und die restlichen Schritte wieder zurück.</p></article><article><b>Der Zug</b><p>Würfeln, Feld für Feld ziehen, AVEGA-Ereignis erleben. Danach ist die nächste Person dran.</p></article></div><h3>Spezialfelder</h3><div className="rules-list">{fields.filter((field) => field.popupEnabled).map((field) => <div key={field.fieldNumber}><b>{field.fieldNumber}</b><span><strong>{field.title}</strong><small>{field.actionLabel}</small></span></div>)}</div></div></Dialog>;
}

function FullscreenButton() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [standaloneFallback, setStandaloneFallback] = useState(false);
  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    setSupported(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
    setStandaloneFallback(new URLSearchParams(window.location.search).get("avegaFullscreen") === "1");
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  function openStandaloneTab() {
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("avegaFullscreen", "1");
    const next = window.open("about:blank", "_blank");
    if (!next) return;
    try {
      const resume = localStorage.getItem("avega:resume");
      if (resume) {
        next.localStorage.setItem("avega:resume", resume);
        const session = JSON.parse(resume) as { roomCode?: string; playerId?: string };
        if (session.roomCode && session.playerId) next.localStorage.setItem(`avega:${session.roomCode.toUpperCase()}`, session.playerId);
      }
      next.opener = null;
      next.location.replace(targetUrl.href);
    } catch {
      next.location.replace(targetUrl.href);
    }
  }
  async function toggle() {
    if (standaloneFallback) { window.location.replace("https://www.avega.ch/leiterspiel"); return; }
    if (!supported) { openStandaloneTab(); return; }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setSupported(false); openStandaloneTab(); }
  }
  const label = active || standaloneFallback ? "Vollbild verlassen" : supported ? "Im Vollbild öffnen" : "In einem grossen Fenster öffnen";
  return <button className={`fullscreen-button ${active || standaloneFallback ? "active" : ""}`} onClick={toggle} aria-label={label} title={label}>
    <span className="fullscreen-icon" aria-hidden="true"><i /><i /><i /><i /></span>
  </button>;
}

export default function GameApp() {
  const [preset, setPreset] = useState("");
  const [modal, setModal] = useState<"create" | "join" | "local" | "rules" | null>(null); const [state, setState] = useState<GameState | null>(null); const [playerId, setPlayerId] = useState(""); const [error, setError] = useState(""); const [localMode, setLocalMode] = useState(false); const [atStart, setAtStart] = useState(false);
  useEffect(() => {
    if (window.self === window.top) return;
    document.documentElement.classList.add("avega-embedded");
    let frame = 0; let lastHeight = 0; let targetOrigin = "*";
    try { if (document.referrer) targetOrigin = new URL(document.referrer).origin; } catch { /* Use the harmless wildcard fallback for height messages only. */ }
    const reportHeight = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const height = Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        if (Math.abs(height - lastHeight) < 2) return;
        lastHeight = height;
        window.parent.postMessage({ type: "avega-leiterspiel:resize", height }, targetOrigin);
      });
    };
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.body);
    window.addEventListener("load", reportHeight);
    window.addEventListener("resize", reportHeight);
    reportHeight();
    return () => { observer.disconnect(); window.removeEventListener("load", reportHeight); window.removeEventListener("resize", reportHeight); window.cancelAnimationFrame(frame); document.documentElement.classList.remove("avega-embedded"); };
  }, []);
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room") || "";
    if (room) { setPreset(room); setModal("join"); return; }
    const saved = localStorage.getItem("avega:resume");
    if (!saved) return;
    try {
      const session = JSON.parse(saved) as { mode?: "online" | "local"; roomCode?: string; playerId?: string; state?: GameState; atStart?: boolean };
      if (session.mode === "local" && session.state) {
        setState(session.state); setPlayerId("local"); setLocalMode(true); setAtStart(Boolean(session.atStart));
      } else if (session.mode === "online" && session.roomCode && session.playerId) {
        localStorage.setItem(`avega:${session.roomCode.toUpperCase()}`, session.playerId);
        setPreset(session.roomCode); setAtStart(Boolean(session.atStart));
      }
    } catch { localStorage.removeItem("avega:resume"); }
  }, []);
  useEffect(() => {
    if (!preset || state) return;
    const stored = localStorage.getItem(`avega:${preset.toUpperCase()}`);
    if (!stored) return;
    api(`/api/rooms/${preset}/join`, { method: "POST", body: JSON.stringify({ playerId: stored }) })
      .then((payload) => { setState(payload.state); setPlayerId(payload.playerId); setModal(null); })
      .catch(() => { localStorage.removeItem(`avega:${preset.toUpperCase()}`); localStorage.removeItem("avega:resume"); setPreset(""); setAtStart(false); });
  }, [preset, state]);
  useEffect(() => {
    if (!state || !playerId) return;
    const session = localMode
      ? { mode: "local", state, atStart }
      : { mode: "online", roomCode: state.roomCode, playerId, atStart };
    localStorage.setItem("avega:resume", JSON.stringify(session));
  }, [state, playerId, localMode, atStart]);
  useEffect(() => { if (!state || !playerId || localMode) return; const timer = window.setInterval(async () => { try { const payload = await api(`/api/rooms/${state.roomCode}?playerId=${playerId}`); setState(payload.state); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Verbindung unterbrochen."); } }, 900); return () => window.clearInterval(timer); }, [state?.roomCode, playerId, localMode]);
  async function act(action: string, extra = {}) { if (!state) return; if (localMode) { setState((current) => current ? localAction(current, action, extra) : current); return; } try { const payload = await api(`/api/rooms/${state.roomCode}/action`, { method: "POST", body: JSON.stringify({ action, playerId, ...extra }) }); setState(payload.state); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Bitte versuche es nochmals."); } }
  function exitToStart() { history.replaceState(null, "", "/"); setPreset(""); setModal(null); setError(""); setAtStart(true); }
  function resumeGame() { setAtStart(false); setModal(null); history.replaceState(null, "", localMode ? "/" : `/?room=${state?.roomCode || ""}`); }
  const content = !state || atStart
    ? <><StartScreen onCreate={() => setModal("create")} onJoin={() => setModal("join")} onLocal={() => setModal("local")} onRules={() => setModal("rules")} onResume={state ? resumeGame : undefined} resumeLabel={state ? `${localMode ? "Lokales Spiel" : `Raum ${state.roomCode}`} · Zug ${state.turnNumber}` : undefined} />{(modal === "create" || modal === "join") && <EntryForm mode={modal} presetCode={preset} onDone={(next, id) => { history.replaceState(null, "", `/?room=${next.roomCode}`); setState(next); setPlayerId(id); setLocalMode(false); setAtStart(false); setModal(null); }} onCancel={() => setModal(null)} />}{modal === "local" && <LocalSetup onDone={(next) => { history.replaceState(null, "", "/"); setLocalMode(true); setState(next); setPlayerId("local"); setAtStart(false); setModal(null); }} onCancel={() => setModal(null)} />}{modal === "rules" && <Rules onClose={() => setModal(null)} />}</>
    : state.status === "lobby" ? <Lobby state={state} me={playerId} act={act} error={error} onExit={exitToStart} /> : <Game state={state} me={playerId} act={act} error={error} localMode={localMode} onExit={exitToStart} />;
  return <>{content}<FullscreenButton /></>;
}
