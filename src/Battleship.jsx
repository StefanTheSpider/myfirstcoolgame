import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

const GRID = 10;
const SHIP_SIZES = [5, 4, 3, 3, 2];

function placeShipsRandomly() {
  const occupied = new Set();
  const ships = [];

  for (const size of SHIP_SIZES) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      const horizontal = Math.random() > 0.5;
      const row = Math.floor(Math.random() * (horizontal ? GRID : GRID - size + 1));
      const col = Math.floor(Math.random() * (horizontal ? GRID - size + 1 : GRID));
      const cells = [];
      for (let i = 0; i < size; i++) {
        cells.push(horizontal ? row * GRID + col + i : (row + i) * GRID + col);
      }
      if (cells.every((c) => !occupied.has(c))) {
        cells.forEach((c) => occupied.add(c));
        ships.push(cells);
        placed = true;
      }
    }
  }
  return ships;
}

function normalizeShots(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

function normalizeShips(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw).map((ship) =>
    Array.isArray(ship) ? ship : Object.values(ship)
  );
}

function Battleship() {
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
    const ships = placeShipsRandomly();
    const gamesRef = ref(db, "battleship");
    const newGameRef = push(gamesRef);
    await set(newGameRef, {
      player_x: playerId,
      player_x_name: playerName,
      player_x_ships: ships,
      player_x_shots: [],
      player_o: null,
      player_o_name: null,
      player_o_ships: null,
      player_o_shots: [],
      turn: "X",
      winner: null,
    });
    onDisconnect(newGameRef).remove();
    return newGameRef.key;
  };

  const handleStart = async () => {
    const gameId = await createGame();
    navigate(`/battleship?gameId=${gameId}`);
  };

  useEffect(() => {
    if (!gameIdFromUrl) return;
    const gameRef = ref(db, `battleship/${gameIdFromUrl}`);

    const init = async () => {
      const snapshot = await get(gameRef);
      if (!snapshot.exists()) { navigate("/"); return; }
      const data = snapshot.val();
      setGame({ ...data, id: gameIdFromUrl });

      if (data.player_x === playerId) {
        setPlayerSymbol("X");
        onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        const ships = placeShipsRandomly();
        await update(gameRef, {
          player_o: playerId,
          player_o_name: playerName,
          player_o_ships: ships,
        });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `battleship/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `battleship/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snapshot) => {
      if (snapshot.exists()) setGame({ ...snapshot.val(), id: gameIdFromUrl });
    });
    return () => unsub();
  }, [gameIdFromUrl]);

  const handleShot = async (index) => {
    if (!game || game.winner || game.turn !== playerSymbol || playerSymbol === "Spectator") return;
    if (!game.player_o_ships) return; // Warte auf Gegner

    const gameRef = ref(db, `battleship/${game.id}`);
    const snapshot = await get(gameRef);
    const freshData = snapshot.val();
    if (freshData.turn !== playerSymbol || freshData.winner) return;

    const myShots = normalizeShots(
      playerSymbol === "X" ? freshData.player_x_shots : freshData.player_o_shots
    );
    if (myShots.includes(index)) return; // bereits geschossen

    const opponentShips = normalizeShips(
      playerSymbol === "X" ? freshData.player_o_ships : freshData.player_x_ships
    );

    const newShots = [...myShots, index];
    const allOpponentCells = opponentShips.flat();
    const allSunk = allOpponentCells.every((c) => newShots.includes(c));

    const updates = {
      turn: playerSymbol === "X" ? "O" : "X",
    };
    if (playerSymbol === "X") {
      updates.player_x_shots = newShots;
    } else {
      updates.player_o_shots = newShots;
    }
    if (allSunk) {
      updates.winner = playerSymbol;
      updates.turn = null;
    }

    await update(gameRef, updates);
  };

  const inviteLink = `${window.location.origin}/battleship?gameId=${game?.id}`;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || "Player O";

  if (!gameIdFromUrl) {
    return (
      <div style={{ textAlign: "center", marginTop: "5rem" }}>
        <h1>🚢 Schiffe Versenken</h1>
        <p>Hallo {playerName}! Schiffe werden automatisch platziert.</p>
        <button onClick={handleStart} style={{ padding: "0.5rem 1.5rem", fontSize: "1rem" }}>
          Spiel starten
        </button>
        <br /><br />
        <button onClick={() => navigate("/")}>← Zurück</button>
      </div>
    );
  }

  if (!game) return <div>Loading...</div>;

  const myShips = normalizeShips(
    playerSymbol === "X" ? game.player_x_ships : game.player_o_ships
  );
  const myShots = normalizeShots(
    playerSymbol === "X" ? game.player_x_shots : game.player_o_shots
  );
  const opponentShots = normalizeShots(
    playerSymbol === "X" ? game.player_o_shots : game.player_x_shots
  );
  const opponentShips = normalizeShips(
    playerSymbol === "X" ? game.player_o_ships : game.player_x_ships
  );

  const myShipCells = new Set(myShips.flat());
  const opponentShipCells = new Set(opponentShips.flat());
  const myHitCells = new Set(opponentShots.filter((s) => myShipCells.has(s)));
  const myMissCells = new Set(opponentShots.filter((s) => !myShipCells.has(s)));
  const shotHits = new Set(myShots.filter((s) => opponentShipCells.has(s)));
  const shotMisses = new Set(myShots.filter((s) => !opponentShipCells.has(s)));

  const cellStyle = (bg, cursor = "default", border = "#aaa") => ({
    width: "2rem",
    height: "2rem",
    background: bg,
    border: `1px solid ${border}`,
    cursor,
    display: "inline-block",
    boxSizing: "border-box",
  });

  const renderMyGrid = () => (
    <div>
      <h3>Deine Flotte</h3>
      <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${GRID}, 2rem)`, gap: "2px" }}>
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const isShip = myShipCells.has(i);
          const isHit = myHitCells.has(i);
          const isMiss = myMissCells.has(i);
          const bg = isHit ? "#e74c3c" : isMiss ? "#85c1e9" : isShip ? "#7f8c8d" : "#d6eaf8";
          return <div key={i} style={cellStyle(bg)} title={isHit ? "Treffer!" : isMiss ? "Verfehlt" : ""} />;
        })}
      </div>
    </div>
  );

  const renderOpponentGrid = () => (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Gegner angreifen</h3>
      <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${GRID}, 2rem)`, gap: "2px" }}>
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const isHit = shotHits.has(i);
          const isMiss = shotMisses.has(i);
          const canShoot = !isHit && !isMiss && game.turn === playerSymbol && !game.winner && game.player_o_ships;
          const bg = isHit ? "#e74c3c" : isMiss ? "#85c1e9" : "#d6eaf8";
          return (
            <div
              key={i}
              onClick={() => canShoot && handleShot(i)}
              style={cellStyle(bg, canShoot ? "crosshair" : "default")}
              title={isHit ? "💥 Treffer" : isMiss ? "Wasser" : canShoot ? "Hier schießen" : ""}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <h1>🚢 Schiffe Versenken</h1>

      {game.winner ? (
        <h2>🏆 {game.winner === playerSymbol ? "Du gewinnst!" : `${game.winner === "X" ? nameX : nameO} gewinnt!`}</h2>
      ) : (
        <h2>
          {!game.player_o_ships
            ? "Warte auf Gegner..."
            : game.turn === playerSymbol
            ? "Du bist dran — schieß!"
            : `${game.turn === "X" ? nameX : nameO} schießt...`}
        </h2>
      )}

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

      <div style={{ display: "flex", justifyContent: "center", gap: "3rem", flexWrap: "wrap" }}>
        {playerSymbol !== "Spectator" && renderMyGrid()}
        {game.player_o_ships && playerSymbol !== "Spectator" && renderOpponentGrid()}
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#555" }}>
        🟥 Treffer &nbsp; 🟦 Wasser &nbsp; ⬛ Dein Schiff
      </div>

      {game.winner && (
        <div style={{ marginTop: "1.5rem" }}>
          <button onClick={handleStart} style={{ margin: "0.5rem" }}>Neues Spiel</button>
        </div>
      )}

      <button onClick={() => navigate("/")} style={{ marginTop: "1rem" }}>← Spielauswahl</button>
    </div>
  );
}

export default Battleship;
