import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

// 4x4 boxes => 5x5 dots
// hLines[row*4+col]: row 0..4, col 0..3 => 20 horizontal lines
// vLines[row*5+col]: row 0..3, col 0..4 => 20 vertical lines
// boxes[row*4+col]: 4x4 = 16 boxes

const H_COUNT = 20; // 5 rows * 4 cols
const V_COUNT = 20; // 4 rows * 5 cols
const BOXES_COUNT = 16;

function emptyLines() {
  return { hLines: Array(H_COUNT).fill(null), vLines: Array(V_COUNT).fill(null), boxes: Array(BOXES_COUNT).fill(null) };
}

// Check which boxes are completed after a line is drawn; returns new boxes array
function checkBoxes(hLines, vLines, boxes, owner) {
  const newBoxes = [...boxes];
  let scored = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (newBoxes[r * 4 + c]) continue;
      const top = hLines[r * 4 + c];
      const bottom = hLines[(r + 1) * 4 + c];
      const left = vLines[r * 5 + c];
      const right = vLines[r * 5 + c + 1];
      if (top && bottom && left && right) {
        newBoxes[r * 4 + c] = owner;
        scored++;
      }
    }
  }
  return { newBoxes, scored };
}

function allLinesDone(hLines, vLines) {
  return hLines.every(l => l !== null) && vLines.every(l => l !== null);
}

function countBoxes(boxes, sym) {
  return boxes.filter(b => b === sym).length;
}

// AI: greedy - complete boxes > avoid 3-sided > random
function computerMoveDAB(hLines, vLines, boxes) {
  // Find all empty lines
  function getEmpty() {
    const moves = [];
    hLines.forEach((v, i) => { if (!v) moves.push({ type: "h", idx: i }); });
    vLines.forEach((v, i) => { if (!v) moves.push({ type: "v", idx: i }); });
    return moves;
  }

  function simulateMove(hl, vl, bx, move) {
    const newHL = [...hl], newVL = [...vl];
    if (move.type === "h") newHL[move.idx] = "O";
    else newVL[move.idx] = "O";
    const { newBoxes, scored } = checkBoxes(newHL, newVL, bx, "O");
    return { newHL, newVL, newBoxes, scored };
  }

  function countThreeSided(hl, vl) {
    let count = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const top = hl[r * 4 + c] ? 1 : 0;
        const bottom = hl[(r + 1) * 4 + c] ? 1 : 0;
        const left = vl[r * 5 + c] ? 1 : 0;
        const right = vl[r * 5 + c + 1] ? 1 : 0;
        if (top + bottom + left + right === 3) count++;
      }
    }
    return count;
  }

  const empty = getEmpty();
  if (empty.length === 0) return null;

  // 1. Complete a box
  for (const move of empty) {
    const { scored } = simulateMove(hLines, vLines, boxes, move);
    if (scored > 0) return move;
  }

  // 2. Avoid giving 3-sided boxes
  const safe = empty.filter(move => {
    const { newHL, newVL } = simulateMove(hLines, vLines, boxes, move);
    return countThreeSided(newHL, newVL) === 0;
  });
  if (safe.length > 0) return safe[Math.floor(Math.random() * safe.length)];

  // 3. Random
  return empty[Math.floor(Math.random() * empty.length)];
}

function normalizeArr(raw, len, def = null) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function DotsAndBoxes() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");
  const [aiThinking, setAiThinking] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  function makeInitGame() {
    const { hLines, vLines, boxes } = emptyLines();
    return {
      id: "local",
      hLines, vLines, boxes,
      turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: "computer", player_o_name: t.computer,
      winner: null,
    };
  }

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame(makeInitGame());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  // AI move trigger
  useEffect(() => {
    if (!isComputer || !game || game.winner || game.turn !== "O" || aiThinking) return;
    setAiThinking(true);
    const { hLines, vLines, boxes } = game;
    const timer = setTimeout(() => {
      const move = computerMoveDAB(hLines, vLines, boxes);
      if (!move) { setAiThinking(false); return; }
      const newHL = [...hLines], newVL = [...vLines];
      if (move.type === "h") newHL[move.idx] = "O";
      else newVL[move.idx] = "O";
      const { newBoxes, scored } = checkBoxes(newHL, newVL, boxes, "O");
      const done = allLinesDone(newHL, newVL);
      let winner = null;
      if (done) {
        const xc = countBoxes(newBoxes, "X"), oc = countBoxes(newBoxes, "O");
        winner = xc > oc ? "X" : oc > xc ? "O" : "Draw";
      }
      const nextTurn = winner ? null : scored > 0 ? "O" : "X";
      setGame(prev => ({ ...prev, hLines: newHL, vLines: newVL, boxes: newBoxes, turn: nextTurn, winner }));
      setAiThinking(false);
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer, game?.turn, game?.winner, aiThinking]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `dotsboxes/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({
        ...data,
        hLines: normalizeArr(data.hLines, H_COUNT),
        vLines: normalizeArr(data.vLines, V_COUNT),
        boxes: normalizeArr(data.boxes, BOXES_COUNT),
        id: gameIdFromUrl,
      });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `dotsboxes/${gameIdFromUrl}/player_o`)).set(null);
      } else if (data.player_o === playerId) {
        setPlayerSymbol("O");
      } else {
        setPlayerSymbol("Spectator");
      }
    };
    init();
  }, [gameIdFromUrl, playerId, navigate, playerName, isComputer]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `dotsboxes/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame({
          ...data,
          hLines: normalizeArr(data.hLines, H_COUNT),
          vLines: normalizeArr(data.vLines, V_COUNT),
          boxes: normalizeArr(data.boxes, BOXES_COUNT),
          id: gameIdFromUrl,
        });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const { hLines, vLines, boxes } = emptyLines();
    const gRef = ref(db, "dotsboxes");
    const newRef = push(gRef);
    await set(newRef, {
      hLines, vLines, boxes, turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null, winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(makeInitGame()); setShowOverlay(false); return; }
    const id = await createOnlineGame();
    navigate(`/dotsboxes?gameId=${id}&mode=online`);
  };

  const handleLine = async (type, idx) => {
    if (!game || game.winner || aiThinking) return;
    const lineArr = type === "h" ? game.hLines : game.vLines;
    if (lineArr[idx]) return;

    if (isComputer) {
      if (game.turn !== "X") return;
      const newHL = [...game.hLines], newVL = [...game.vLines];
      if (type === "h") newHL[idx] = "X"; else newVL[idx] = "X";
      const { newBoxes, scored } = checkBoxes(newHL, newVL, game.boxes, "X");
      const done = allLinesDone(newHL, newVL);
      let winner = null;
      if (done) {
        const xc = countBoxes(newBoxes, "X"), oc = countBoxes(newBoxes, "O");
        winner = xc > oc ? "X" : oc > xc ? "O" : "Draw";
      }
      const nextTurn = winner ? null : scored > 0 ? "X" : "O";
      setGame(prev => ({ ...prev, hLines: newHL, vLines: newVL, boxes: newBoxes, turn: nextTurn, winner }));
    } else {
      if (game.turn !== playerSymbol || playerSymbol === "Spectator") return;
      const gameRef = ref(db, `dotsboxes/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.turn !== playerSymbol || fd.winner) return;
      const la = type === "h" ? fd.hLines : fd.vLines;
      if (la && la[idx]) return;
      const newHL = normalizeArr(fd.hLines, H_COUNT);
      const newVL = normalizeArr(fd.vLines, V_COUNT);
      const oldBoxes = normalizeArr(fd.boxes, BOXES_COUNT);
      if (type === "h") newHL[idx] = playerSymbol; else newVL[idx] = playerSymbol;
      const { newBoxes, scored } = checkBoxes(newHL, newVL, oldBoxes, playerSymbol);
      const done = allLinesDone(newHL, newVL);
      let winner = null;
      if (done) {
        const xc = countBoxes(newBoxes, "X"), oc = countBoxes(newBoxes, "O");
        winner = xc > oc ? "X" : oc > xc ? "O" : "Draw";
      }
      const nextSym = playerSymbol === "X" ? "O" : "X";
      const nextTurn = winner ? null : scored > 0 ? playerSymbol : nextSym;
      await update(gameRef, { hLines: newHL, vLines: newVL, boxes: newBoxes, turn: nextTurn, winner });
    }
  };

  const resetComputer = () => { setGame(makeInitGame()); setShowOverlay(false); };
  const resetOnline = async () => {
    if (!game) return;
    const { hLines, vLines, boxes } = emptyLines();
    await update(ref(db, `dotsboxes/${game.id}`), { hLines, vLines, boxes, turn: "X", winner: null });
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/dotsboxes?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">📦 {t.dotsBoxes}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="dotsboxes" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSym ? "win" : "loss";

  const myTurn = isComputer ? game.turn === "X" : game.turn === effectiveSym;
  const statusClass = game.winner === "Draw" ? "status-draw" : game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const xScore = countBoxes(game.boxes, "X");
  const oScore = countBoxes(game.boxes, "O");
  const statusText = game.winner === "Draw"
    ? `🤝 ${t.draw}`
    : game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : aiThinking ? "🤔 ..."
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  // Build grid rows
  // Row structure alternates: dot-hline-dot row, then vline-box-vline row
  const rows = [];
  for (let r = 0; r <= 4; r++) {
    // Dot + horizontal line row
    const dotRow = [];
    for (let c = 0; c <= 4; c++) {
      dotRow.push(<div key={`dot-${r}-${c}`} className="dab-dot" />);
      if (c < 4) {
        const idx = r * 4 + c;
        const val = game.hLines[idx];
        dotRow.push(
          <div
            key={`h-${r}-${c}`}
            className={`dab-hline${val === "X" ? " taken-x" : val === "O" ? " taken-o" : ""}`}
            onClick={() => !val && myTurn && !game.winner && handleLine("h", idx)}
          >
            <div className="dab-hline-inner" />
          </div>
        );
      }
    }
    rows.push(<div key={`drow-${r}`} className="dab-row">{dotRow}</div>);

    if (r < 4) {
      // Vertical line + box row
      const boxRow = [];
      for (let c = 0; c <= 4; c++) {
        const vidx = r * 5 + c;
        const val = game.vLines[vidx];
        boxRow.push(
          <div
            key={`v-${r}-${c}`}
            className={`dab-vline${val === "X" ? " taken-x" : val === "O" ? " taken-o" : ""}`}
            onClick={() => !val && myTurn && !game.winner && handleLine("v", vidx)}
          >
            <div className="dab-vline-inner" />
          </div>
        );
        if (c < 4) {
          const boxVal = game.boxes[r * 4 + c];
          boxRow.push(
            <div key={`box-${r}-${c}`} className={`dab-box${boxVal === "X" ? " box-x" : boxVal === "O" ? " box-o" : ""}`}>
              {boxVal === "X" ? "🟦" : boxVal === "O" ? "🟧" : ""}
            </div>
          );
        }
      }
      rows.push(<div key={`brow-${r}`} className="dab-box-row">{boxRow}</div>);
    }
  }

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">📦 {t.dotsBoxes}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">🟦 {nameX} ({xScore})</span>
        <span>{t.vs}</span>
        <span className="player-o">🟧 {nameO} ({oScore})</span>
        {!isComputer && <span>— {t.playAs}: <strong>{effectiveSym}</strong></span>}
      </div>

      {!isComputer && effectiveSym === "X" && !game.player_o && (
        <div className="invite-box">
          <p>{t.inviteFriend}</p>
          <div className="invite-row">
            <input readOnly value={inviteLink} className="invite-input" onClick={(e) => e.target.select()} />
            <button className="btn-primary" onClick={() => copyLink(inviteLink)}>{copied ? "✅" : t.copyLink}</button>
          </div>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.82rem" }}>{t.waitingOpponent}</p>
        </div>
      )}

      <div className="dab-container">{rows}</div>

      <button className="btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "0.5rem" }}>
        {t.gameSelection}
      </button>

      {showOverlay && overlayResult && (
        <GameResultOverlay
          result={overlayResult}
          winnerName={game.winner === "X" ? nameX : nameO}
          onClose={() => setShowOverlay(false)}
        >
          <button className="btn-primary" onClick={() => { setShowOverlay(false); isComputer ? resetComputer() : resetOnline(); }}>{t.rematch}</button>
          {!isComputer && <button className="btn-primary" onClick={() => { setShowOverlay(false); handleStart(); }}>{t.newGame}</button>}
          <button className="btn-secondary" onClick={() => setShowOverlay(false)}>✕</button>
        </GameResultOverlay>
      )}

      {showRules && <RulesModal gameKey="dotsboxes" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default DotsAndBoxes;
