import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay } from "./GameOverlay";

const EMOJIS = ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼"];
const CARD_COUNT = 16;

function shuffleCards() {
  const deck = [...EMOJIS, ...EMOJIS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function normalizeArray(raw, len, def = null) {
  return Array.from({ length: len }, (_, i) => raw ? (raw[i] ?? def) : def);
}

// ── Component ──────────────────────────────────────────────────────────────

function MemoryMatch() {
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
  const [isFlipping, setIsFlipping] = useState(false);
  // AI memory: track seen cards (index -> emoji)
  const aiMemory = useRef({});

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  function makeInitGame(cards) {
    return {
      id: "local",
      cards: cards || shuffleCards(),
      flipped: [],
      matched: [],
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

  // AI turn
  useEffect(() => {
    if (!isComputer || !game || game.winner || game.turn !== "O" || isFlipping) return;
    if (game.flipped.length !== 0) return; // wait for clean state
    const cards = game.cards;
    const matched = game.matched;
    const unmatched = cards.map((_, i) => i).filter(i => !matched.includes(i));
    if (unmatched.length === 0) return;

    // AI picks first card
    const timer = setTimeout(() => {
      // Try to find a known pair
      let first = -1, second = -1;
      const knownEmojis = {};
      for (const [idx, emoji] of Object.entries(aiMemory.current)) {
        if (matched.includes(Number(idx))) continue;
        if (!knownEmojis[emoji]) knownEmojis[emoji] = [];
        knownEmojis[emoji].push(Number(idx));
      }
      for (const [, indices] of Object.entries(knownEmojis)) {
        if (indices.length >= 2) { first = indices[0]; second = indices[1]; break; }
      }
      if (first === -1) {
        // Pick random unmatched card
        const unknown = unmatched.filter(i => !(i in aiMemory.current));
        first = unknown.length > 0
          ? unknown[Math.floor(Math.random() * unknown.length)]
          : unmatched[Math.floor(Math.random() * unmatched.length)];
        aiMemory.current[first] = cards[first];
        // Try to find matching card in memory
        const matchIdx = Object.entries(aiMemory.current)
          .filter(([idx, em]) => em === cards[first] && Number(idx) !== first && !matched.includes(Number(idx)));
        if (matchIdx.length > 0) {
          second = Number(matchIdx[0][0]);
        } else {
          const unknown2 = unmatched.filter(i => i !== first && !(i in aiMemory.current));
          second = unknown2.length > 0
            ? unknown2[Math.floor(Math.random() * unknown2.length)]
            : unmatched.filter(i => i !== first)[Math.floor(Math.random() * (unmatched.length - 1))];
          aiMemory.current[second] = cards[second];
        }
      }

      // Flip first card
      setGame(prev => ({ ...prev, flipped: [first] }));

      setTimeout(() => {
        // Flip second card
        setGame(prev => {
          const newFlipped = [first, second];
          const isMatch = cards[first] === cards[second];
          if (isMatch) {
            const newMatched = [...prev.matched, first, second];
            const allDone = newMatched.length === CARD_COUNT;
            let winner = null;
            if (allDone) {
              const xScore = (prev.score_x || 0);
              const oScore = (prev.score_o || 0) + 1;
              winner = xScore > oScore ? "X" : oScore > xScore ? "O" : "Draw";
              return { ...prev, flipped: [], matched: newMatched, turn: "O", score_x: xScore, score_o: oScore, winner };
            }
            return { ...prev, flipped: [], matched: newMatched, turn: "O", score_o: (prev.score_o || 0) + 1 };
          } else {
            return { ...prev, flipped: newFlipped };
          }
        });

        if (cards[first] !== cards[second]) {
          // Not a match: flip back after delay
          setTimeout(() => {
            setGame(prev => ({ ...prev, flipped: [], turn: "X" }));
          }, 1000);
        }
      }, 600);
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComputer, game?.turn, game?.winner, isFlipping]);

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `memory/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.val();
      setGame({
        ...data,
        cards: normalizeArray(data.cards, CARD_COUNT, ""),
        flipped: data.flipped ? Object.values(data.flipped) : [],
        matched: data.matched ? Object.values(data.matched) : [],
        id: gameIdFromUrl,
      });
      if (data.player_x === playerId) {
        setPlayerSymbol("X"); onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, { player_o: playerId, player_o_name: playerName });
        setPlayerSymbol("O");
        onDisconnect(ref(db, `memory/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `memory/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setGame({
          ...data,
          cards: normalizeArray(data.cards, CARD_COUNT, ""),
          flipped: data.flipped ? Object.values(data.flipped) : [],
          matched: data.matched ? Object.values(data.matched) : [],
          id: gameIdFromUrl,
        });
      }
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const createOnlineGame = async () => {
    const cards = shuffleCards();
    const gRef = ref(db, "memory");
    const newRef = push(gRef);
    await set(newRef, {
      cards, flipped: [], matched: [],
      turn: "X", score_x: 0, score_o: 0,
      player_x: playerId, player_x_name: playerName,
      player_o: null, player_o_name: null, winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) {
      aiMemory.current = {};
      setGame(makeInitGame());
      setShowOverlay(false);
      return;
    }
    const id = await createOnlineGame();
    navigate(`/memory?gameId=${id}&mode=online`);
  };

  const handleCardClick = async (index) => {
    if (!game || game.winner || isFlipping) return;
    if (game.matched.includes(index) || game.flipped.includes(index)) return;

    if (isComputer) {
      if (game.turn !== "X") return;
      if (game.flipped.length >= 2) return;
      aiMemory.current[index] = game.cards[index];
      const newFlipped = [...game.flipped, index];
      if (newFlipped.length === 1) {
        setGame(prev => ({ ...prev, flipped: newFlipped }));
        return;
      }
      // Two cards flipped
      const [first, second] = newFlipped;
      const isMatch = game.cards[first] === game.cards[second];
      if (isMatch) {
        const newMatched = [...game.matched, first, second];
        const allDone = newMatched.length === CARD_COUNT;
        const newScoreX = (game.score_x || 0) + 1;
        if (allDone) {
          const xS = newScoreX, oS = game.score_o || 0;
          const winner = xS > oS ? "X" : oS > xS ? "O" : "Draw";
          setGame(prev => ({ ...prev, flipped: [], matched: newMatched, score_x: newScoreX, winner }));
        } else {
          setGame(prev => ({ ...prev, flipped: [], matched: newMatched, score_x: newScoreX, turn: "X" }));
        }
      } else {
        setGame(prev => ({ ...prev, flipped: newFlipped }));
        setIsFlipping(true);
        setTimeout(() => {
          setGame(prev => ({ ...prev, flipped: [], turn: "O" }));
          setIsFlipping(false);
        }, 1000);
      }
    } else {
      if (game.turn !== playerSymbol || playerSymbol === "Spectator") return;
      if (game.flipped.length >= 2) return;
      const gameRef = ref(db, `memory/${game.id}`);
      const snap = await get(gameRef);
      const fd = snap.val();
      if (fd.turn !== playerSymbol || fd.winner) return;
      const currentFlipped = fd.flipped ? Object.values(fd.flipped) : [];
      if (currentFlipped.includes(index) || (fd.matched ? Object.values(fd.matched) : []).includes(index)) return;
      const newFlipped = [...currentFlipped, index];

      if (newFlipped.length === 1) {
        await update(gameRef, { flipped: newFlipped });
        return;
      }

      const cards = normalizeArray(fd.cards, CARD_COUNT, "");
      const [first, second] = newFlipped;
      const isMatch = cards[first] === cards[second];
      const currentMatched = fd.matched ? Object.values(fd.matched) : [];

      if (isMatch) {
        const newMatched = [...currentMatched, first, second];
        const allDone = newMatched.length === CARD_COUNT;
        const scoreKey = playerSymbol === "X" ? "score_x" : "score_o";
        const newScore = (fd[scoreKey] || 0) + 1;
        if (allDone) {
          const xS = playerSymbol === "X" ? newScore : (fd.score_x || 0);
          const oS = playerSymbol === "O" ? newScore : (fd.score_o || 0);
          const winner = xS > oS ? "X" : oS > xS ? "O" : "Draw";
          await update(gameRef, { flipped: [], matched: newMatched, [scoreKey]: newScore, winner });
        } else {
          await update(gameRef, { flipped: [], matched: newMatched, [scoreKey]: newScore });
        }
      } else {
        await update(gameRef, { flipped: newFlipped });
        setIsFlipping(true);
        setTimeout(async () => {
          const nextSym = playerSymbol === "X" ? "O" : "X";
          await update(gameRef, { flipped: [], turn: nextSym });
          setIsFlipping(false);
        }, 1000);
      }
    }
  };

  const resetComputer = () => { aiMemory.current = {}; setGame(makeInitGame()); setShowOverlay(false); };
  const resetOnline = async () => {
    if (!game) return;
    const cards = shuffleCards();
    await update(ref(db, `memory/${game.id}`), { cards, flipped: [], matched: [], turn: "X", score_x: 0, score_o: 0, winner: null });
  };
  const copyLink = (link) => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // ── Render ─────────────────────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/memory?gameId=${game?.id}&mode=online`;

  const topBar = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", maxWidth: "500px", padding: "0.5rem 1rem 0" }}>
      <button className="btn-icon" onClick={() => setShowRules(true)}>📖 {t.rules}</button>
    </div>
  );

  if (!gameIdFromUrl && !isComputer) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "2rem 1rem" }}>
        {topBar}
        <h1 className="game-title">🃏 {t.memoryMatch}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>{playerName}</p>
        <button className="btn-primary" onClick={handleStart}>{t.startGame}</button>
        {showRules && <RulesModal gameKey="memory" onClose={() => setShowRules(false)} />}
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem", color: "rgba(255,255,255,0.5)" }}>{t.loading}</div>;

  const overlayResult = !game.winner ? null
    : game.winner === "Draw" ? "draw"
    : game.winner === effectiveSym ? "win" : "loss";

  const myTurn = isComputer ? game.turn === "X" : game.turn === effectiveSym;
  const statusClass = game.winner === "Draw" ? "status-draw" : game.winner ? "status-win" : myTurn ? "status-turn" : "status-wait";
  const xScore = game.score_x || 0;
  const oScore = game.score_o || 0;
  const statusText = game.winner === "Draw"
    ? `🤝 ${t.draw}`
    : game.winner
    ? `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : myTurn ? t.yourTurn
    : `⏳ ${game.turn === "X" ? nameX : nameO}...`;

  const matched = game.matched || [];
  const flipped = game.flipped || [];

  return (
    <div className="fade-in" style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}>
      {topBar}
      <h1 className="game-title">🃏 {t.memoryMatch}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">🃏 {nameX} ({xScore} {t.pairs})</span>
        <span>{t.vs}</span>
        <span className="player-o">🃏 {nameO} ({oScore} {t.pairs})</span>
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

      <div className="memory-grid">
        {(game.cards || []).map((emoji, index) => {
          const isMatched = matched.includes(index);
          const isFlippedCard = flipped.includes(index);
          const show = isMatched || isFlippedCard;
          // Determine who matched this card
          return (
            <div
              key={index}
              className={`memory-card${show ? " flipped" : ""}${isMatched ? " matched" : ""}`}
              onClick={() => !show && myTurn && !game.winner && handleCardClick(index)}
            >
              {show ? emoji : "❓"}
            </div>
          );
        })}
      </div>

      <button className="btn-secondary" onClick={() => navigate("/")} style={{ marginTop: "0.5rem" }}>
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

      {showRules && <RulesModal gameKey="memory" onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default MemoryMatch;
