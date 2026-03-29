import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "./LanguageContext";

const GAMES = [
  { key: "tictactoe", icon: "✖️", path: "/tictactoe" },
  { key: "connectFour", icon: "🔴", path: "/connect4" },
  { key: "rps", icon: "✌️", path: "/rps" },
  { key: "battleship", icon: "🚢", path: "/battleship" },
];

const GAME_DESC_KEYS = {
  tictactoe: "tictactoeDesc",
  connectFour: "connectFourDesc",
  rps: "rpsDesc",
  battleship: "battleshipDesc",
};

function GameSelector() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [nameInput, setNameInput] = useState(
    () => localStorage.getItem("playerName") || ""
  );
  const [error, setError] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);

  const handleCardClick = (game) => {
    if (!nameInput.trim()) {
      setError(t.nameError);
      return;
    }
    localStorage.setItem("playerName", nameInput.trim());
    setError("");
    setSelectedGame(game);
  };

  const handleMode = (mode) => {
    if (!selectedGame) return;
    navigate(`${selectedGame.path}?mode=${mode}`);
    setSelectedGame(null);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "2rem", padding: "0 1rem" }}>
      <h1>🎮 {t.selectGame}</h1>
      <p>{t.enterName}</p>
      <input
        type="text"
        value={nameInput}
        onChange={(e) => { setNameInput(e.target.value); setError(""); }}
        placeholder={t.namePlaceholder}
        className="name-input"
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      />
      {error && <p style={{ color: "red", margin: "0.4rem 0" }}>{error}</p>}

      <div className="game-selector-grid">
        {GAMES.map((game) => (
          <div
            key={game.path}
            className="game-card"
            onClick={() => handleCardClick(game)}
          >
            <div className="game-card-icon">{game.icon}</div>
            <h2>{t[game.key]}</h2>
            <p>{t[GAME_DESC_KEYS[game.key]]}</p>
          </div>
        ))}
      </div>

      {/* Mode selection overlay */}
      {selectedGame && (
        <div className="mode-overlay" onClick={() => setSelectedGame(null)}>
          <div className="mode-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{selectedGame.icon} {t[selectedGame.key]}</h2>
            <div className="mode-buttons">
              <button className="mode-btn online-btn" onClick={() => handleMode("online")}>
                🌐 {t.online}
              </button>
              <button className="mode-btn computer-btn" onClick={() => handleMode("computer")}>
                🤖 {t.vsComputer}
              </button>
            </div>
            <button className="mode-cancel" onClick={() => setSelectedGame(null)}>
              {t.back}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameSelector;
