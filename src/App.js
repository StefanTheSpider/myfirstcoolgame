import { Component } from "react";
import { Routes, Route } from "react-router-dom";
import GameSelector from "./GameSelector";
import OnlineGame from "./OnlineGame";
import RockPaperScissors from "./RockPaperScissors";
import ConnectFour from "./ConnectFour";
import Battleship from "./Battleship";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ textAlign: "center", marginTop: "5rem", color: "red" }}>
          <h2>Fehler beim Laden</h2>
          <p>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <div className="App">
        <Routes>
          <Route path="/" element={<GameSelector />} />
          <Route path="/tictactoe" element={<OnlineGame />} />
          <Route path="/rps" element={<RockPaperScissors />} />
          <Route path="/connect4" element={<ConnectFour />} />
          <Route path="/battleship" element={<Battleship />} />
        </Routes>
        <div style={{ marginTop: "3rem" }}>
          <h2>Powered by</h2>
          <a href="https://coding-kitchen.com/" target="_blank" rel="noopener noreferrer">
            <img src="/coding-kitchen_logo.png" alt="coding kitchen logo" />
          </a>
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
