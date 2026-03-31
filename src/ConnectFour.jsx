import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";
import GameSuggestion from "./GameSuggestion";

const ROWS = 6;
const COLS = 7;
const emptyBoard = Array(ROWS * COLS).fill(null);

function dropPiece(board, col, symbol) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (!board[row * COLS + col]) {
      const newBoard = [...board];
      newBoard[row * COLS + col] = symbol;
      return newBoard;
    }
  }
  return null;
}

function checkWinner4(board) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r * COLS + c];
      if (!cell) continue;
      for (const [dr, dc] of directions) {
        const cells = [r * COLS + c];
        let valid = true;
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr * COLS + nc] !== cell) {
            valid = false; break;
          }
          cells.push(nr * COLS + nc);
        }
        if (valid) return { symbol: cell, cells };
      }
    }
  }
  return null;
}

function normalizeBoard(raw) {
  return Array.from({ length: ROWS * COLS }, (_, i) => raw ? (raw[i] ?? null) : null);
}

// ── AI (Minimax + Alpha-Beta) ──────────────────────────────────────────────

function scoreWindow(win, sym) {
  const opp = sym === "O" ? "X" : "O";
  const s = win.filter(c => c === sym).length;
  const e = win.filter(c => c === null).length;
  const o = win.filter(c => c === opp).length;
  if (s === 4) return 100;
  if (s === 3 && e === 1) return 5;
  if (s === 2 && e === 2) return 2;
  if (o === 3 && e === 1) return -4;
  return 0;
}

function scoreBoard(board, sym) {
  let score = 0;
  const center = Array.from({ length: ROWS }, (_, r) => board[r * COLS + 3]);
  score += center.filter(c => c === sym).length * 3;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r*COLS+c], board[r*COLS+c+1], board[r*COLS+c+2], board[r*COLS+c+3]], sym);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      score += scoreWindow([board[r*COLS+c], board[(r+1)*COLS+c], board[(r+2)*COLS+c], board[(r+3)*COLS+c]], sym);
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r*COLS+c], board[(r-1)*COLS+c+1], board[(r-2)*COLS+c+2], board[(r-3)*COLS+c+3]], sym);
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r*COLS+c], board[(r+1)*COLS+c+1], board[(r+2)*COLS+c+2], board[(r+3)*COLS+c+3]], sym);
  return score;
}

function getValidCols(board) {
  return Array.from({ length: COLS }, (_, c) => c).filter(c => board[c] === null);
}

function minimax(board, depth, alpha, beta, maximizing, aiSym) {
  const humanSym = aiSym === "O" ? "X" : "O";
  const result = checkWinner4(board);
  if (result) return { score: result.symbol === aiSym ? 100000 + depth : -100000 - depth };
  const valid = getValidCols(board);
  if (valid.length === 0 || depth === 0) return { score: scoreBoard(board, aiSym) };

  if (maximizing) {
    let best = -Infinity, bestCol = valid[0];
    for (const col of valid) {
      const nb = dropPiece(board, col, aiSym);
      if (!nb) continue;
      const { score } = minimax(nb, depth - 1, alpha, beta, false, aiSym);
      if (score > best) { best = score; bestCol = col; }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return { score: best, col: bestCol };
  } else {
    let best = Infinity, bestCol = valid[0];
    for (const col of valid) {
      const nb = dropPiece(board, col, humanSym);
      if (!nb) continue;
      const { score } = minimax(nb, depth - 1, alpha, beta, true, aiSym);
      if (score < best) { best = score; bestCol = col; }
      beta = Math.min(beta, score);
      if (alpha >= beta) break;
    }
    return { score: best, col: bestCol };
  }
}

function getBestMove(board, aiSym) {
  const { col } = minimax(board, 6, -Infinity, Infinity, true, aiSym);
  return col;
}

// ── Component ─────────────────────────────────────────────────────────────

function ConnectFour() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("playerName") || "");
  const [nameInput, setNameInput] = useState("");
  const [aiThinking, setAiThinking] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  // ── Computer mode ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame({
      id: "local",
      board: emptyBoard,
      turn: "X",
      player_x: playerId,
      player_x_name: playerName,
      player_o: "computer",
      player_o_name: t.computer,
      winner: null,
      winningCells: [],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  const doAiMove = useCallback((currentBoard) => {
    setAiThinking(true);
    setTimeout(() => {
      const col = getBestMove(currentBoard, "O");
      const newBoard = dropPiece(currentBoard, col, "O");
      if (!newBoard) { setAiThinking(false); return; }
      const result = checkWinner4(newBoard);
      const winner = result ? result.symbol : null;
      const winningCells = result ? result.cells : [];
      const isDraw = !winner && newBoard.every(c => c !== null);
      setGame(prev => ({
        ...prev,
        board: newBoard,
        turn: winner || isDraw ? null : "X",
        winner: winner ? "O" : isDraw ? "Draw" : null,
        winningCells,
      }));
      setAiThinking(false);
    }, 400);
  }, []);

  const handleComputerMove = (index) => {
    if (!game || game.winner || game.turn !== "X" || aiThinking) return;
    const col = index % COLS;
    const newBoard = dropPiece(game.board, col, "X");
    if (!newBoard) return;
    const result = checkWinner4(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every(c => c !== null);
    const nextTurn = winner || isDraw ? null : "O";
    const newState = {
      ...game,
      board: newBoard,
      turn: nextTurn,
      winner: winner ? "X" : isDraw ? "Draw" : null,
      winningCells,
    };
    setGame(newState);
    if (!winner && !isDraw) doAiMove(newBoard);
  };

  const resetComputer = () => {
    setGame({
      id: "local",
      board: emptyBoard,
      turn: "X",
      player_x: playerId,
      player_x_name: playerName,
      player_o: "computer",
      player_o_name: t.computer,
      winner: null,
      winningCells: [],
    });
  };

  // ── Online mode ────────────────────────────────────────────────────────

  const createOnlineGame = async () => {
    const gRef = ref(db, "connect4");
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
    if (isComputer) { resetComputer(); return; }
    const id = await createOnlineGame();
    navigate(`/connect4?gameId=${id}&mode=online`);
  };

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `connect4/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({ ...data, board: normalizeBoard(data.board), id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `connect4/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `connect4/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame({ ...data, board: normalizeBoard(data.board), id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const handleOnlineColumn = async (col) => {
    if (!game || game.winner || game.turn !== playerSymbol || playerSymbol === "Spectator") return;
    const gameRef = ref(db, `connect4/${game.id}`);
    const snap = await get(gameRef);
    const fd = snap.val();
    const fb = normalizeBoard(fd.board);
    if (fd.turn !== playerSymbol || fd.winner) return;
    const newBoard = dropPiece(fb, col, playerSymbol);
    if (!newBoard) return;
    const result = checkWinner4(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every(c => c !== null);
    await update(gameRef, {
      board: newBoard,
      turn: winner || isDraw ? null : playerSymbol === "X" ? "O" : "X",
      winner: winner ? playerSymbol : isDraw ? "Draw" : null,
      winningCells,
    });
  };

  const handleColumnClick = (col) => {
    if (isComputer) {
      // simulate click on bottom of column
      handleComputerMove(col);
    } else {
      handleOnlineColumn(col);
    }
  };

  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `connect4/${game.id}`), {
      board: emptyBoard, turn: "X", winner: null, winningCells: [],
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSymbol = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/connect4?gameId=${game?.id}&mode=online`;
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">🔴 {t.connectFour}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="connect4" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  if (!playerName && effectiveSymbol !== "Spectator" && !isComputer) {
    const handleNameSubmit = () => {
      const trimmed = nameInput.trim();
      if (trimmed) { localStorage.setItem("playerName", trimmed); setPlayerName(trimmed); }
    };
    return (
      <div className="fade-in" style={{ textAlign: "center", marginTop: "4rem", padding: "0 1rem" }}>
        <h2 style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1rem" }}>{t.enterNameFirst}</h2>
        <input type="text" value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
          className="name-input" />
        <br />
        <button className="btn-primary" onClick={handleNameSubmit} style={{ marginTop: "1rem" }}>
          {t.confirmName}
        </button>
      </div>
    );
  }

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSymbol ? "win" : "loss";

  const currentTurn = game.turn;
  const myTurn = isComputer ? currentTurn === "X" : currentTurn === effectiveSymbol;
  const statusClass = game.winner === "Draw" ? "status-draw" : game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const statusText = game.winner === "Draw"
    ? `🤝 ${t.draw}`
    : game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : aiThinking ? "🤔 ..."
    : myTurn ? t.yourTurn
    : `⏳ ${currentTurn === "X" ? nameX : nameO}...`;

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">🔴 {t.connectFour}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">🔴 {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">🟡 {nameO}</span>
        {!isComputer && <span>— {t.playAs}: <strong>{effectiveSymbol}</strong></span>}
      </div>

      {!isComputer && effectiveSymbol === "X" && !game.player_o && (
        <div className="invite-box">
          <p>{t.inviteFriend}</p>
          <div className="invite-row">
            <input readOnly value={inviteLink} className="invite-input" onClick={(e) => e.target.select()} />
            <button className="btn-primary" onClick={() => copyLink(inviteLink)}>{copied ? "✅" : t.copyLink}</button>
          </div>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.82rem" }}>{t.waitingOpponent}</p>
        </div>
      )}

      <div className="c4-board-wrapper" style={{ marginTop: "0.75rem" }}>
        <div className="c4-arrows">
          {Array.from({ length: COLS }, (_, col) => (
            <button
              key={col}
              className="c4-arrow-btn"
              onClick={() => handleColumnClick(col)}
              disabled={!!game.winner || !myTurn || aiThinking || (!isComputer && effectiveSymbol === "Spectator")}
            >
              ▼
            </button>
          ))}
        </div>
        <div className="c4-board">
          {game.board.map((cell, index) => {
            const isWin = Array.isArray(game.winningCells) && game.winningCells.includes(index);
            return (
              <div key={index} className="c4-cell">
                <div className={`c4-disc ${cell === "X" ? "disc-x" : cell === "O" ? "disc-o" : "disc-empty"} ${isWin ? "disc-win" : ""}`} />
              </div>
            );
          })}
        </div>
      </div>

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

      {!isComputer && gameIdFromUrl && game.player_o && (
        <GameSuggestion gameType="connect4" gameId={gameIdFromUrl} playerId={playerId} currentGame="/connect4" />
      )}

      {showRules && <RulesModal gameKey="connect4" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default ConnectFour;
