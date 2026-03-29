import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";

const CHOICES = ["Stein", "Schere", "Papier"];
const ICONS = { Stein: "🪨", Schere: "✂️", Papier: "📄" };
const ICONS_EN = { Stein: "🪨 Rock", Schere: "✂️ Scissors", Papier: "📄 Paper" };

function getResult(cx, co) {
  if (cx === co) return "Draw";
  if ((cx==="Stein"&&co==="Schere")||(cx==="Schere"&&co==="Papier")||(cx==="Papier"&&co==="Stein")) return "X";
  return "O";
}

function getAiChoice() {
  return CHOICES[Math.floor(Math.random() * 3)];
}

function RockPaperScissors() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  const choiceLabel = (key) => language === "en" ? ICONS_EN[key] : `${ICONS[key]} ${key}`;

  // ── Computer mode ──────────────────────────────────────────────────────

  const initComputerGame = () => ({
    id: "local",
    player_x: playerId, player_x_name: playerName,
    player_x_choice: null,
    player_o: "computer", player_o_name: t.computer,
    player_o_choice: null,
    score_x: 0, score_o: 0,
    round: 1, result: null,
  });

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame(initComputerGame());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  const handleComputerChoice = (choice) => {
    if (!game || game.result) return;
    const aiChoice = getAiChoice();
    const result = getResult(choice, aiChoice);
    setGame(prev => ({
      ...prev,
      player_x_choice: choice,
      player_o_choice: aiChoice,
      result,
      score_x: prev.score_x + (result === "X" ? 1 : 0),
      score_o: prev.score_o + (result === "O" ? 1 : 0),
    }));
  };

  const nextRoundComputer = () => {
    setGame(prev => ({
      ...prev,
      player_x_choice: null, player_o_choice: null, result: null,
      round: prev.round + 1,
    }));
  };

  // ── Online mode ────────────────────────────────────────────────────────

  const createOnlineGame = async () => {
    const gRef = ref(db, "rps");
    const newRef = push(gRef);
    await set(newRef, {
      player_x: playerId, player_x_name: playerName,
      player_x_choice: null,
      player_o: null, player_o_name: null, player_o_choice: null,
      score_x: 0, score_o: 0, round: 1, result: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(initComputerGame()); return; }
    const id = await createOnlineGame();
    navigate(`/rps?gameId=${id}&mode=online`);
  };

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `rps/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({ ...data, id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `rps/${gameIdFromUrl}/player_o`)).set(null);
      } else if (data.player_o === playerId) {
        setPlayerSymbol("O");
      } else {
        setPlayerSymbol("Spectator");
      }
    };
    init();
  }, [gameIdFromUrl, playerId, navigate, playerName, isComputer]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `rps/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) setGame({ ...snap.val(), id: gameIdFromUrl });
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  // Calculate result when both chose (X triggers)
  useEffect(() => {
    if (!game || !game.player_x_choice || !game.player_o_choice || game.result || isComputer) return;
    if (playerSymbol !== "X") return;
    const result = getResult(game.player_x_choice, game.player_o_choice);
    const gameRef = ref(db, `rps/${game.id}`);
    const updates = { result };
    if (result === "X") updates.score_x = (game.score_x || 0) + 1;
    if (result === "O") updates.score_o = (game.score_o || 0) + 1;
    update(gameRef, updates);
  }, [game, playerSymbol, isComputer]);

  const handleOnlineChoice = async (choice) => {
    if (!game || game.result || playerSymbol === "Spectator") return;
    const gameRef = ref(db, `rps/${game.id}`);
    if (playerSymbol === "X" && !game.player_x_choice)
      await update(gameRef, { player_x_choice: choice });
    else if (playerSymbol === "O" && !game.player_o_choice)
      await update(gameRef, { player_o_choice: choice });
  };

  const nextRoundOnline = async () => {
    const gameRef = ref(db, `rps/${game.id}`);
    await update(gameRef, {
      player_x_choice: null, player_o_choice: null,
      result: null, round: (game.round || 1) + 1,
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/rps?gameId=${game?.id}&mode=online`;
  const effectiveSym = isComputer ? "X" : playerSymbol;
  const myChoice = effectiveSym === "X" ? game?.player_x_choice : game?.player_o_choice;

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div style={{ textAlign: "center", marginTop: "4rem", padding: "0 1rem" }}>
        <h1>✌️ {t.rps}</h1>
        <p>{playerName}</p>
        <button className="primary-btn" onClick={handleStart}>{t.startGame}</button>
        <br /><br />
        <button className="secondary-btn" onClick={() => navigate("/")}>{t.back}</button>
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem" }}>{t.loading}</div>;

  return (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <h1>✌️ {t.rps}</h1>

      <div style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
        {t.round} {game.round} &nbsp;|&nbsp;
        <strong>{nameX}</strong>: {game.score_x} – <strong>{nameO}</strong>: {game.score_o}
      </div>

      {!isComputer && effectiveSym === "X" && !game.player_o && (
        <div style={{ marginBottom: "1rem" }}>
          <p>{t.inviteFriend}</p>
          <input readOnly value={inviteLink}
            style={{ width: "80%", maxWidth: "350px", padding: "0.4rem", fontSize: "0.85rem" }}
            onClick={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard.writeText(inviteLink)} style={{ marginLeft: "0.5rem" }}>
            {t.copyLink}
          </button>
          <p style={{ color: "#888" }}>{t.waitingOpponent}</p>
        </div>
      )}

      {(isComputer || game.player_o) && !game.result && (
        <div>
          {myChoice ? (
            <p>{t.youChose} {ICONS[myChoice]} — {t.waitingChoice}</p>
          ) : (
            <div>
              <p>{t.choose}</p>
              <div className="rps-choices">
                {CHOICES.map((c) => (
                  <button
                    key={c}
                    className="rps-btn"
                    onClick={() => isComputer ? handleComputerChoice(c) : handleOnlineChoice(c)}
                  >
                    {ICONS[c]}
                    <span className="rps-label">{language === "en"
                      ? c === "Stein" ? "Rock" : c === "Schere" ? "Scissors" : "Paper"
                      : c}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {game.result && (
        <div>
          <div style={{ fontSize: "1.2rem", margin: "1rem 0" }}>
            <span>{nameX}: {choiceLabel(game.player_x_choice)}</span>
            <span style={{ margin: "0 1rem" }}>vs</span>
            <span>{nameO}: {choiceLabel(game.player_o_choice)}</span>
          </div>
          <h2>
            {game.result === "Draw"
              ? `🤝 ${t.draw}`
              : `🏆 ${game.result === "X" ? nameX : nameO} ${t.wins}`}
          </h2>
          <button className="primary-btn" onClick={isComputer ? nextRoundComputer : nextRoundOnline}>
            {t.nextRound}
          </button>
        </div>
      )}

      <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#555" }}>
        {t.playAs}: <strong>{effectiveSym}</strong> ({playerName})
      </p>
      <button className="secondary-btn" onClick={() => navigate("/")} style={{ marginTop: "0.5rem" }}>
        {t.gameSelection}
      </button>
    </div>
  );
}

export default RockPaperScissors;
