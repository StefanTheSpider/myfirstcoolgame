import { useLanguage } from "./LanguageContext";

const GAME_ICONS = {
  tictactoe: "✖️",
  connect4: "🔴",
  rps: "✌️",
  battleship: "🚢",
};

function RulesModal({ gameKey, onClose }) {
  const { t } = useLanguage();
  const icon = GAME_ICONS[gameKey] || "🎮";
  const title = t[`rulesTitle_${gameKey}`] || "Rules";
  const rules = t[`rules_${gameKey}`] || [];

  return (
    <div className="rules-overlay" onClick={onClose}>
      <div className="rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rules-header">
          <span className="rules-icon">{icon}</span>
          <h2>{title}</h2>
        </div>
        <ol className="rules-list">
          {rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ol>
        <button className="rules-close-btn" onClick={onClose}>
          {t.closeRules}
        </button>
      </div>
    </div>
  );
}

export default RulesModal;
