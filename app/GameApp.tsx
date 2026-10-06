"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { fieldByNumber, fields, fieldGridPosition, movementConnections, playerColors } from "../lib/game-data";

type Player = { id: string; name: string; color: string; position: number; ready: boolean; skipTurns: number; nextRollMultiplier: number; isBot?: boolean };
type GameState = {
  roomCode: string; status: "lobby" | "playing" | "finished"; hostId: string; players: Player[]; playerOrder: string[]; activePlayer: string;
  diceResult: number | null; winner: string | null; lastAction: string; updatedAt: number; turnNumber: number;
  lastEvent: { id: string; fieldNumber: number; playerId: string; actionLabel: string; affectedPlayerIds: string[] } | null;
  lastMove: { id: string; playerId: string; path: number[]; secondary?: { playerId: string; from: number; to: number } } | null;
};

const api = async (path: string, options?: RequestInit) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Etwas ist schiefgelaufen.");
  return payload;
};

function Logo() {
  return <div className="logo" aria-label="avega – passion for IT"><span className="logo-mark">⌁</span><span>avega</span><small>passion for IT.</small></div>;
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

function StartScreen({ onCreate, onJoin, onRules }: { onCreate: () => void; onJoin: () => void; onRules: () => void }) {
  return <main className="start-screen">
    <header className="topbar"><Logo /><button className="text-button" onClick={onRules}>Spielregeln</button></header>
    <section className="hero">
      <div className="hero-copy"><p className="eyebrow">10 Jahre · 100 Felder · eine Geschichte</p><h1>Das AVEGA<br /><em>Leiterspiel.</em></h1><p className="lede">Gemeinsam würfeln, AVEGA-Geschichten entdecken und als erste Person Feld 100 erreichen.</p>
        <div className="hero-actions"><button className="primary" onClick={onCreate}>Spiel erstellen <span>↗</span></button><button className="secondary" onClick={onJoin}>Spiel beitreten</button></div>
        <div className="facts"><span>2–8 Spielende</span><span>Keine Anmeldung</span><span>Direkt im Browser</span></div>
      </div>
      <div className="hero-board" aria-hidden="true"><img src="/avega-board-reference.png" alt="" /><div className="hero-token one" /><div className="hero-token two" /><div className="mini-die">⚄</div></div>
    </section>
    <footer><span>Eine digitale Reise durch zehn Jahre avega.</span><span>passion for IT.</span></footer>
  </main>;
}

function PlayerChip({ player, active, host }: { player: Player; active?: boolean; host?: boolean }) {
  return <div className={`player-chip ${active ? "active" : ""}`}><span className="mini-token" style={{ background: player.color }} /><div><strong>{player.name}</strong><small>{host ? "Raumleitung" : player.ready ? "Bereit" : "Wartet"}</small></div>{active && <b>am Zug</b>}</div>;
}

function Lobby({ state, me, act, error }: { state: GameState; me: string; act: (action: string, extra?: object) => void; error: string }) {
  const invite = typeof window === "undefined" ? "" : `${window.location.origin}/?room=${state.roomCode}`;
  const own = state.players.find((entry) => entry.id === me)!;
  const allReady = state.players.length >= 2 && state.players.every((entry) => entry.ready || entry.isBot);
  return <main className="lobby-page"><header className="game-header"><Logo /><span className="online-dot">● Live verbunden</span></header>
    <section className="lobby-shell"><div className="lobby-main"><p className="eyebrow">Euer Spielraum</p><h1>Alle an Bord?</h1><p className="lede">Teilt den Code oder lasst den QR-Code scannen. Sobald alle bereit sind, geht’s los.</p>
      <div className="room-code"><span>Raumcode</span><strong>{state.roomCode}</strong><button onClick={() => navigator.clipboard?.writeText(state.roomCode)}>Kopieren</button></div>
      <div className="invite-row"><img src={`https://quickchart.io/qr?size=220&text=${encodeURIComponent(invite)}`} alt={`QR-Code für Raum ${state.roomCode}`} /><div><h3>Einfach scannen</h3><p>Der Einladungslink erkennt den Raum automatisch.</p><button className="secondary compact" onClick={() => navigator.clipboard?.writeText(invite)}>Link kopieren</button></div></div>
    </div><aside className="lobby-side"><div className="panel-heading"><h2>Mitspielende</h2><span>{state.players.length}/8</span></div><div className="player-list">{state.players.map((player) => <PlayerChip key={player.id} player={player} host={player.id === state.hostId} />)}</div>
      {error && <p className="error">{error}</p>}
      {me === state.hostId ? <button className="primary wide" disabled={!allReady} onClick={() => act("start")}>{allReady ? "Spiel starten" : state.players.length < 2 ? "Noch jemand fehlt" : "Noch nicht alle bereit"}</button> : <button className={own.ready ? "secondary wide" : "primary wide"} onClick={() => act("ready")}>{own.ready ? "Doch noch nicht" : "Ich bin bereit"}</button>}
      <p className="hint">{state.lastAction}</p></aside></section>
  </main>;
}

function Board({ state, me, displayPositions, focusField }: { state: GameState; me: string; displayPositions: Record<string, number>; focusField: number }) {
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boardRef.current?.querySelector(`[data-field="${focusField}"]`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }); }, [focusField]);
  const ordered = useMemo(() => Array.from({ length: 10 }, (_, visualRow) => {
    const gameRow = 9 - visualRow;
    return Array.from({ length: 10 }, (_, col) => gameRow % 2 === 0 ? gameRow * 10 + col + 1 : gameRow * 10 + (10 - col));
  }).flat(), []);
  return <div className="board-viewport" ref={boardRef}><div className="board" aria-label="AVEGA Spielfeld mit 100 Feldern">
    <div className="connection-layer" aria-hidden="true">{movementConnections.map((connection) => {
      const start = fieldGridPosition(connection.from); const end = fieldGridPosition(connection.to);
      const x1 = (start.column + .5) * 10; const y1 = (start.rowFromTop + .5) * 10; const x2 = (end.column + .5) * 10; const y2 = (end.rowFromTop + .5) * 10;
      const length = Math.hypot(x2 - x1, y2 - y1); const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return <div key={connection.from} className={`connection ${connection.type}`} style={{ left: `${x1}%`, top: `${y1}%`, width: `${length}%`, transform: `rotate(${angle}deg)` }}><span>{connection.type === "ladder" ? "╫" : "›"}</span></div>;
    })}</div>
    {ordered.map((number) => { const field = fieldByNumber[number]; const occupants = state.players.filter((player) => displayPositions[player.id] === number);
      return <div key={number} data-field={number} className={`field ${field.fieldType} ${number === focusField ? "focused" : ""}`} style={field.illustration ? { backgroundImage: `linear-gradient(rgba(255,255,255,.78),rgba(255,255,255,.78)),url(${field.illustration})` } : undefined}>
        <span className="field-number">{number}</span>{field.fieldType !== "normal" && <span className="event-dot" aria-label="Spezialfeld" />}
        <div className="tokens">{occupants.map((player, index) => <span key={player.id} className={`token ${player.id === me ? "mine" : ""}`} style={{ background: player.color, transform: `translate(${(index % 3) * 7 - 7}px, ${Math.floor(index / 3) * 7}px)` }} title={player.name}><i /></span>)}</div>
      </div>;
    })}
  </div></div>;
}

function EventCard({ state, onClose }: { state: GameState; onClose: () => void }) {
  if (!state.lastEvent) return null; const event = state.lastEvent; const field = fieldByNumber[event.fieldNumber]; const player = state.players.find((entry) => entry.id === event.playerId);
  return <div className="event-card" role="dialog" aria-live="polite"><button className="icon-button close" onClick={onClose} aria-label="Ereignis schliessen">×</button><div className="event-art"><img src={field.illustration} alt="Originalillustration des Feldes" /><b>Feld {field.fieldNumber}</b></div><div className="event-copy"><p className="eyebrow">{field.date || "AVEGA Geschichte"}</p><h2>{field.title}</h2><p>{field.description}</p><div className="event-action"><span>Spielaktion für {player?.name}</span><strong>{field.actionLabel}</strong></div></div></div>;
}

function Game({ state, me, act, error }: { state: GameState; me: string; act: (action: string, extra?: object) => Promise<void>; error: string }) {
  const active = state.players.find((entry) => entry.id === state.activePlayer)!; const ownTurn = active?.id === me; const [rolling, setRolling] = useState(false);
  const [dismissedEvent, setDismissedEvent] = useState(""); const [sound, setSound] = useState(true); const [positions, setPositions] = useState<Record<string, number>>(() => Object.fromEntries(state.players.map((entry) => [entry.id, entry.position])));
  const seenMove = useRef("");
  useEffect(() => {
    if (!state.lastMove || seenMove.current === state.lastMove.id) { setPositions(Object.fromEntries(state.players.map((entry) => [entry.id, entry.position]))); return; }
    seenMove.current = state.lastMove.id; const move = state.lastMove; let index = 0;
    const timer = window.setInterval(() => { const next = move.path[index++]; if (next) setPositions((old) => ({ ...old, [move.playerId]: next })); else { window.clearInterval(timer); setPositions(Object.fromEntries(state.players.map((entry) => [entry.id, entry.position]))); } }, 170);
    return () => window.clearInterval(timer);
  }, [state.lastMove?.id, state.players]);
  async function roll() { if (!ownTurn || rolling) return; setRolling(true); await act("roll"); window.setTimeout(() => setRolling(false), 700); }
  const focusField = positions[state.lastMove?.playerId || state.activePlayer] || active?.position || 1;
  const winner = state.players.find((entry) => entry.id === state.winner);
  const dev = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev");
  return <main className="game-page"><header className="game-header"><Logo /><div><span className="room-pill">{state.roomCode}</span><button className="icon-button" onClick={() => setSound(!sound)} aria-label={sound ? "Ton ausschalten" : "Ton einschalten"}>{sound ? "♪" : "×"}</button></div></header>
    <div className="game-layout"><section className="board-panel"><div className="turn-banner"><span className="mini-token" style={{ background: active?.color }} /><div><small>Am Zug</small><strong>{active?.name}</strong></div><p>{state.lastAction}</p></div><Board state={state} me={me} displayPositions={positions} focusField={focusField} /></section>
      <aside className="game-sidebar"><div className="dice-panel"><p className="eyebrow">Zug {state.turnNumber}</p><button className={`die ${rolling ? "rolling" : ""}`} onClick={roll} disabled={!ownTurn || rolling} aria-label="Würfeln"><span>{state.diceResult ? ["⚀","⚁","⚂","⚃","⚄","⚅"][state.diceResult - 1] : "⚄"}</span></button><h2>{ownTurn ? "Du bist dran." : `${active?.name} würfelt.`}</h2><p>{ownTurn ? "Tippe auf den Würfel." : "Auf allen Geräten geht es gleich weiter."}</p>{error && <p className="error">{error}</p>}</div>
        <div className="score-panel"><div className="panel-heading"><h3>Auf dem Weg</h3><span>Feld</span></div>{[...state.players].sort((a,b) => b.position-a.position).map((player) => <div className="score" key={player.id}><span className="mini-token" style={{ background: player.color }} /><b>{player.name}</b><strong>{player.position}</strong></div>)}</div>
        {dev && <div className="dev-panel"><strong>Testmodus</strong><select onChange={(e) => act("dev", { fieldNumber: Number(e.target.value) })} defaultValue=""><option value="" disabled>Feld testen …</option>{fields.filter((f) => f.fieldType !== "normal").map((f) => <option key={f.fieldNumber} value={f.fieldNumber}>{f.fieldNumber} · {f.title}</option>)}</select><select onChange={(e) => act("dev", { forceDice: Number(e.target.value) })} defaultValue=""><option value="" disabled>Nächsten Wurf setzen …</option>{[1,2,3,4,5,6].map((n) => <option key={n}>{n}</option>)}</select><button className="secondary compact" onClick={() => act("dev", { addBot: true })}>Testperson hinzufügen</button></div>}
      </aside></div>
    {state.lastEvent && dismissedEvent !== state.lastEvent.id && <EventCard state={state} onClose={() => setDismissedEvent(state.lastEvent!.id)} />}
    {state.status === "finished" && <div className="winner-overlay"><div className="winner-card"><Logo /><div className="winner-token" style={{ background: winner?.color }} /><p className="eyebrow">Feld 100</p><h1>{winner?.name} gewinnt!</h1><p>Zehn Jahre avega. Jetzt wird angestossen.</p>{me === state.hostId ? <button className="primary" onClick={() => act("rematch")}>Revanche</button> : <p>Die Raumleitung kann eine Revanche starten.</p>}</div></div>}
  </main>;
}

function Rules({ onClose }: { onClose: () => void }) {
  return <Dialog title="So wird gespielt" onClose={onClose}><div className="rules"><div className="rule-cards"><article><b>Das Ziel</b><p>Wer zuerst Feld 100 erreicht, gewinnt. Eine exakte Augenzahl ist nicht nötig.</p></article><article><b>Der Zug</b><p>Würfeln, Feld für Feld ziehen, AVEGA-Ereignis erleben. Danach ist die nächste Person dran.</p></article></div><h3>Spezialfelder</h3><div className="rules-list">{fields.filter((field) => field.popupEnabled).map((field) => <div key={field.fieldNumber}><b>{field.fieldNumber}</b><span><strong>{field.title}</strong><small>{field.actionLabel}</small></span></div>)}</div></div></Dialog>;
}

export default function GameApp() {
  const [preset, setPreset] = useState("");
  const [modal, setModal] = useState<"create" | "join" | "rules" | null>(null); const [state, setState] = useState<GameState | null>(null); const [playerId, setPlayerId] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room") || "";
    if (room) { setPreset(room); setModal("join"); }
  }, []);
  useEffect(() => {
    if (!preset || state) return;
    const stored = localStorage.getItem(`avega:${preset.toUpperCase()}`);
    if (!stored) return;
    api(`/api/rooms/${preset}/join`, { method: "POST", body: JSON.stringify({ playerId: stored }) })
      .then((payload) => { setState(payload.state); setPlayerId(payload.playerId); setModal(null); })
      .catch(() => localStorage.removeItem(`avega:${preset.toUpperCase()}`));
  }, [preset, state]);
  useEffect(() => { if (!state || !playerId) return; const timer = window.setInterval(async () => { try { const payload = await api(`/api/rooms/${state.roomCode}?playerId=${playerId}`); setState(payload.state); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Verbindung unterbrochen."); } }, 900); return () => window.clearInterval(timer); }, [state?.roomCode, playerId]);
  async function act(action: string, extra = {}) { if (!state) return; try { const payload = await api(`/api/rooms/${state.roomCode}/action`, { method: "POST", body: JSON.stringify({ action, playerId, ...extra }) }); setState(payload.state); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Bitte versuche es nochmals."); } }
  if (!state) return <><StartScreen onCreate={() => setModal("create")} onJoin={() => setModal("join")} onRules={() => setModal("rules")} />{(modal === "create" || modal === "join") && <EntryForm mode={modal} presetCode={preset} onDone={(next, id) => { history.replaceState(null, "", `/?room=${next.roomCode}`); setState(next); setPlayerId(id); setModal(null); }} onCancel={() => setModal(null)} />}{modal === "rules" && <Rules onClose={() => setModal(null)} />}</>;
  return state.status === "lobby" ? <Lobby state={state} me={playerId} act={act} error={error} /> : <Game state={state} me={playerId} act={act} error={error} />;
}
