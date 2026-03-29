import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "./LanguageContext";

const GAMES = [
  { key: "tictactoe", icon: "✖️", path: "/tictactoe", descKey: "tictactoeDesc" },
  { key: "connectFour", icon: "🔴", path: "/connect4", descKey: "connectFourDesc" },
  { key: "rps", icon: "✌️", path: "/rps", descKey: "rpsDesc" },
  { key: "battleship", icon: "🚢", path: "/battleship", descKey: "battleshipDesc" },
];

function GameSelector() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [nameInput, setNameInput] = useState(() => localStorage.getItem("playerName") || "");
  const [error, setError] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);

  const handleCardClick = (game) => {
    if (!nameInput.trim()) { setError(t.nameError); return; }
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
    <div className="fade-in" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className="selector-hero">
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
        {error && <p style={{ color: "#f87171", fontSize: "0.85rem", marginTop: "0.4rem" }}>{error}</p>}
      </div>

      <div className="game-selector-grid">
        {GAMES.map((game) => (
          <div key={game.path} className="game-card" onClick={() => handleCardClick(game)}>
            <span className="game-card-icon">{game.icon}</span>
            <h2>{t[game.key]}</h2>
            <p>{t[game.descKey]}</p>
          </div>
        ))}
      </div>

      {selectedGame && (
        <div className="mode-overlay" onClick={() => setSelectedGame(null)}>
          <div className="mode-modal pop" onClick={(e) => e.stopPropagation()}>
            <h2>{selectedGame.icon} {t[selectedGame.key]}</h2>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", marginBottom: "1rem" }}>{t.chooseMode}</p>
            <div className="mode-buttons">
              <button className="mode-btn online-btn" onClick={() => handleMode("online")}>
                🌐 {t.online}
              </button>
              <button className="mode-btn computer-btn" onClick={() => handleMode("computer")}>
                🤖 {t.vsComputer}
              </button>
            </div>
            <button className="mode-cancel" onClick={() => setSelectedGame(null)}>{t.back}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameSelector;
