import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const CHOICES = ["Stein", "Schere", "Papier"];
const ICONS = { Stein: "🪨", Schere: "✂️", Papier: "📄" };

function getResult(cx, co) {
  if (cx === co) return "Draw";
  if ((cx==="Stein"&&co==="Schere")||(cx==="Schere"&&co==="Papier")||(cx==="Papier"&&co==="Stein")) return "X";
  return "O";
}
function getAiChoice() { return CHOICES[Math.floor(Math.random() * 3)]; }

// ── Countdown hook ─────────────────────────────────────────────────────────
function useCountdown(active, steps, onDone) {
  const [step, setStep] = useState(-1);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) { setStep(-1); return; }
    setStep(0);
    let i = 0;
    const tick = () => {
      i++;
      if (i < steps) { setStep(i); timerRef.current = setTimeout(tick, 600); }
      else { setStep(steps); setTimeout(onDone, 200); }
    };
    timerRef.current = setTimeout(tick, 600);
    return () => clearTimeout(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return step;
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
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(null); // chosen but countdown running
  const [countdownActive, setCountdownActive] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const sarcasticRef = useRef(null);

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  const label = (key) => {
    if (!key) return "";
    return language === "en"
      ? key === "Stein" ? "Rock" : key === "Schere" ? "Scissors" : "Paper"
      : key;
  };

  // Countdown: 4 steps (Stein / Schere / Papier / Los!)
  const countdownStep = useCountdown(countdownActive, 3, () => {
    setCountdownActive(false);
    setRevealed(true);
    if (isComputer && pendingChoice) {
      const aiChoice = getAiChoice();
      const result = getResult(pendingChoice, aiChoice);
      setGame(prev => ({
        ...prev,
        player_x_choice: pendingChoice,
        player_o_choice: aiChoice,
        result,
        score_x: prev.score_x + (result === "X" ? 1 : 0),
        score_o: prev.score_o + (result === "O" ? 1 : 0),
      }));
    }
    setPendingChoice(null);
  });

  // Show overlay when result comes in
  useEffect(() => {
    if (revealed && game?.result) {
      sarcasticRef.current = null; // force new pick
      const timer = setTimeout(() => setShowOverlay(true), 600);
      return () => clearTimeout(timer);
    }
  }, [revealed, game?.result]);

  // Reset revealed when new round starts
  useEffect(() => {
    if (game && !game.result) { setRevealed(false); setShowOverlay(false); }
  }, [game?.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computer mode ──────────────────────────────────────────────────────

  const initComputerGame = () => ({
    id: "local",
    player_x: playerId, player_x_name: playerName, player_x_choice: null,
    player_o: "computer", player_o_name: t.computer, player_o_choice: null,
    score_x: 0, score_o: 0, round: 1, result: null,
  });

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame(initComputerGame());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  const handleComputerChoice = (choice) => {
    if (!game || game.result || countdownActive) return;
    setPendingChoice(choice);
    setCountdownActive(true);
    setRevealed(false);
    setShowOverlay(false);
  };

  const nextRoundComputer = () => {
    setGame(prev => ({
      ...prev,
      player_x_choice: null, player_o_choice: null, result: null, round: prev.round + 1,
    }));
    setRevealed(false); setShowOverlay(false);
  };

  // ── Online mode ────────────────────────────────────────────────────────

  const createOnlineGame = async () => {
    const gRef = ref(db, "rps");
    const newRef = push(gRef);
    await set(newRef, {
      player_x: playerId, player_x_name: playerName, player_x_choice: null,
      player_o: null, player_o_name: null, player_o_choice: null,
      score_x: 0, score_o: 0, round: 1, result: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(initComputerGame()); setRevealed(false); setShowOverlay(false); return; }
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
      } else { setPlayerSymbol("Spectator"); }
    };
    init();
  }, [gameIdFromUrl, playerId, navigate, playerName, isComputer]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `rps/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame(prev => {
          // detect when result first appears → trigger reveal
          if (!prev?.result && data.result) setRevealed(true);
          return { ...data, id: gameIdFromUrl };
        });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  // X calculates result when both chose
  useEffect(() => {
    if (!game || !game.player_x_choice || !game.player_o_choice || game.result || isComputer) return;
    if (playerSymbol !== "X") return;
    const result = getResult(game.player_x_choice, game.player_o_choice);
    const gameRef = ref(db, `rps/${game.id}`);
    const upd = { result };
    if (result === "X") upd.score_x = (game.score_x || 0) + 1;
    if (result === "O") upd.score_o = (game.score_o || 0) + 1;
    update(gameRef, upd);
  }, [game, playerSymbol, isComputer]);

  const handleOnlineChoice = async (choice) => {
    if (!game || game.result || playerSymbol === "Spectator" || countdownActive) return;
    const gameRef = ref(db, `rps/${game.id}`);
    if (playerSymbol === "X" && !game.player_x_choice) {
      setPendingChoice(choice); setCountdownActive(true); setRevealed(false); setShowOverlay(false);
      await update(gameRef, { player_x_choice: choice });
    } else if (playerSymbol === "O" && !game.player_o_choice) {
      setPendingChoice(choice); setCountdownActive(true); setRevealed(false); setShowOverlay(false);
      await update(gameRef, { player_o_choice: choice });
    }
  };

  const nextRoundOnline = async () => {
    const gameRef = ref(db, `rps/${game.id}`);
    await update(gameRef, {
      player_x_choice: null, player_o_choice: null, result: null, round: (game.round || 1) + 1,
    });
    setRevealed(false); setShowOverlay(false);
  };

  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/rps?gameId=${game?.id}&mode=online`;
  const effectiveSym = isComputer ? "X" : playerSymbol;
  const myChoice = effectiveSym === "X" ? game?.player_x_choice : game?.player_o_choice;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "500px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">✌️ {t.rps}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="rps" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  // What the player wins/loses
  const overlayResult = !game.result ? null
    : game.result === "Draw" ? "draw"
    : game.result === effectiveSym ? "win" : "loss";

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 1rem 1rem" }}>
      {topBar}
      <h1 className="game-title">✌️ {t.rps}</h1>

      {/* Score */}
      <div className="score-bar">
        <span className="score-name player-x">{nameX}</span>
        <span className="score-num">{game.score_x}</span>
        <span className="score-sep">|</span>
        <span className="score-num">{game.score_o}</span>
        <span className="score-name player-o">{nameO}</span>
      </div>
      <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.35)", marginBottom: "0.75rem" }}>{t.round} {game.round}</p>

      {/* Invite */}
      {!isComputer && effectiveSym === "X" && !game.player_o && (
        <div className="invite-box">
          <p>{t.inviteFriend}</p>
          <div className="invite-row">
            <input readOnly value={inviteLink} className="invite-input" onClick={(e) => e.target.select()} />
            <button className="btn-primary" onClick={() => copyLink(inviteLink)}>{copied ? "✅" : t.copyLink}</button>
          </div>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.82rem" }}>{t.waitingOpponent}</p>
        </div>
      )}

      {/* Countdown animation */}
      {countdownActive && (
        <div className="rps-countdown-display" key={countdownStep}>
          {t.rpsCountdown[countdownStep] ?? ""}
        </div>
      )}

      {/* Shaking fists during countdown */}
      {countdownActive && (
        <div style={{ display: "flex", justifyContent: "center", gap: "3rem", marginBottom: "0.5rem" }}>
          <span className="rps-shaking" style={{ fontSize: "3rem" }}>✊</span>
          <span className="rps-shaking" style={{ fontSize: "3rem", animationDelay: "0.15s" }}>✊</span>
        </div>
      )}

      {/* Choice buttons */}
      {(isComputer || game.player_o) && !countdownActive && !revealed && (
        <div>
          {myChoice ? (
            <div className="status-badge status-wait" style={{ marginTop: "0.5rem" }}>
              ✊ {t.waitingChoice}
            </div>
          ) : (
            <div>
              <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "0.5rem" }}>{t.choose}</p>
              <div className="rps-choices">
                {CHOICES.map((c) => (
                  <button key={c} className="rps-btn"
                    onClick={() => isComputer ? handleComputerChoice(c) : handleOnlineChoice(c)}>
                    {ICONS[c]}
                    <span className="rps-label">{label(c)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reveal */}
      {revealed && game.player_x_choice && game.player_o_choice && (
        <div className="rps-vs-row">
          <div className="rps-choice-card rps-reveal">
            <span className="player-name player-x">{nameX}</span>
            <span className="emoji">{ICONS[game.player_x_choice]}</span>
            <span className="name">{label(game.player_x_choice)}</span>
          </div>
          <span style={{ fontSize: "1.5rem", color: "rgba(255,255,255,0.3)", fontWeight: 900 }}>{t.vs}</span>
          <div className="rps-choice-card rps-reveal" style={{ animationDelay: "0.1s" }}>
            <span className="player-name player-o">{nameO}</span>
            <span className="emoji">{ICONS[game.player_o_choice]}</span>
            <span className="name">{label(game.player_o_choice)}</span>
          </div>
        </div>
      )}

      <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.3)" }}>
        {t.playAs}: <strong>{effectiveSym}</strong> ({playerName})
      </p>
      <button className="btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "0.5rem" }}>
        {t.gameSelection}
      </button>

      {/* Result overlay */}
      {showOverlay && overlayResult && (
        <GameResultOverlay
          result={overlayResult}
          winnerName={game.result === "X" ? nameX : nameO}
          onClose={() => setShowOverlay(false)}
        >
          <button className="btn-primary" onClick={() => { setShowOverlay(false); isComputer ? nextRoundComputer() : nextRoundOnline(); }}>
            {t.nextRound}
          </button>
          <button className="btn-secondary" onClick={() => setShowOverlay(false)}>✕</button>
        </GameResultOverlay>
      )}

      {showRules && <RulesModal gameKey="rps" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default RockPaperScissors;
