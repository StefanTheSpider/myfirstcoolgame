import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import { v4 as uuidv4 } from "uuid";

const emptyBoard = Array(9).fill(null);

function TicTacToeWrapper() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gameIdFromUrl = params.get("gameId");

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("playerName") || "");
  const [nameInput, setNameInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);

  const [playerId] = useState(() => {
    let stored = localStorage.getItem("playerId");
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem("playerId", stored);
    }
    return stored;
  });

  const handleNameAndStartGame = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;

    localStorage.setItem("playerName", trimmed);
    setPlayerName(trimmed);

    const { data, error } = await supabase
      .from("games")
      .insert([{ board: emptyBoard, turn: "X", player_x: playerId, player_x_name: trimmed }])
      .select()
      .single();

    if (error) {
      console.error("Fehler beim Starten:", error);
    } else {
      navigate(`/?gameId=${data.id}`);
    }
  };

  // Init Game
  useEffect(() => {
    if (!gameIdFromUrl) return;

    const initGame = async () => {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("id", gameIdFromUrl)
        .single();

      if (error) {
        console.error("Ladefehler:", error);
      } else {
        setGame(data);

        if (data.player_x === playerId) {
          setPlayerSymbol("X");
        } else if (!data.player_o) {
          await supabase
            .from("games")
            .update({ player_o: playerId })
            .eq("id", gameIdFromUrl);
          setPlayerSymbol("O");
        } else if (data.player_o === playerId) {
          setPlayerSymbol("O");
        } else {
          setPlayerSymbol("Spectator");
        }
      }
    };

    initGame();
  }, [gameIdFromUrl, playerId]);

  // Listen for changes
  useEffect(() => {
    if (!gameIdFromUrl) return;

    const channel = supabase
      .channel(`game-${gameIdFromUrl}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameIdFromUrl}` },
        (payload) => setGame(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameIdFromUrl]);

  // Update Name if missing
  useEffect(() => {
    const updateName = async () => {
      if (!game || playerSymbol === "Spectator" || !playerName) return;

      const updates = {};
      if (playerSymbol === "X" && !game.player_x_name) {
        updates.player_x_name = playerName;
      } else if (playerSymbol === "O" && !game.player_o_name) {
        updates.player_o_name = playerName;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("games").update(updates).eq("id", game.id);
      }
    };

    updateName();
  }, [playerName, game, playerSymbol]);

  const handleMove = async (index) => {
    const { data: freshGame, error: loadError } = await supabase
      .from("games")
      .select("*")
      .eq("id", game.id)
      .single();

    if (loadError) {
      console.error("Ladefehler vor Zug:", loadError);
      return;
    }

    if (
      freshGame.board[index] ||
      freshGame.winner ||
      freshGame.turn !== playerSymbol
    ) return;

    const newBoard = [...freshGame.board];
    newBoard[index] = playerSymbol;

    const result = checkWinner(newBoard);
    const winner = result ? result.symbol : null;
    const winningCells = result ? result.cells : [];
    const isDraw = !winner && newBoard.every(cell => cell !== null);
    const nextTurn = playerSymbol === "X" ? "O" : "X";

    const { error } = await supabase.from("games")
      .update({
        board: newBoard,
        turn: winner || isDraw ? null : nextTurn,
        winner: winner ? playerSymbol : isDraw ? "Draw" : null,
        winningCells: winningCells,
      })
      .eq("id", game.id);

    if (error) console.error("Update-Fehler:", error);
  };

  const resetGame = async () => {
    if (!game) return;

    const { error } = await supabase.from("games")
      .update({
        board: emptyBoard,
        turn: "X",
        winner: null,
        winningCells: [],
      })
      .eq("id", game.id);

    if (error) console.error("Reset-Fehler:", error);
  };

  const inviteLink = `${window.location.origin}/?gameId=${game?.id}`;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || "Player O";

  // ========== UI ==========

  // Wenn noch kein Spiel läuft
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

  // Wenn Spiel geladen wird
  if (!game) return <div>Loading...</div>;

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

      <p>Du spielst als: <strong>{playerSymbol}</strong> ({playerName})</p>

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
              Array.isArray(game.winningCells) && game.winningCells.includes(index)
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
        <button onClick={resetGame} style={{ marginTop: "2rem" }}>
          Neues Spiel (selbes Game)
        </button>
      )}
    </div>
  );
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { symbol: board[a], cells: [a, b, c] };
    }
  }
  return null;
}

export default TicTacToeWrapper;
