import { Component } from "react";
import OnlineGame from "./OnlineGame";

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
        <OnlineGame />
        <div>
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
