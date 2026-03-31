import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const SIZE = 15;
const TOTAL = SIZE * SIZE;

function checkWinner5(board) {
  const directions = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const sym = board[r * SIZE + c];
      if (!sym) continue;
      for (const [dr, dc] of directions) {
        const cells = [];
        let valid = true;
        for (let i = 0; i < 5; i++) {
          const nr = r + dr * i, nc = c + dc * i;
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr * SIZE + nc] !== sym) { valid = false; break; }
          cells.push(nr * SIZE + nc);
        }
        if (!valid) continue;
        // Check exactly 5 (no overline)
        const before_r = r - dr, before_c = c - dc;
        const after_r = r + dr * 5, after_c = c + dc * 5;
        const beforeOk = before_r < 0 || before_r >= SIZE || before_c < 0 || before_c >= SIZE || board[before_r * SIZE + before_c] !== sym;
        const afterOk = after_r < 0 || after_r >= SIZE || after_c < 0 || after_c >= SIZE || board[after_r * SIZE + after_c] !== sym;
        if (beforeOk && afterOk) return { symbol: sym, cells };
      }
    }
  }
  return null;
}

function scoreLine(board, row, col, dr, dc, sym) {
  const opp = sym === "X" ? "O" : "X";
  let score = 0;
  const dirs = [[dr, dc], [-dr, -dc]];
  for (const [ddr, ddc] of dirs) {
    let count = 0, open = 0;
    for (let i = 1; i <= 4; i++) {
      const nr = row + ddr * i, nc = col + ddc * i;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
      const cell = board[nr * SIZE + nc];
      if (cell === sym) count++;
      else if (cell === null) { open++; break; }
      else break;
    }
    if (count === 4 && open > 0) score += 10000;
    else if (count === 3 && open > 0) score += 1000;
    else if (count === 2 && open > 0) score += 100;
    else if (count === 1 && open > 0) score += 10;
    // Block opponent
    let ocount = 0, oopen = 0;
    for (let i = 1; i <= 4; i++) {
      const nr = row + ddr * i, nc = col + ddc * i;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
      const cell = board[nr * SIZE + nc];
      if (cell === opp) ocount++;
      else if (cell === null) { oopen++; break; }
      else break;
    }
    if (ocount === 4 && oopen > 0) score += 8000;
    else if (ocount === 3 && oopen > 0) score += 800;
    else if (ocount === 2 && oopen > 0) score += 80;
  }
  return score;
}

function computerMoveGomoku(board) {
  const directions = [[0,1],[1,0],[1,1],[1,-1]];
  let bestScore = -1, bestMove = -1;
  for (let i = 0; i < TOTAL; i++) {
    if (board[i]) continue;
    // Only consider cells near existing pieces
    const r = Math.floor(i / SIZE), c = i % SIZE;
    let hasNeighbor = false;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr * SIZE + nc]) { hasNeighbor = true; break; }
      }
      if (hasNeighbor) break;
    }
    if (!hasNeighbor && board.some(c => c !== null)) continue;
    let score = 0;
    for (const [dr, dc] of directions) {
      score += scoreLine(board, r, c, dr, dc, "O");
    }
    if (score > bestScore) { bestScore = score; bestMove = i; }
  }
  if (bestMove === -1) {
    // fallback: center
    bestMove = Math.floor(TOTAL / 2);
  }
  return bestMove;
}

function normalizeArray(raw, len, def = null) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function Gomoku() {
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

  const emptyBoard = Array(TOTAL).fill(null);

  function makeInitGame() {
    return {
      id: "local",
      board: emptyBoard,
      turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: "computer", player_o_name: t.computer,
      winner: null, winningCells: [],
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
    const board = game.board;
    const timer = setTimeout(() => {
      const move = computerMoveGomoku(board);
      const newBoard = [...board];
      newBoard[move] = "O";
      const result = checkWinner5(newBoard);
      const winner = result ? result.symbol : null;
      const isDraw = !winner && newBoard.every(c => c !== null);
      setGame(prev => ({
        ...prev, board: newBoard,
        turn: winner || isDraw ? null : "X",
        winner: winner ? "O" : isDraw ? "Draw" : null,
        winningCells: result ? result.cells : [],
      }));
      setAiThinking(false);
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer, game?.turn, game?.winner, aiThinking]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `gomoku/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      const initWc = data.winningCells
        ? (Array.isArray(data.winningCells) ? data.winningCells : Object.values(data.winningCells))
        : [];
      setGame({ ...data, board: normalizeArray(data.board, TOTAL), winningCells: initWc, id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `gomoku/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `gomoku/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const wc = data.winningCells
          ? (Array.isArray(data.winningCells) ? data.winningCells : Object.values(data.winningCells))
          : [];
        setGame({ ...data, board: normalizeArray(data.board, TOTAL), winningCells: wc, id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const gRef = ref(db, "gomoku");
    const newRef = push(gRef);
    await set(newRef, {
      board: emptyBoard, turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null,
      winner: null, winningCells: [],
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(makeInitGame()); setShowOverlay(false); return; }
    const id = await createOnlineGame();
    navigate(`/gomoku?gameId=${id}&mode=online`);
  };

  const handleCellClick = async (index) => {
    if (!game || game.winner || aiThinking) return;
    if (isComputer) {
      if (game.turn !== "X" || game.board[index]) return;
      const newBoard = [...game.board];
      newBoard[index] = "X";
      const result = checkWinner5(newBoard);
      const winner = result ? result.symbol : null;
      const isDraw = !winner && newBoard.every(c => c !== null);
      setGame(prev => ({
        ...prev, board: newBoard,
        turn: winner || isDraw ? null : "O",
        winner: winner ? "X" : isDraw ? "Draw" : null,
        winningCells: result ? result.cells : [],
      }));
    } else {
      if (game.turn !== playerSymbol || playerSymbol === "Spectator" || game.board[index]) return;
      const gameRef = ref(db, `gomoku/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.turn !== playerSymbol || fd.winner || fd.board[index]) return;
      const fb = normalizeArray(fd.board, TOTAL);
      const newBoard = [...fb];
      newBoard[index] = playerSymbol;
      const result = checkWinner5(newBoard);
      const winner = result ? result.symbol : null;
      const isDraw = !winner && newBoard.every(c => c !== null);
      await update(gameRef, {
        board: newBoard,
        turn: winner || isDraw ? null : playerSymbol === "X" ? "O" : "X",
        winner: winner ? playerSymbol : isDraw ? "Draw" : null,
        winningCells: result ? result.cells : [],
      });
    }
  };

  const resetComputer = () => { setGame(makeInitGame()); setShowOverlay(false); };
  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `gomoku/${game.id}`), { board: emptyBoard, turn: "X", winner: null, winningCells: [] });
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/gomoku?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">🎯 {t.gomoku}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="gomoku" onClose={() => setShowRules(false)} />}
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
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  const winCells = Array.isArray(game.winningCells) ? game.winningCells : [];

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">🎯 {t.gomoku}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">⚫ {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">⚪ {nameO}</span>
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

      <div style={{ overflowX: "auto", overflowY: "auto", maxWidth: "100vw" }}>
        <div className="gomoku-board">
          {game.board.map((cell, index) => {
            const isWin = winCells.includes(index);
            return (
              <div key={index} className="gomoku-cell" onClick={() => handleCellClick(index)}>
                {cell
                  ? <div className={`gomoku-piece gomoku-piece-${cell.toLowerCase()}${isWin ? " win-piece" : ""}`} />
                  : myTurn && !game.winner && <div className={`gomoku-piece-hint gomoku-piece-${(game.turn || "x").toLowerCase()}`} />
                }
              </div>
            );
          })}
        </div>
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

      {showRules && <RulesModal gameKey="gomoku" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default Gomoku;
