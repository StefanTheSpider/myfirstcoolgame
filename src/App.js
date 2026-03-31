import { Component } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useLanguage } from "./LanguageContext";
import GameSelector from "./GameSelector";
import OnlineGame from "./OnlineGame";
import RockPaperScissors from "./RockPaperScissors";
import ConnectFour from "./ConnectFour";
import Battleship from "./Battleship";
import Reversi from "./Reversi";
import Gomoku from "./Gomoku";
import DotsAndBoxes from "./DotsAndBoxes";
import MemoryMatch from "./MemoryMatch";
import Nim from "./Nim";
import Mastermind from "./Mastermind";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ textAlign: "center", marginTop: "5rem", color: "#f87171" }}>
          <h2>Fehler / Error</h2>
          <p style={{ color: "rgba(255,255,255,0.5)", marginTop: "0.5rem" }}>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function TopBar() {
  const { language, toggleLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        {!isHome && (
          <button className="btn-icon" onClick={() => navigate("/")}>
            🏠 {t.gameSelection}
          </button>
        )}
        {isHome && <span className="top-bar-title">🎮 {t.selectGame}</span>}
      </div>
      <div className="top-bar-right">
        <button className="lang-toggle" onClick={toggleLanguage}>
          {language === "de" ? "🇬🇧 EN" : "🇩🇪 DE"}
        </button>
      </div>
    </div>
  );
}

function App() {
  const { t } = useLanguage();
  return (
    <ErrorBoundary>
      <TopBar />
      <div className="App">
        <div className="page">
          <Routes>
            <Route path="/" element={<GameSelector />} />
            <Route path="/tictactoe" element={<OnlineGame />} />
            <Route path="/rps" element={<RockPaperScissors />} />
            <Route path="/connect4" element={<ConnectFour />} />
            <Route path="/battleship" element={<Battleship />} />
            <Route path="/reversi" element={<Reversi />} />
            <Route path="/gomoku" element={<Gomoku />} />
            <Route path="/dotsboxes" element={<DotsAndBoxes />} />
            <Route path="/memory" element={<MemoryMatch />} />
            <Route path="/nim" element={<Nim />} />
            <Route path="/mastermind" element={<Mastermind />} />
          </Routes>
          <div className="powered-by">
            <p>{t.poweredBy}</p>
            <a href="https://coding-kitchen.com/" target="_blank" rel="noopener noreferrer">
              <img src="/coding-kitchen_logo.png" alt="coding kitchen logo" />
            </a>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
