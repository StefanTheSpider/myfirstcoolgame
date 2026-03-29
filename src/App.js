import { Component } from "react";
import { Routes, Route } from "react-router-dom";
import { useLanguage } from "./LanguageContext";
import GameSelector from "./GameSelector";
import OnlineGame from "./OnlineGame";
import RockPaperScissors from "./RockPaperScissors";
import ConnectFour from "./ConnectFour";
import Battleship from "./Battleship";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ textAlign: "center", marginTop: "5rem", color: "red" }}>
          <h2>Fehler / Error</h2>
          <p>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function LangToggle() {
  const { language, toggleLanguage } = useLanguage();
  return (
    <button className="lang-toggle" onClick={toggleLanguage}>
      {language === "de" ? "🇬🇧 EN" : "🇩🇪 DE"}
    </button>
  );
}

function App() {
  const { t } = useLanguage();
  return (
    <ErrorBoundary>
      <LangToggle />
      <div className="App">
        <Routes>
          <Route path="/" element={<GameSelector />} />
          <Route path="/tictactoe" element={<OnlineGame />} />
          <Route path="/rps" element={<RockPaperScissors />} />
          <Route path="/connect4" element={<ConnectFour />} />
          <Route path="/battleship" element={<Battleship />} />
        </Routes>
        <div className="powered-by">
          <p>{t.poweredBy}</p>
          <a href="https://coding-kitchen.com/" target="_blank" rel="noopener noreferrer">
            <img src="/coding-kitchen_logo.png" alt="coding kitchen logo" style={{ maxWidth: "150px" }} />
          </a>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
