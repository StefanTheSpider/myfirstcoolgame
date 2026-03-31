import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const COLORS = ["🔴","🟠","🟡","🟢","🔵","🟣"];
const CODE_LEN = 4;
const MAX_GUESSES = 10;

function randomCode() {
  return Array.from({ length: CODE_LEN }, () => Math.floor(Math.random() * COLORS.length));
}

function getFeedback(secret, guess) {
  let black = 0, white = 0;
  const sUsed = Array(COLORS.length).fill(0);
  const gUsed = Array(COLORS.length).fill(0);
  for (let i = 0; i < CODE_LEN; i++) {
    if (secret[i] === guess[i]) { black++; }
    else { sUsed[secret[i]]++; gUsed[guess[i]]++; }
  }
  for (let c = 0; c < COLORS.length; c++) white += Math.min(sUsed[c], gUsed[c]);
  return { black, white };
}

function normalizeArray(raw, len, def = null) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function Mastermind() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");
  const [showOverlay, setShowOverlay] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  // Current guess being built (array of CODE_LEN color indices or null)
  const [currentGuess, setCurrentGuess] = useState(Array(CODE_LEN).fill(null));
  const [selectedSlot, setSelectedSlot] = useState(0);
  // For online code setter: the code they set (only stored locally + sent to FB once)
  const [mySecretCode, setMySecretCode] = useState(null);
  const [codeInput, setCodeInput] = useState(Array(CODE_LEN).fill(null));
  const [codeSelectedSlot, setCodeSelectedSlot] = useState(0);

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  // Computer mode: computer sets random code, player X guesses
  function makeInitGame() {
    const secret = randomCode();
    return {
      id: "local",
      secretCode: secret,
      guesses: [],
      currentGuessIdx: 0,
      phase: "guessing", // computer always sets code
      turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: "computer", player_o_name: t.computer,
      winner: null,
    };
  }

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setGame(makeInitGame());
    setCurrentGuess(Array(CODE_LEN).fill(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `mastermind/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      const guesses = data.guesses ? Object.values(data.guesses) : [];
      setGame({ ...data, guesses, id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
        // X is code setter; restore their secret if it exists
        if (data.secretCode) {
          setMySecretCode(Object.values(data.secretCode));
        }
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `mastermind/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `mastermind/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const guesses = data.guesses ? Object.values(data.guesses) : [];
        setGame({ ...data, guesses, id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const gRef = ref(db, "mastermind");
    const newRef = push(gRef);
    await set(newRef, {
      secretCode: null, // X will set this
      guesses: [],
      phase: "setting", // X sets code first
      turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null,
      winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) {
      setGame(makeInitGame());
      setCurrentGuess(Array(CODE_LEN).fill(null));
      setSelectedSlot(0);
      setShowOverlay(false);
      return;
    }
    const id = await createOnlineGame();
    navigate(`/mastermind?gameId=${id}&mode=online`);
  };

  // Color button click for code setting (online)
  const handleCodeColorClick = (colorIdx) => {
    const newCode = [...codeInput];
    newCode[codeSelectedSlot] = colorIdx;
    setCodeInput(newCode);
    if (codeSelectedSlot < CODE_LEN - 1) setCodeSelectedSlot(codeSelectedSlot + 1);
  };

  const handleConfirmCode = async () => {
    if (codeInput.some(c => c === null)) return;
    if (!game) return;
    const gameRef = ref(db, `mastermind/${game.id}`);
    setMySecretCode(codeInput);
    await update(gameRef, { secretCode: codeInput, phase: "guessing", turn: "O" });
    setCodeInput(Array(CODE_LEN).fill(null));
    setCodeSelectedSlot(0);
  };

  // Color button click for guessing
  const handleGuessColorClick = (colorIdx) => {
    const newGuess = [...currentGuess];
    newGuess[selectedSlot] = colorIdx;
    setCurrentGuess(newGuess);
    if (selectedSlot < CODE_LEN - 1) setSelectedSlot(selectedSlot + 1);
  };

  const handleSubmitGuess = async () => {
    if (currentGuess.some(c => c === null)) return;
    if (!game) return;

    if (isComputer) {
      const secret = game.secretCode;
      const feedback = getFeedback(secret, currentGuess);
      const newGuesses = [...(game.guesses || []), { code: currentGuess, result: feedback }];
      const solved = feedback.black === CODE_LEN;
      const outOfGuesses = newGuesses.length >= MAX_GUESSES && !solved;
      setGame(prev => ({
        ...prev, guesses: newGuesses,
        winner: solved ? "X" : outOfGuesses ? "O" : null, // If unsolved, code setter (computer/"O") wins
      }));
      setCurrentGuess(Array(CODE_LEN).fill(null));
      setSelectedSlot(0);
    } else {
      if (game.turn !== playerSymbol || playerSymbol !== "O") return;
      const gameRef = ref(db, `mastermind/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.winner || fd.phase !== "guessing") return;
      const secret = normalizeArray(fd.secretCode, CODE_LEN, 0);
      const feedback = getFeedback(secret, currentGuess);
      const existingGuesses = fd.guesses ? Object.values(fd.guesses) : [];
      const newGuesses = [...existingGuesses, { code: currentGuess, result: feedback }];
      const solved = feedback.black === CODE_LEN;
      const outOfGuesses = newGuesses.length >= MAX_GUESSES && !solved;
      const winner = solved ? "O" : outOfGuesses ? "X" : null;
      await update(gameRef, {
        guesses: newGuesses,
        winner,
        turn: winner ? null : "O",
      });
      setCurrentGuess(Array(CODE_LEN).fill(null));
      setSelectedSlot(0);
    }
  };

  const resetComputer = () => {
    setGame(makeInitGame());
    setCurrentGuess(Array(CODE_LEN).fill(null));
    setSelectedSlot(0);
    setShowOverlay(false);
  };
  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `mastermind/${game.id}`), {
      secretCode: null, guesses: [], phase: "setting", turn: "X", winner: null,
    });
    setMySecretCode(null);
    setCodeInput(Array(CODE_LEN).fill(null));
    setCodeSelectedSlot(0);
    setCurrentGuess(Array(CODE_LEN).fill(null));
    setSelectedSlot(0);
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/mastermind?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">🔐 {t.mastermind}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="mastermind" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSym ? "win" : "loss";

  const guesses = game.guesses || [];
  const attemptsUsed = guesses.length;
  const attemptsLeft = MAX_GUESSES - attemptsUsed;

  // Determine status
  let statusClass = "status-turn";
  let statusText = "";
  if (game.winner) {
    statusClass = "status-win";
    statusText = `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`;
  } else if (isComputer) {
    statusClass = "status-turn";
    statusText = `${t.attemptsLeft}: ${attemptsLeft}`;
  } else if (game.phase === "setting" && playerSymbol === "X") {
    statusClass = "status-turn";
    statusText = t.setCode;
  } else if (game.phase === "setting" && playerSymbol !== "X") {
    statusClass = "status-wait";
    statusText = `⏳ ${nameX} ${t.setCode}...`;
  } else if (game.phase === "guessing") {
    const isGuesser = isComputer ? true : playerSymbol === "O";
    if (isGuesser && (isComputer || game.turn === playerSymbol)) {
      statusClass = "status-turn";
      statusText = t.codeBreakerTurn;
    } else if (!isComputer && game.turn !== playerSymbol) {
      statusClass = "status-wait";
      statusText = playerSymbol === "X" ? t.codeSetterWaiting : `⏳ ${nameO}...`;
    }
  }

  const isCodeSetter = !isComputer && playerSymbol === "X";
  const canGuess = !game.winner && game.phase === "guessing" && (isComputer ? true : game.turn === playerSymbol && playerSymbol === "O");

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">🔐 {t.mastermind}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">🔐 {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">🔍 {nameO}</span>
        {!isComputer && <span>— {t.playAs}: <strong>{effectiveSym}</strong></span>}
      </div>

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

      {/* Code setter view (online only) */}
      {!isComputer && isCodeSetter && game.phase === "setting" && (
        <div style={{ margin: "1rem auto", maxWidth: "340px" }}>
          <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: "0.5rem" }}>{t.setCode}:</p>
          <div className="mm-secret-display">
            {codeInput.map((c, i) => (
              <div
                key={i}
                className="mm-peg"
                style={{ border: i === codeSelectedSlot ? "2px solid #a78bfa" : "2px solid rgba(255,255,255,0.2)", cursor: "pointer" }}
                onClick={() => setCodeSelectedSlot(i)}
              >
                {c !== null ? COLORS[c] : <span style={{ opacity: 0.3 }}>?</span>}
              </div>
            ))}
          </div>
          <div className="mm-color-picker">
            {COLORS.map((col, idx) => (
              <button key={idx} className="mm-color-btn" onClick={() => handleCodeColorClick(idx)}>{col}</button>
            ))}
          </div>
          <button
            className="btn-primary"
            onClick={handleConfirmCode}
            disabled={codeInput.some(c => c === null)}
          >
            {t.confirmCode}
          </button>
        </div>
      )}

      {/* Code setter waiting view */}
      {!isComputer && isCodeSetter && game.phase === "guessing" && (
        <div style={{ margin: "0.5rem auto" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.9rem" }}>{t.codeSetterWaiting}</p>
          {mySecretCode && (
            <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "0.5rem" }}>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>Code: </span>
              {mySecretCode.map((c, i) => <span key={i} style={{ fontSize: "1.2rem" }}>{COLORS[c]}</span>)}
            </div>
          )}
        </div>
      )}

      {/* Guess board */}
      {(isComputer || game.phase === "guessing") && (
        <div style={{ margin: "0.5rem 0" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            {t.attempts}: {attemptsUsed}/{MAX_GUESSES}
          </p>
          <div className="mm-board">
            {Array.from({ length: MAX_GUESSES }, (_, rowIdx) => {
              const guess = guesses[rowIdx];
              const isActive = !game.winner && rowIdx === attemptsUsed && canGuess;
              return (
                <div key={rowIdx} className={`mm-row${isActive ? " active-row" : ""}`}>
                  {Array.from({ length: CODE_LEN }, (_, pegIdx) => {
                    const val = guess ? guess.code[pegIdx] : (isActive ? currentGuess[pegIdx] : null);
                    return (
                      <div
                        key={pegIdx}
                        className={`mm-peg${val === null ? " mm-peg-empty" : ""}`}
                        style={{ cursor: isActive ? "pointer" : "default", border: isActive && pegIdx === selectedSlot ? "2px solid #a78bfa" : "2px solid rgba(255,255,255,0.2)" }}
                        onClick={() => isActive && setSelectedSlot(pegIdx)}
                      >
                        {val !== null ? COLORS[val] : <span>·</span>}
                      </div>
                    );
                  })}
                  <div className="mm-feedback">
                    {guess ? Array.from({ length: CODE_LEN }, (_, i) => {
                      const isBlack = i < guess.result.black;
                      const isWhite = !isBlack && i < guess.result.black + guess.result.white;
                      return <div key={i} className={`mm-fb-dot${isBlack ? " black" : isWhite ? " white" : ""}`} />;
                    }) : Array.from({ length: CODE_LEN }, (_, i) => (
                      <div key={i} className="mm-fb-dot" />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {canGuess && (
            <div>
              <div className="mm-color-picker">
                {COLORS.map((col, idx) => (
                  <button
                    key={idx}
                    className={`mm-color-btn${currentGuess[selectedSlot] === idx ? " selected" : ""}`}
                    onClick={() => handleGuessColorClick(idx)}
                  >
                    {col}
                  </button>
                ))}
              </div>
              <button
                className="btn-primary"
                onClick={handleSubmitGuess}
                disabled={currentGuess.some(c => c === null)}
                style={{ marginTop: "0.5rem" }}
              >
                {t.guess}
              </button>
            </div>
          )}

          {game.winner && (
            <div style={{ marginTop: "0.75rem" }}>
              <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.9rem" }}>
                {guesses[guesses.length - 1]?.result.black === CODE_LEN ? t.codeFound : t.codeNotFound}
              </p>
              {game.secretCode && (
                <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginTop: "0.4rem" }}>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem" }}>Code: </span>
                  {(Array.isArray(game.secretCode) ? game.secretCode : Object.values(game.secretCode)).map((c, i) => (
                    <span key={i} style={{ fontSize: "1.3rem" }}>{COLORS[c]}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button className="btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "0.75rem" }}>
        {t.gameSelection}
      </button>

      {showOverlay && overlayResult && (
        <GameResultOverlay
          result={overlayResult}
          winnerName={game.winner === "X" ? nameX : nameO}
          onClose={() => setShowOverlay(false)}
        >
          <button className="btn-primary" onClick={() => { setShowOverlay(false); isComputer ? resetComputer() : resetOnline(); }}>{t.rematch}</button>
          {!isComputer && <button className="btn-primary" onClick={() => { setShowOverlay(false); handleStart(); }}>{t.newGame}</button>}
          <button className="btn-secondary" onClick={() => setShowOverlay(false)}>✕</button>
        </GameResultOverlay>
      )}

      {showRules && <RulesModal gameKey="mastermind" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default Mastermind;
