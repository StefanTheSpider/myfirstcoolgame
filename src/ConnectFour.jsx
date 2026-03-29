import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

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
  return null; // Spalte voll
}

function checkWinner4(board) {
  const directions = [
    [0, 1], [1, 0], [1, 1], [1, -1],
  ];
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
            valid = false;
            break;
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
  return Array.from({ length: ROWS * COLS }, (_, i) =>
    raw ? (raw[i] ?? null) : null
  );
}

function ConnectFour() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gameIdFromUrl = params.get("gameId");

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");

  const [playerId] = useState(() => {
    let stored = localStorage.getItem("playerId");
    if (!stored) { stored = uuidv4(); localStorage.setItem("playerId", stored); }
    return stored;
  });

  const createGame = async () => {
    const gamesRef = ref(db, "connect4");
    const newGameRef = push(gamesRef);
    await set(newGameRef, {
      board: emptyBoard,
      turn: "X",
      player_x: playerId,
      player_x_name: playerName,
      player_o: null,
      player_o_name: null,
      winner: null,
      winningCells: [],
    });
    onDisconnect(newGameRef).remove();
    return newGameRef.key;
  };

  const handleStart = async () => {
    const gameId = await createGame();
    navigate(`/connect4?gameId=${gameId}`);
  };

  useEffect(() => {
    if (!gameIdFromUrl) return;
    const gameRef = ref(db, `connect4/${gameIdFromUrl}`);

    const init = async () => {
      const snapshot = await get(gameRef);
      if (!snapshot.exists()) { navigate("/"); return; }
      const data = snapshot.val();
      setGame({ ...data, board: normalizeBoard(data.board), id: gameIdFromUrl });

      if (data.player_x === playerId) {
        setPlayerSymbol("X");
        onDisconnect(gameRef).remove();
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
  }, [gameIdFromUrl, playerId, navigate, playerName]);

  useEffect(() => {
    if (!gameIdFromUrl) return;
    const gameRef = ref(db, `connect4/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setGame({ ...data, board: normalizeBoard(data.board), id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl]);

  const handleColumnClick = async (col) => {
    if (!game || game.winner || game.turn !== playerSymbol || playerSymbol === "Spectator") return;

    const gameRef = ref(db, `connect4/${game.id}`);
    const snapshot = await get(gameRef);
    const freshData = snapshot.val();
    const freshBoard = normalizeBoard(freshData.board);

    if (freshData.turn !== playerSymbol || freshData.winner) return;

    const newBoard = dropPiece(freshBoard, col, playerSymbol);
    if (!newBoard) return; // Spalte voll

    const result = checkWinner4(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every((c) => c !== null);
    const nextTurn = playerSymbol === "X" ? "O" : "X";

    await update(gameRef, {
      board: newBoard,
      turn: winner || isDraw ? null : nextTurn,
      winner: winner ? playerSymbol : isDraw ? "Draw" : null,
      winningCells,
    });
  };

  const resetGame = async () => {
    if (!game) return;
    const gameRef = ref(db, `connect4/${game.id}`);
    await update(gameRef, {
      board: emptyBoard,
      turn: "X",
      winner: null,
      winningCells: [],
    });
  };

  const inviteLink = `${window.location.origin}/connect4?gameId=${game?.id}`;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || "Player O";

  if (!gameIdFromUrl) {
    return (
      <div style={{ textAlign: "center", marginTop: "5rem" }}>
        <h1>🔴 Vier Gewinnt</h1>
        <p>Hallo {playerName}!</p>
        <button onClick={handleStart} style={{ padding: "0.5rem 1.5rem", fontSize: "1rem" }}>
          Spiel starten
        </button>
        <br /><br />
        <button onClick={() => navigate("/")}>← Zurück</button>
      </div>
    );
  }

  if (!game) return <div>Loading...</div>;

  return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <h1>
        {game.winner === "Draw"
          ? "🤝 Unentschieden!"
          : game.winner
          ? `🏆 ${game.winner === "X" ? nameX : nameO} gewinnt!`
          : "🔴 Vier Gewinnt"}
      </h1>

      <h2>
        {playerSymbol === "Spectator"
          ? "Spectating..."
          : game.winner
          ? ""
          : game.turn === playerSymbol
          ? "Du bist dran"
          : `${game.turn === "X" ? nameX : nameO} ist dran`}
      </h2>

      <p>
        <span style={{ color: "#e74c3c" }}>🔴 {nameX}</span>
        &nbsp;vs&nbsp;
        <span style={{ color: "#f39c12" }}>🟡 {nameO}</span>
        &nbsp;— Du: <strong>{playerSymbol}</strong>
      </p>

      {playerSymbol === "X" && !game.player_o && (
        <div style={{ marginBottom: "1rem" }}>
          <p>👉 Freund einladen:</p>
          <input
            readOnly
            value={inviteLink}
            style={{ width: "80%", maxWidth: "400px", padding: "0.5rem" }}
            onClick={(e) => e.target.select()}
          />
          <button onClick={() => navigator.clipboard.writeText(inviteLink)} style={{ marginLeft: "0.5rem" }}>
            Kopieren
          </button>
        </div>
      )}

      {/* Spalten-Pfeil-Buttons */}
      <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${COLS}, 3rem)`, gap: "3px", marginTop: "0.5rem" }}>
        {Array.from({ length: COLS }, (_, col) => (
          <button
            key={col}
            onClick={() => handleColumnClick(col)}
            disabled={!!game.winner || game.turn !== playerSymbol || playerSymbol === "Spectator"}
            style={{ height: "2rem", fontSize: "1rem", padding: 0, cursor: "pointer" }}
          >
            ▼
          </button>
        ))}
      </div>

      {/* Spielfeld */}
      <div
        style={{
          display: "inline-grid",
          gridTemplateColumns: `repeat(${COLS}, 3rem)`,
          gridTemplateRows: `repeat(${ROWS}, 3rem)`,
          gap: "3px",
          background: "#2980b9",
          padding: "6px",
          borderRadius: "8px",
          marginTop: "3px",
        }}
      >
        {game.board.map((cell, index) => (
          <div
            key={index}
            style={{
              width: "3rem",
              height: "3rem",
              borderRadius: "50%",
              background: Array.isArray(game.winningCells) && game.winningCells.includes(index)
                ? "#2ecc71"
                : cell === "X"
                ? "#e74c3c"
                : cell === "O"
                ? "#f39c12"
                : "#ecf0f1",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {(game.winner || game.winner === "Draw") && (
        <div style={{ marginTop: "1.5rem" }}>
          <button onClick={resetGame} style={{ margin: "0.5rem" }}>Rematch</button>
          <button onClick={handleStart}>Neues Spiel</button>
          <br />
          <button onClick={() => navigate("/")} style={{ marginTop: "0.5rem" }}>← Spielauswahl</button>
        </div>
      )}

      {!game.winner && (
        <div style={{ marginTop: "1rem" }}>
          <button onClick={() => navigate("/")}>← Spielauswahl</button>
        </div>
      )}
    </div>
  );
}

export default ConnectFour;
