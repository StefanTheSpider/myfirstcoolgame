import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, update, onValue } from "firebase/database";
import { db } from "./firebaseClient";
import { useLanguage } from "./LanguageContext";

const GAMES = [
  { key: "tictactoe", icon: "✖️", path: "/tictactoe" },
  { key: "connectFour", icon: "🔴", path: "/connect4" },
  { key: "rps", icon: "✌️", path: "/rps" },
  { key: "battleship", icon: "🚢", path: "/battleship" },
  { key: "memoryMatch", icon: "🃏", path: "/memory" },
];

function GameSuggestion({ gameType, gameId, playerId, currentGame }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  // Listen for suggestions on current game
  useEffect(() => {
    if (!gameId || !gameType) return;
    const sugRef = ref(db, `${gameType}/${gameId}/suggestion`);
    const unsub = onValue(sugRef, (snap) => {
      setSuggestion(snap.exists() ? snap.val() : null);
    });
    return () => unsub();
  }, [gameType, gameId]);

  const suggestGame = async (game) => {
    setShowPicker(false);
    const sugRef = ref(db, `${gameType}/${gameId}`);
    await update(sugRef, {
      suggestion: {
        by: playerId,
        gameKey: game.key,
        gamePath: game.path,
        gameIcon: game.icon,
      },
    });
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    // Clear suggestion and navigate
    const sugRef = ref(db, `${gameType}/${gameId}`);
    update(sugRef, { suggestion: null });
    navigate(`${suggestion.gamePath}?mode=online`);
  };

  const declineSuggestion = async () => {
    const sugRef = ref(db, `${gameType}/${gameId}`);
    await update(sugRef, { suggestion: null });
  };

  // Incoming suggestion from opponent
  if (suggestion && suggestion.by !== playerId) {
    return (
      <div className="mode-overlay" onClick={declineSuggestion}>
        <div className="mode-modal pop" onClick={(e) => e.stopPropagation()}>
          <h2>{t.gameSuggestion}</h2>
          <p style={{ fontSize: "2.5rem", margin: "0.8rem 0" }}>{suggestion.gameIcon}</p>
          <p style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1rem" }}>
            {t.opponentSuggests} <strong>{t[suggestion.gameKey]}</strong>
          </p>
          <div style={{ display: "flex", gap: "0.8rem", justifyContent: "center" }}>
            <button className="btn-primary" onClick={acceptSuggestion}>{t.accept}</button>
            <button className="btn-secondary" onClick={declineSuggestion}>{t.decline}</button>
          </div>
        </div>
      </div>
    );
  }

  // Own suggestion pending
  if (suggestion && suggestion.by === playerId) {
    return (
      <div style={{ margin: "0.5rem 0", padding: "0.5rem 1rem", background: "rgba(167,139,250,0.15)", borderRadius: "10px", display: "inline-block" }}>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.85rem" }}>
          {suggestion.gameIcon} {t.waitingSuggestion}
        </p>
        <button className="btn-secondary" onClick={declineSuggestion} style={{ marginTop: "0.3rem", fontSize: "0.8rem" }}>
          {t.cancelSuggestion}
        </button>
      </div>
    );
  }

  // Available games (exclude current)
  const otherGames = GAMES.filter((g) => g.path !== currentGame);

  return (
    <>
      <button className="btn-icon" onClick={() => setShowPicker(true)} style={{ marginTop: "0.3rem" }}>
        🎲 {t.suggestGame}
      </button>

      {showPicker && (
        <div className="mode-overlay" onClick={() => setShowPicker(false)}>
          <div className="mode-modal pop" onClick={(e) => e.stopPropagation()}>
            <h2>🎲 {t.suggestGame}</h2>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.9rem", marginBottom: "1rem" }}>
              {t.pickGameToSuggest}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {otherGames.map((game) => (
                <button
                  key={game.key}
                  className="btn-primary"
                  onClick={() => suggestGame(game)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
                >
                  {game.icon} {t[game.key]}
                </button>
              ))}
            </div>
            <button className="mode-cancel" onClick={() => setShowPicker(false)}>{t.back}</button>
          </div>
        </div>
      )}
    </>
  );
}

export default GameSuggestion;
