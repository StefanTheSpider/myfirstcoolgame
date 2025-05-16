import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useSearchParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";

const emptyBoard = Array(9).fill(null);

function OnlineGame() {
  const [params] = useSearchParams();
  const urlGameId = params.get("gameId");
  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("playerName") || "");
  const [nameInput, setNameInput] = useState("");

  const [playerId] = useState(() => {
    let stored = localStorage.getItem("playerId");
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem("playerId", stored);
    }
    return stored;
  });

  useEffect(() => {
    const initGame = async () => {
      if (!urlGameId) {
        const { data, error } = await supabase
          .from("games")
          .insert([{ board: emptyBoard, turn: "X", player_x: playerId }])
          .select()
          .single();

        if (error) {
          console.error("INSERT-Fehler:", error);
        } else {
          setGame(data);
          setPlayerSymbol("X");
          window.history.replaceState(null, "", `?gameId=${data.id}`);
        }
        return;
      }

      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("id", urlGameId)
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
            .eq("id", urlGameId);
          setPlayerSymbol("O");
        } else if (data.player_o === playerId) {
          setPlayerSymbol("O");
        } else {
          setPlayerSymbol("Spectator");
        }
      }
    };

    initGame();
  }, [urlGameId, playerId]);

  // Nachträgliches Speichern des Spielernamens, wenn verfügbar
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

  // Realtime-Updates
  useEffect(() => {
    const gameId = urlGameId || game?.id;
    if (!gameId) return;

    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          setGame(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [urlGameId, game?.id]);

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

  // Name-Eingabe UI
  if (!playerName && playerSymbol !== "Spectator") {
    const handleNameSubmit = () => {
      const trimmed = nameInput.trim();
      if (trimmed) {
        localStorage.setItem("playerName", trimmed);
        setPlayerName(trimmed);
      }
    };

    return (
      <div className="game">
        <h2>Bitte gib deinen Namen ein:</h2>
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNameSubmit();
          }}
          style={{ padding: "0.5rem", fontSize: "1rem" }}
        />
        <br />
        <button
          onClick={handleNameSubmit}
          style={{ marginTop: "1rem" }}
        >
          Bestätigen
        </button>
      </div>
    );
  }

  if (!game) return <div>Loading...</div>;

  const inviteLink = `${window.location.origin}/?gameId=${game.id}`;
  const nameX = game.player_x_name || "Player X";
  const nameO = game.player_o_name || "Player O";

  return (
    <div className="game">
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <h1 style={{ margin: 0 }}>
          {game.winner === "Draw"
            ? "Unentschieden!"
            : game.winner
            ? `${game.winner === "X" ? nameX : nameO} gewinnt!`
            : "Online Tic Tac Toe"}
        </h1>
        {(game.winner === "Draw" || game.winner) && (
          <button onClick={resetGame}>Neues Spiel</button>
        )}
      </div>

      <h2>
        {playerSymbol === "Spectator"
          ? "Spectating..."
          : game.winner
          ? ""
          : game.turn === playerSymbol
          ? "Du bist dran"
          : `${game.turn === "X" ? nameX : nameO} ist dran`}
      </h2>

      {playerSymbol === "X" && (
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
            style={{ marginLeft: "0.5rem" }}
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

export default OnlineGame;
