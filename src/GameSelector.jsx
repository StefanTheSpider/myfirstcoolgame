import { useState } from "react";
import { useNavigate } from "react-router-dom";

const GAMES = [
  { name: "Tic Tac Toe", icon: "✖️", path: "/tictactoe", desc: "3 in einer Reihe" },
  { name: "Vier Gewinnt", icon: "🔴", path: "/connect4", desc: "4 in einer Reihe" },
  { name: "Stein Schere Papier", icon: "✌️", path: "/rps", desc: "Wähle klug" },
  { name: "Schiffe Versenken", icon: "🚢", path: "/battleship", desc: "Triff alle Schiffe" },
];

function GameSelector() {
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState(
    () => localStorage.getItem("playerName") || ""
  );
  const [error, setError] = useState("");

  const handleSelect = (path) => {
    const name = nameInput.trim();
    if (!name) {
      setError("Bitte zuerst deinen Namen eingeben!");
      return;
    }
    localStorage.setItem("playerName", name);
    setError("");
    navigate(path);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "3rem" }}>
      <h1>🎮 Spielesammlung</h1>
      <p>Gib deinen Namen ein und wähle ein Spiel:</p>
      <input
        type="text"
        value={nameInput}
        onChange={(e) => { setNameInput(e.target.value); setError(""); }}
        placeholder="Dein Name"
        style={{ padding: "0.5rem", fontSize: "1rem", width: "250px" }}
      />
      {error && <p style={{ color: "red", margin: "0.5rem 0" }}>{error}</p>}
      <div className="game-selector-grid">
        {GAMES.map((game) => (
          <div
            key={game.path}
            className="game-card"
            onClick={() => handleSelect(game.path)}
          >
            <div className="game-card-icon">{game.icon}</div>
            <h2>{game.name}</h2>
            <p>{game.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GameSelector;
