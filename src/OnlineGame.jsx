import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";
import GameSuggestion from "./GameSuggestion";

const emptyBoard = Array(9).fill(null);

// ── Minimax AI (perfect TicTacToe) ────────────────────────────────────────

function checkWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c])
      return { symbol: board[a], cells: [a,b,c] };
  }
  return null;
}

function minimax(board, isMax, aiSym) {
  const humanSym = aiSym === "O" ? "X" : "O";
  const result = checkWinner(board);
  if (result) return result.symbol === aiSym ? 10 : -10;
  if (board.every(c => c)) return 0;

  if (isMax) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = aiSym;
        best = Math.max(best, minimax(board, false, aiSym));
        board[i] = null;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = humanSym;
        best = Math.min(best, minimax(board, true, aiSym));
        board[i] = null;
      }
    }
    return best;
  }
}

function getBestMove(board, aiSym) {
  let best = -Infinity, move = -1;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = aiSym;
      const score = minimax(board, false, aiSym);
      board[i] = null;
      if (score > best) { best = score; move = i; }
    }
  }
  return move;
}

// ── Component ──────────────────────────────────────────────────────────────

function OnlineGame() {
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
  const disconnectRef = useRef(null);

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
      id: "local", board: emptyBoard, turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: "computer", player_o_name: t.computer,
      winner: null, winningCells: [],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  const doAiMove = useCallback((board) => {
    setAiThinking(true);
    setTimeout(() => {
      const boardCopy = [...board];
      const move = getBestMove(boardCopy, "O");
      if (move === -1) { setAiThinking(false); return; }
      const newBoard = [...board];
      newBoard[move] = "O";
      const result = checkWinner(newBoard);
      const winner = result ? result.symbol : null;
      const winningCells = result ? result.cells : [];
      const isDraw = !winner && newBoard.every(c => c);
      setGame(prev => ({
        ...prev, board: newBoard,
        turn: winner || isDraw ? null : "X",
        winner: winner ? "O" : isDraw ? "Draw" : null,
        winningCells,
      }));
      setAiThinking(false);
    }, 350);
  }, []);

  const handleComputerMove = (index) => {
    if (!game || game.board[index] || game.winner || game.turn !== "X" || aiThinking) return;
    const newBoard = [...game.board];
    newBoard[index] = "X";
    const result = checkWinner(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every(c => c);
    const newState = {
      ...game, board: newBoard,
      turn: winner || isDraw ? null : "O",
      winner: winner ? "X" : isDraw ? "Draw" : null,
      winningCells,
    };
    setGame(newState);
    if (!winner && !isDraw) doAiMove(newBoard);
  };

  const resetComputer = () => {
    setGame({
      id: "local", board: emptyBoard, turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: "computer", player_o_name: t.computer,
      winner: null, winningCells: [],
    });
  };

  // ── Online mode ────────────────────────────────────────────────────────

  const handleNameSubmit = () => {
    const trimmed = nameInput.trim();
    if (trimmed) { localStorage.setItem("playerName", trimmed); setPlayerName(trimmed); }
  };

  const createGame = async (name) => {
    const gRef = ref(db, "tictactoe");
    const newRef = push(gRef);
    await set(newRef, {
      board: emptyBoard, turn: "X",
      player_x: playerId, player_x_name: name,
      player_o: null, player_o_name: null,
      winner: null, winningCells: [],
    });
    onDisconnect(newRef).remove();
    disconnectRef.current = newRef;
    return newRef.key;
  };

  const handleStartNewGame = async () => {
    if (isComputer) { resetComputer(); return; }
    const id = await createGame(playerName);
    navigate(`/tictactoe?gameId=${id}&mode=online`);
  };

  const handleNameAndStart = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("playerName", trimmed);
    setPlayerName(trimmed);
    const id = await createGame(trimmed);
    navigate(`/tictactoe?gameId=${id}&mode=online`);
  };

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `tictactoe/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      const board = Array.from({ length: 9 }, (_, i) => data.board ? (data.board[i] ?? null) : null);
      setGame({ ...data, board, id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        const join = { player_o: playerId };
        const sn = localStorage.getItem("playerName");
        if (sn) join.player_o_name = sn;
        await update(gameRef, join);
        setPlayerSymbol("O");
        onDisconnect(ref(db, `tictactoe/${gameIdFromUrl}/player_o`)).set(null);
      } else if (data.player_o === playerId) {
        setPlayerSymbol("O");
      } else {
        setPlayerSymbol("Spectator");
      }
    };
    init();
  }, [gameIdFromUrl, playerId, navigate, isComputer]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `tictactoe/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const board = Array.from({ length: 9 }, (_, i) => data.board ? (data.board[i] ?? null) : null);
        setGame({ ...data, board, id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  useEffect(() => {
    const update_ = async () => {
      if (!game || playerSymbol === "Spectator" || !playerName || isComputer) return;
      const gameRef = ref(db, `tictactoe/${game.id}`);
      const updates = {};
      if (playerSymbol === "X" && !game.player_x_name) updates.player_x_name = playerName;
      else if (playerSymbol === "O" && !game.player_o_name) updates.player_o_name = playerName;
      if (Object.keys(updates).length > 0) await update(gameRef, updates);
    };
    update_();
  }, [playerName, game, playerSymbol, isComputer]);

  const handleOnlineMove = async (index) => {
    const gameRef = ref(db, `tictactoe/${game.id}`);
    const snap = await get(gameRef);
    const fd = snap.val();
    const fb = Array.from({ length: 9 }, (_, i) => fd.board ? (fd.board[i] ?? null) : null);
    if (fb[index] || fd.winner || fd.turn !== playerSymbol) return;
    const newBoard = [...fb];
    newBoard[index] = playerSymbol;
    const result = checkWinner(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every(c => c);
    await update(gameRef, {
      board: newBoard,
      turn: winner || isDraw ? null : playerSymbol === "X" ? "O" : "X",
      winner: winner ? playerSymbol : isDraw ? "Draw" : null,
      winningCells,
    });
  };

  const handleMove = (index) => {
    if (isComputer) handleComputerMove(index);
    else handleOnlineMove(index);
  };

  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `tictactoe/${game.id}`), {
      board: emptyBoard, turn: "X", winner: null, winningCells: [],
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/tictactoe?gameId=${game?.id}&mode=online`;
  const effectiveSymbol = isComputer ? "X" : playerSymbol;
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "500px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">✖️ {t.tictactoe}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1rem" }}>{t.enterName}</p>
        <input type="text" value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNameAndStart()}
          className="name-input" placeholder={t.namePlaceholder}
        />
        <br />
        <button className="btn-primary" onClick={handleNameAndStart} style={{ marginTop: "1rem" }}>
          {t.startGame}
        </button>
        {showRules && <RulesModal gameKey="tictactoe" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  if (!playerName && effectiveSymbol !== "Spectator" && !isComputer) {
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

  const myTurn = isComputer ? game.turn === "X" : game.turn === effectiveSymbol;
  const statusClass = game.winner === "Draw" ? "status-draw" : game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const statusText = game.winner === "Draw"
    ? `🤝 ${t.draw}`
    : game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : aiThinking ? "🤔 ..."
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 1rem 1rem" }}>
      {topBar}
      <h1 className="game-title">✖️ {t.tictactoe}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">✖️ {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">⭕ {nameO}</span>
        {!isComputer && <span>— {t.playAs}: <strong>{effectiveSymbol}</strong></span>}
      </div>

      {!isComputer && effectiveSymbol === "X" && !game.player_o && (
        <div className="invite-box">
          <p>{t.inviteFriend}</p>
          <div className="invite-row">
            <input readOnly value={inviteLink} className="invite-input" onClick={(e) => e.target.select()} />
            <button className="btn-primary" onClick={() => copyLink(inviteLink)}>{copied ? "✅" : t.copyLink}</button>
          </div>
        </div>
      )}

      <div className="grid-container">
        {game.board.map((cell, index) => (
          <div
            key={index}
            className={`grid-element ${
              Array.isArray(game.winningCells) && game.winningCells.includes(index)
                ? "winner-cell"
                : game.winner ? "faded" : ""
            }`}
            onClick={() => handleMove(index)}
          >
            {cell}
          </div>
        ))}
      </div>

      {showOverlay && overlayResult && (
        <GameResultOverlay
          result={overlayResult}
          winnerName={game.winner === "X" ? nameX : nameO}
          onClose={() => setShowOverlay(false)}
        >
          <button className="btn-primary" onClick={() => { setShowOverlay(false); isComputer ? resetComputer() : resetOnline(); }}>{t.rematch}</button>
          {!isComputer && <button className="btn-primary" onClick={() => { setShowOverlay(false); handleStartNewGame(); }}>{t.newGame}</button>}
          <button className="btn-secondary" onClick={() => setShowOverlay(false)}>✕</button>
        </GameResultOverlay>
      )}

      {showRules && <RulesModal gameKey="tictactoe" onClose={() => setShowRules(false)} />}

      {!isComputer && gameIdFromUrl && game.player_o && (
        <GameSuggestion gameType="tictactoe" gameId={gameIdFromUrl} playerId={playerId} currentGame="/tictactoe" />
      )}

      {!game.winner && (
        <button className="btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "1.5rem" }}>
          {t.gameSelection}
        </button>
      )}
    </div>
  );
}

export default OnlineGame;
