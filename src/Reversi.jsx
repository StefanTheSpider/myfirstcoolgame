import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const SIZE = 8;
const EMPTY_BOARD = Array(SIZE * SIZE).fill(null);

const DIRECTIONS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

// Position weight matrix for AI
const WEIGHTS = [
  120,-20, 20,  5,  5, 20,-20,120,
  -20,-40, -5, -5, -5, -5,-40,-20,
   20, -5, 15,  3,  3, 15, -5, 20,
    5, -5,  3,  3,  3,  3, -5,  5,
    5, -5,  3,  3,  3,  3, -5,  5,
   20, -5, 15,  3,  3, 15, -5, 20,
  -20,-40, -5, -5, -5, -5,-40,-20,
  120,-20, 20,  5,  5, 20,-20,120,
];

function initBoard() {
  const b = [...EMPTY_BOARD];
  b[27] = "X"; b[36] = "X";
  b[28] = "O"; b[35] = "O";
  return b;
}

function getFlips(board, index, sym) {
  const opp = sym === "X" ? "O" : "X";
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  if (board[index]) return [];
  const flips = [];
  for (const [dr, dc] of DIRECTIONS) {
    const line = [];
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const idx = r * SIZE + c;
      if (board[idx] === opp) { line.push(idx); r += dr; c += dc; }
      else if (board[idx] === sym) { flips.push(...line); break; }
      else break;
    }
  }
  return flips;
}

function flipPieces(board, index, sym) {
  const flips = getFlips(board, index, sym);
  if (flips.length === 0) return null;
  const nb = [...board];
  nb[index] = sym;
  flips.forEach(i => { nb[i] = sym; });
  return nb;
}

function getValidMoves(board, sym) {
  return board.map((_, i) => i).filter(i => !board[i] && getFlips(board, i, sym).length > 0);
}

function countPieces(board, sym) {
  return board.filter(c => c === sym).length;
}

function computerMoveReversi(board) {
  const moves = getValidMoves(board, "O");
  if (moves.length === 0) return null;
  // Score each move by position weight + number of flips
  let bestMove = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const flips = getFlips(board, m, "O");
    const s = WEIGHTS[m] + flips.length * 3;
    if (s > bestScore) { bestScore = s; bestMove = m; }
  }
  return bestMove;
}

function checkGameEnd(board) {
  const xMoves = getValidMoves(board, "X");
  const oMoves = getValidMoves(board, "O");
  const full = board.every(c => c !== null);
  if (full || (xMoves.length === 0 && oMoves.length === 0)) {
    const xCount = countPieces(board, "X");
    const oCount = countPieces(board, "O");
    if (xCount > oCount) return "X";
    if (oCount > xCount) return "O";
    return "Draw";
  }
  return null;
}

function normalizeArray(raw, len, def = null) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function Reversi() {
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
    return {
      id: "local",
      board: initBoard(),
      turn: "X",
      player_x: playerId,
      player_x_name: playerName,
      player_o: "computer",
      player_o_name: t.computer,
      winner: null,
      skipped: null,
    };
  }

  // Computer mode init
  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame(makeInitGame());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  // Overlay timer
  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  // AI move trigger
  useEffect(() => {
    if (!isComputer || !game || game.winner || game.turn !== "O" || aiThinking) return;
    const board = game.board;
    setAiThinking(true);
    const timer = setTimeout(() => {
      const move = computerMoveReversi(board);
      if (move === null) {
        const winner = checkGameEnd(board);
        setGame(prev => ({ ...prev, turn: "X", winner: winner || null, skipped: "O" }));
        setAiThinking(false);
        return;
      }
      const newBoard = flipPieces(board, move, "O");
      if (!newBoard) { setAiThinking(false); return; }
      const winner = checkGameEnd(newBoard);
      const xMoves = getValidMoves(newBoard, "X");
      setGame(prev => ({
        ...prev, board: newBoard,
        turn: winner ? null : xMoves.length > 0 ? "X" : "O",
        winner: winner || null, skipped: xMoves.length === 0 && !winner ? "X" : null,
      }));
      setAiThinking(false);
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer, game?.turn, game?.winner, aiThinking]);

  // Online mode init
  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `reversi/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({ ...data, board: normalizeArray(data.board, 64), id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `reversi/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `reversi/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame({ ...data, board: normalizeArray(data.board, 64), id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const gRef = ref(db, "reversi");
    const newRef = push(gRef);
    await set(newRef, {
      board: initBoard(), turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null,
      winner: null, skipped: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(makeInitGame()); setShowOverlay(false); return; }
    const id = await createOnlineGame();
    navigate(`/reversi?gameId=${id}&mode=online`);
  };

  const handleCellClick = async (index) => {
    if (!game || game.winner || aiThinking) return;
    if (isComputer) {
      if (game.turn !== "X") return;
      const newBoard = flipPieces(game.board, index, "X");
      if (!newBoard) return;
      const winner = checkGameEnd(newBoard);
      const oMoves = getValidMoves(newBoard, "O");
      setGame(prev => ({
        ...prev, board: newBoard,
        turn: winner ? null : oMoves.length > 0 ? "O" : "X",
        winner: winner || null, skipped: oMoves.length === 0 && !winner ? "O" : null,
      }));
    } else {
      if (game.turn !== playerSymbol || playerSymbol === "Spectator") return;
      const gameRef = ref(db, `reversi/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.turn !== playerSymbol || fd.winner) return;
      const fb = normalizeArray(fd.board, 64);
      const newBoard = flipPieces(fb, index, playerSymbol);
      if (!newBoard) return;
      const winner = checkGameEnd(newBoard);
      const nextSym = playerSymbol === "X" ? "O" : "X";
      const nextMoves = getValidMoves(newBoard, nextSym);
      const selfMoves = getValidMoves(newBoard, playerSymbol);
      const nextTurn = winner ? null : nextMoves.length > 0 ? nextSym : selfMoves.length > 0 ? playerSymbol : null;
      const skipped = !winner && nextMoves.length === 0 && selfMoves.length > 0 ? nextSym : null;
      await update(gameRef, {
        board: newBoard, turn: nextTurn,
        winner: winner || null, skipped,
      });
    }
  };

  const resetComputer = () => { setGame(makeInitGame()); setShowOverlay(false); };
  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `reversi/${game.id}`), {
      board: initBoard(), turn: "X", winner: null, skipped: null,
    });
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/reversi?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">♟️ {t.reversi}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="reversi" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSym ? "win" : "loss";

  const myTurn = isComputer ? game.turn === "X" : game.turn === effectiveSym;
  const statusClass = game.winner === "Draw" ? "status-draw" : game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const statusText = game.winner === "Draw"
    ? `🤝 ${t.draw}`
    : game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : aiThinking ? "🤔 ..."
    : game.skipped ? t.noValidMoves
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  const validMoves = game.winner ? [] : getValidMoves(game.board, game.turn);
  const xCount = countPieces(game.board, "X");
  const oCount = countPieces(game.board, "O");

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">♟️ {t.reversi}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">⚫ {nameX} ({xCount})</span>
        <span>{t.vs}</span>
        <span className="player-o">⚪ {nameO} ({oCount})</span>
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

      <div className="reversi-board">
        {game.board.map((cell, index) => {
          const isValid = !game.winner && myTurn && validMoves.includes(index);
          return (
            <div
              key={index}
              className={`reversi-cell${isValid ? " valid-move" : ""}`}
              onClick={() => handleCellClick(index)}
            >
              {cell === "X" && <div className="reversi-piece reversi-piece-x" />}
              {cell === "O" && <div className="reversi-piece reversi-piece-o" />}
              {!cell && isValid && <div className="reversi-piece-hint" />}
            </div>
          );
        })}
      </div>

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

      {showRules && <RulesModal gameKey="reversi" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default Reversi;
