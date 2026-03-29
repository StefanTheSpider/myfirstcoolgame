import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import {
  ref,
  set,
  update,
  get,
  onValue,
  push,
  onDisconnect,
} from "firebase/database";
import { v4 as uuidv4 } from "uuid";

const emptyBoard = Array(9).fill(null);

function OnlineGame() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gameIdFromUrl = params.get("gameId");

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem("playerName") || ""
  );
  const [nameInput, setNameInput] = useState("");
  const disconnectRef = useRef(null);

  const [playerId] = useState(() => {
    let stored = localStorage.getItem("playerId");
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem("playerId", stored);
    }
    return stored;
  });

  const handleNameSubmit = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      localStorage.setItem("playerName", trimmed);
      setPlayerName(trimmed);
    }
  };

  const createGame = async (name) => {
    const gamesRef = ref(db, "games");
    const newGameRef = push(gamesRef);

    await set(newGameRef, {
      board: emptyBoard,
      turn: "X",
      player_x: playerId,
      player_x_name: name,
      player_o: null,
      player_o_name: null,
      winner: null,
      winningCells: [],
    });

    // Spiel automatisch löschen wenn der Ersteller die Session verlässt
    const dc = onDisconnect(newGameRef);
    dc.remove();
    disconnectRef.current = dc;

    return newGameRef.key;
  };

  const handleStartNewGame = async () => {
    const gameId = await createGame(playerName);
    navigate(`/?gameId=${gameId}`);
  };

  const handleNameAndStartGame = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("playerName", trimmed);
    setPlayerName(trimmed);
    const gameId = await createGame(trimmed);
    navigate(`/?gameId=${gameId}`);
  };

  // Spiel laden & Rolle bestimmen
  useEffect(() => {
    if (!gameIdFromUrl) return;

    const gameRef = ref(db, `games/${gameIdFromUrl}`);

    const initGame = async () => {
      const snapshot = await get(gameRef);
      if (!snapshot.exists()) {
        console.error("Spiel nicht gefunden");
        return;
      }
      const data = snapshot.val();
      setGame({ ...data, id: gameIdFromUrl });

      if (data.player_x === playerId) {
        setPlayerSymbol("X");
        // Host: Spiel löschen wenn er geht
        const dc = onDisconnect(gameRef);
        dc.remove();
        disconnectRef.current = dc;
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId });
        setPlayerSymbol("O");
        // Spieler O: seinen Slot beim Verlassen leeren
        const dc = onDisconnect(ref(db, `games/${gameIdFromUrl}/player_o`));
        dc.set(null);
        disconnectRef.current = dc;
      } else if (data.player_o === playerId) {
        setPlayerSymbol("O");
      } else {
        setPlayerSymbol("Spectator");
      }
    };

    initGame();

    return () => {
      // onDisconnect bleibt aktiv für echte Disconnects
    };
  }, [gameIdFromUrl, playerId]);

  // Echtzeit-Updates abonnieren
  useEffect(() => {
    if (!gameIdFromUrl) return;

    const gameRef = ref(db, `games/${gameIdFromUrl}`);
    const unsubscribe = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) {
        setGame({ ...snapshot.val(), id: gameIdFromUrl });
      }
    });

    return () => unsubscribe();
  }, [gameIdFromUrl]);

  // Namen aktualisieren wenn gesetzt
  useEffect(() => {
    const updateName = async () => {
      if (!game || playerSymbol === "Spectator" || !playerName) return;

      const gameRef = ref(db, `games/${game.id}`);
      const updates = {};
      if (playerSymbol === "X" && !game.player_x_name) {
        updates.player_x_name = playerName;
      } else if (playerSymbol === "O" && !game.player_o_name) {
        updates.player_o_name = playerName;
      }

      if (Object.keys(updates).length > 0) {
        await update(gameRef, updates);
      }
    };

    updateName();
  }, [playerName, game, playerSymbol]);

  const handleMove = async (index) => {
    const gameRef = ref(db, `games/${game.id}`);
    const snapshot = await get(gameRef);
    const freshGame = snapshot.val();

    if (
      freshGame.board[index] ||
      freshGame.winner ||
      freshGame.turn !== playerSymbol
    )
      return;

    const newBoard = [...freshGame.board];
    newBoard[index] = playerSymbol;

    const result = checkWinner(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every((cell) => cell !== null);
    const nextTurn = playerSymbol === "X" ? "O" : "X";

    await update(gameRef, {
      board: newBoard,
      turn: winner || isDraw ? null : nextTurn,
      winner: winner ? playerSymbol : isDraw ? "Draw" : null,
      winningCells: winningCells,
    });
  };

  const resetGame = async () => {
    if (!game) return;
    const gameRef = ref(db, `games/${game.id}`);
    await update(gameRef, {
      board: emptyBoard,
      turn: "X",
      winner: null,
      winningCells: [],
    });
  };

  const inviteLink = `${window.location.origin}/?gameId=${game?.id}`;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || "Player O";

  if (!gameIdFromUrl) {
    return (
      <div style={{ textAlign: "center", marginTop: "5rem" }}>
        <h1>Willkommen bei Tic Tac Toe</h1>
        <p>Gib deinen Namen ein, um ein Spiel zu starten:</p>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNameAndStartGame()}
          style={{ padding: "0.5rem", fontSize: "1rem", width: "250px" }}
        />
        <br />
        <button
          onClick={handleNameAndStartGame}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
        >
          Spiel starten
        </button>
      </div>
    );
  }

  if (!game) return <div>Loading...</div>;

  if (!playerName && playerSymbol !== "Spectator") {
    return (
      <div style={{ textAlign: "center", marginTop: "5rem" }}>
        <h2>Bitte gib deinen Namen ein:</h2>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
          style={{ padding: "0.5rem", fontSize: "1rem", width: "250px" }}
        />
        <br />
        <button
          onClick={handleNameSubmit}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
        >
          Bestätigen
        </button>
      </div>
    );
  }

  return (
    <div className="game">
      <h1>
        {game.winner === "Draw"
          ? "Unentschieden!"
          : game.winner
          ? `${game.winner === "X" ? nameX : nameO} gewinnt!`
          : "Tic Tac Toe"}
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
        Du spielst als: <strong>{playerSymbol}</strong> ({playerName})
      </p>

      {playerSymbol === "X" && !game.player_o && (
        <div style={{ marginBottom: "1rem" }}>
          <p>👉 Lade einen Freund ein:</p>
          <input
            readOnly
            value={inviteLink}
            style={{ width: "80%", maxWidth: "400px", padding: "0.5rem" }}
            onClick={(e) => e.target.select()}
          />
          <button
            onClick={() => navigator.clipboard.writeText(inviteLink)}
            style={{ marginLeft: "0.5rem", marginTop: "1rem" }}
          >
            Link kopieren
          </button>
        </div>
      )}

      <div className="grid-container">
        {game.board.map((cell, index) => (
          <div
            key={index}
            className={`grid-element ${
              Array.isArray(game.winningCells) &&
              game.winningCells.includes(index)
                ? "winner-cell"
                : game.winner
                ? "faded"
                : ""
            }`}
            onClick={() => handleMove(index)}
          >
            {cell}
          </div>
        ))}
      </div>

      {(game.winner || game.winner === "Draw") && (
        <div style={{ marginTop: "2rem" }}>
          <button onClick={resetGame} style={{ margin: "1rem" }}>
            Rematch (gleiches Spiel)
          </button>
          <button onClick={handleStartNewGame}>
            Neues Spiel mit anderem Gegner
          </button>
        </div>
      )}
    </div>
  );
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { symbol: board[a], cells: [a, b, c] };
    }
  }
  return null;
}

export default OnlineGame;
