import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const INIT_PILES = [3, 5, 7];

function nimAI(piles) {
  // Misère Nim: player who takes the LAST stone loses
  if (piles.every(p => p <= 1)) {
    for (let i = 0; i < piles.length; i++) {
      if (piles[i] > 0) {
        const newPiles = [...piles]; newPiles[i]--;
        const ones = newPiles.filter(p => p === 1).length;
        if (ones % 2 === 1) return { pile: i, amount: 1 };
      }
    }
    // fallback: take from first nonzero
    for (let i = 0; i < piles.length; i++) {
      if (piles[i] > 0) return { pile: i, amount: 1 };
    }
  }
  const nimSum = piles.reduce((a, b) => a ^ b, 0);
  if (nimSum !== 0) {
    for (let i = 0; i < piles.length; i++) {
      const target = piles[i] ^ nimSum;
      if (target < piles[i]) return { pile: i, amount: piles[i] - target };
    }
  }
  // Losing position: take 1 from largest pile
  const maxIdx = piles.indexOf(Math.max(...piles));
  return { pile: maxIdx, amount: 1 };
}

function isGameOver(piles) {
  return piles.every(p => p === 0);
}

function normalizeArray(raw, len, def = 0) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function Nim() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");
  const [aiThinking, setAiThinking] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  // Selection state: { pile: number, amount: number } or null
  const [selection, setSelection] = useState(null);

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  function makeInitGame() {
    return {
      id: "local",
      piles: [...INIT_PILES],
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer]);

  useEffect(() => {
    if (!game?.winner) { setShowOverlay(false); return; }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  // AI move trigger
  useEffect(() => {
    if (!isComputer || !game || game.winner || game.turn !== "O" || aiThinking) return;
    setAiThinking(true);
    const piles = game.piles;
    const timer = setTimeout(() => {
      const { pile, amount } = nimAI(piles);
      const newPiles = [...piles];
      newPiles[pile] -= amount;
      const done = isGameOver(newPiles);
      // Player who takes the last stone loses
      const winner = done ? "X" : null; // O took last stone, so X wins
      setGame(prev => ({ ...prev, piles: newPiles, turn: done ? null : "X", winner }));
      setAiThinking(false);
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer, game?.turn, game?.winner, aiThinking]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `nim/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({ ...data, piles: normalizeArray(data.piles, 3), id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `nim/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `nim/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame({ ...data, piles: normalizeArray(data.piles, 3), id: gameIdFromUrl });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const gRef = ref(db, "nim");
    const newRef = push(gRef);
    await set(newRef, {
      piles: [...INIT_PILES], turn: "X",
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null, winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setGame(makeInitGame()); setSelection(null); setShowOverlay(false); return; }
    const id = await createOnlineGame();
    navigate(`/nim?gameId=${id}&mode=online`);
  };

  // Click a stone: select pile=pileIdx, amount = stones from clicked to top
  const handleStoneClick = (pileIdx, stoneIdx) => {
    if (!game || game.winner || aiThinking) return;
    const myTurnCheck = isComputer ? game.turn === "X" : game.turn === playerSymbol;
    if (!myTurnCheck || playerSymbol === "Spectator") return;
    // stoneIdx is 0-based from top; amount = stoneIdx+1 to take from top
    // We render stones from top to bottom; stoneIdx=0 means topmost
    // amount = pile size - stoneIdx (take from stoneIdx to bottom)
    const amount = game.piles[pileIdx] - stoneIdx;
    if (selection && selection.pile === pileIdx && selection.amount === amount) {
      setSelection(null);
    } else {
      setSelection({ pile: pileIdx, amount });
    }
  };

  const handleTake = async () => {
    if (!selection || !game || game.winner || aiThinking) return;
    const myTurnCheck = isComputer ? game.turn === "X" : game.turn === playerSymbol;
    if (!myTurnCheck) return;
    const { pile, amount } = selection;
    if (amount <= 0 || amount > game.piles[pile]) return;

    if (isComputer) {
      const newPiles = [...game.piles];
      newPiles[pile] -= amount;
      const done = isGameOver(newPiles);
        setGame(prev => ({ ...prev, piles: newPiles, turn: done ? null : "O", winner: done ? "O" : null }));
      setSelection(null);
    } else {
      if (game.turn !== playerSymbol || playerSymbol === "Spectator") return;
      const gameRef = ref(db, `nim/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.turn !== playerSymbol || fd.winner) return;
      const newPiles = normalizeArray(fd.piles, 3);
      newPiles[pile] -= amount;
      const done = isGameOver(newPiles);
      const nextSym = playerSymbol === "X" ? "O" : "X";
      // If done: current player took last stone => current player loses => other player wins
      const winner = done ? nextSym : null;
      await update(gameRef, { piles: newPiles, turn: done ? null : nextSym, winner });
      setSelection(null);
    }
  };

  const resetComputer = () => { setGame(makeInitGame()); setSelection(null); setShowOverlay(false); };
  const resetOnline = async () => {
    if (!game) return;
    await update(ref(db, `nim/${game.id}`), { piles: [...INIT_PILES], turn: "X", winner: null });
    setSelection(null);
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/nim?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "600px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">🪵 {t.nim}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="nim" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSym ? "win" : "loss";

  const myTurn = isComputer ? game.turn === "X" : game.turn === effectiveSym;
  const statusClass = game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const statusText = game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : aiThinking ? "🤔 ..."
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">🪵 {t.nim}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">⬜ {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">⬜ {nameO}</span>
        {!isComputer && <span>— {t.playAs}: <strong>{effectiveSym}</strong></span>}
      </div>

      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", margin: "0.4rem 0 0.75rem" }}>{t.lastStoneLoses}</p>

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

      <div className="nim-piles">
        {(game.piles || INIT_PILES).map((count, pileIdx) => {
          const selAmt = selection && selection.pile === pileIdx ? selection.amount : 0;
          return (
            <div key={pileIdx} className="nim-pile">
              <div className="nim-pile-label">{t.pile} {pileIdx + 1}</div>
              <div className="nim-stones">
                {Array.from({ length: count }, (_, stoneIdx) => {
                  // stoneIdx 0 = top of pile visually
                  // selected = stoneIdx >= (count - selAmt)
                  const isSelected = selAmt > 0 && stoneIdx >= count - selAmt;
                  const isDisabled = !myTurn || !!game.winner || aiThinking;
                  return (
                    <div
                      key={stoneIdx}
                      className={`nim-stone${isSelected ? " selected" : ""}${isDisabled ? " disabled" : ""}`}
                      onClick={() => !isDisabled && handleStoneClick(pileIdx, count - selAmt > 0 ? stoneIdx : stoneIdx)}
                      title={`${t.pile} ${pileIdx + 1}: ${count - stoneIdx} ${t.takeStones}`}
                    />
                  );
                })}
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", marginTop: "0.3rem" }}>
                {count} {t.stonesLeft}
              </div>
              {myTurn && !game.winner && !aiThinking && count > 0 && (
                <div style={{ display: "flex", gap: "4px", marginTop: "0.4rem", flexWrap: "wrap", justifyContent: "center" }}>
                  {Array.from({ length: count }, (_, i) => i + 1).map(amt => (
                    <button
                      key={amt}
                      className={`nim-take-btn btn-icon${selection && selection.pile === pileIdx && selection.amount === amt ? " btn-primary" : ""}`}
                      style={{ minWidth: "28px", padding: "2px 6px", fontSize: "0.75rem" }}
                      onClick={() => setSelection(prev => prev && prev.pile === pileIdx && prev.amount === amt ? null : { pile: pileIdx, amount: amt })}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {myTurn && !game.winner && !aiThinking && selection && (
        <button className="btn-primary" style={{ marginTop: "0.75rem" }} onClick={handleTake}>
          {t.takeStones}: {selection.amount} ({t.pile} {selection.pile + 1})
        </button>
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

      {showRules && <RulesModal gameKey="nim" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default Nim;
