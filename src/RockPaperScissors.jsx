import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

const CHOICES = ["Stein", "Schere", "Papier"];
const ICONS = { Stein: "🪨", Schere: "✂️", Papier: "📄" };

function getResult(choiceX, choiceO) {
  if (choiceX === choiceO) return "Draw";
  if (
    (choiceX === "Stein" && choiceO === "Schere") ||
    (choiceX === "Schere" && choiceO === "Papier") ||
    (choiceX === "Papier" && choiceO === "Stein")
  )
    return "X";
  return "O";
}

function RockPaperScissors() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gameIdFromUrl = params.get("gameId");

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");

  const [playerId] = useState(() => {
    let stored = localStorage.getItem("playerId");
    if (!stored) {
      stored = uuidv4();
      localStorage.setItem("playerId", stored);
    }
    return stored;
  });

  const createGame = async () => {
    const gamesRef = ref(db, "rps");
    const newGameRef = push(gamesRef);
    await set(newGameRef, {
      player_x: playerId,
      player_x_name: playerName,
      player_x_choice: null,
      player_o: null,
      player_o_name: null,
      player_o_choice: null,
      score_x: 0,
      score_o: 0,
      round: 1,
      result: null,
    });
    onDisconnect(newGameRef).remove();
    return newGameRef.key;
  };

  const handleStart = async () => {
    const gameId = await createGame();
    navigate(`/rps?gameId=${gameId}`);
  };

  useEffect(() => {
    if (!gameIdFromUrl) return;
    const gameRef = ref(db, `rps/${gameIdFromUrl}`);

    const init = async () => {
      const snapshot = await get(gameRef);
      if (!snapshot.exists()) { navigate("/"); return; }
      const data = snapshot.val();
      setGame({ ...data, id: gameIdFromUrl });

      if (data.player_x === playerId) {
        setPlayerSymbol("X");
        onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `rps/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `rps/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) setGame({ ...snapshot.val(), id: gameIdFromUrl });
    });
    return () => unsub();
  }, [gameIdFromUrl]);

  // Ergebnis berechnen wenn beide gewählt haben (nur X macht das Update)
  useEffect(() => {
    if (!game || !game.player_x_choice || !game.player_o_choice || game.result) return;
    if (playerSymbol !== "X") return;

    const result = getResult(game.player_x_choice, game.player_o_choice);
    const gameRef = ref(db, `rps/${game.id}`);
    const updates = { result };
    if (result === "X") updates.score_x = (game.score_x || 0) + 1;
    if (result === "O") updates.score_o = (game.score_o || 0) + 1;
    update(gameRef, updates);
  }, [game, playerSymbol]);

  const handleChoice = async (choice) => {
    if (!game || game.result || playerSymbol === "Spectator") return;
    const gameRef = ref(db, `rps/${game.id}`);
    if (playerSymbol === "X" && !game.player_x_choice) {
      await update(gameRef, { player_x_choice: choice });
    } else if (playerSymbol === "O" && !game.player_o_choice) {
      await update(gameRef, { player_o_choice: choice });
    }
  };

  const nextRound = async () => {
    const gameRef = ref(db, `rps/${game.id}`);
    await update(gameRef, {
      player_x_choice: null,
      player_o_choice: null,
      result: null,
      round: (game.round || 1) + 1,
    });
  };

  const inviteLink = `${window.location.origin}/rps?gameId=${game?.id}`;
  const myChoice = playerSymbol === "X" ? game?.player_x_choice : game?.player_o_choice;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || "Player O";

  if (!gameIdFromUrl) {
    return (
      <div style={{ textAlign: "center", marginTop: "5rem" }}>
        <h1>✌️ Stein Schere Papier</h1>
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
    <div style={{ textAlign: "center", marginTop: "3rem" }}>
      <h1>✌️ Stein Schere Papier</h1>

      <div style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>
        Runde {game.round} &nbsp;|&nbsp;
        <strong>{nameX}</strong>: {game.score_x} – <strong>{nameO}</strong>: {game.score_o}
      </div>

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
          <p style={{ color: "#888" }}>Warte auf Mitspieler...</p>
        </div>
      )}

      {game.player_o && !game.result && (
        <div>
          {myChoice ? (
            <p>Du hast gewählt: {ICONS[myChoice]} — warte auf Gegner...</p>
          ) : (
            <div>
              <p>Wähle:</p>
              {CHOICES.map((c) => (
                <button
                  key={c}
                  onClick={() => handleChoice(c)}
                  style={{ margin: "0.5rem", padding: "1rem 1.5rem", fontSize: "2rem" }}
                >
                  {ICONS[c]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {game.result && (
        <div>
          <h2>
            {nameX}: {ICONS[game.player_x_choice]} &nbsp;vs&nbsp; {nameO}: {ICONS[game.player_o_choice]}
          </h2>
          <h2>
            {game.result === "Draw"
              ? "🤝 Unentschieden!"
              : `🏆 ${game.result === "X" ? nameX : nameO} gewinnt!`}
          </h2>
          {playerSymbol !== "Spectator" && (
            <button onClick={nextRound} style={{ padding: "0.5rem 1.5rem", marginTop: "1rem" }}>
              Nächste Runde
            </button>
          )}
        </div>
      )}

      <p style={{ marginTop: "1rem", color: "#555" }}>
        Du spielst als: <strong>{playerSymbol}</strong> ({playerName})
      </p>
      <button onClick={() => navigate("/")} style={{ marginTop: "1rem" }}>
        ← Spielauswahl
      </button>
    </div>
  );
}

export default RockPaperScissors;
