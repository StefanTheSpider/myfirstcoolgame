import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import { ref, set, update, get, onValue, push, onDisconnect } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";

const GRID = 10;
const SHIP_DEFS = (t) => [
  { size: 5, name: t.carrier },
  { size: 4, name: t.battleshipShip },
  { size: 3, name: t.cruiser },
  { size: 3, name: t.submarine },
  { size: 2, name: t.destroyer },
];

function getShipCells(startIndex, size, horizontal) {
  const row = Math.floor(startIndex / GRID);
  const col = startIndex % GRID;
  const cells = [];
  for (let i = 0; i < size; i++) {
    if (horizontal) {
      if (col + i >= GRID) return null;
      cells.push(row * GRID + col + i);
    } else {
      if (row + i >= GRID) return null;
      cells.push((row + i) * GRID + col);
    }
  }
  return cells;
}

function hasOverlap(cells, placedShips) {
  const occupied = new Set(placedShips.flat());
  return cells.some((c) => occupied.has(c));
}

function placeShipsRandomly() {
  const occupied = new Set();
  const ships = [];
  for (const { size } of [{ size: 5 }, { size: 4 }, { size: 3 }, { size: 3 }, { size: 2 }]) {
    let placed = false, attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      const horiz = Math.random() > 0.5;
      const row = Math.floor(Math.random() * (horiz ? GRID : GRID - size + 1));
      const col = Math.floor(Math.random() * (horiz ? GRID - size + 1 : GRID));
      const cells = [];
      for (let i = 0; i < size; i++)
        cells.push(horiz ? row * GRID + col + i : (row + i) * GRID + col);
      if (cells.every(c => !occupied.has(c))) {
        cells.forEach(c => occupied.add(c));
        ships.push(cells);
        placed = true;
      }
    }
  }
  return ships;
}

// AI: Hunt/Target strategy
function getAiShot(shots, enemyShips) {
  const allShipCells = enemyShips.flat();
  const hits = shots.filter(s => allShipCells.includes(s));
  const remaining = Array.from({ length: GRID * GRID }, (_, i) => i).filter(i => !shots.includes(i));

  // Find hits that haven't sunk a ship yet
  const unsunkHits = hits.filter(h => {
    const ship = enemyShips.find(s => s.includes(h));
    return ship && !ship.every(c => shots.includes(c));
  });

  if (unsunkHits.length > 0) {
    // Target mode: try adjacent cells of last hit
    const lastHit = unsunkHits[unsunkHits.length - 1];
    const row = Math.floor(lastHit / GRID), col = lastHit % GRID;
    // Determine direction if multiple hits
    let candidates = [];
    if (unsunkHits.length > 1) {
      const prev = unsunkHits[unsunkHits.length - 2];
      const dr = Math.floor(lastHit / GRID) - Math.floor(prev / GRID);
      const dc = (lastHit % GRID) - (prev % GRID);
      // Continue in same direction
      const next = lastHit + dr * GRID + dc;
      const back = unsunkHits[0] - dr * GRID - dc;
      if (next >= 0 && next < GRID * GRID && Math.floor(next / GRID) === row + dr && (next % GRID) === col + dc && !shots.includes(next)) candidates.push(next);
      if (back >= 0 && back < GRID * GRID && !shots.includes(back)) candidates.push(back);
    }
    if (candidates.length === 0) {
      const adj = [lastHit - 1, lastHit + 1, lastHit - GRID, lastHit + GRID].filter(n =>
        n >= 0 && n < GRID * GRID &&
        !shots.includes(n) &&
        (n === lastHit - 1 ? col > 0 : n === lastHit + 1 ? col < GRID - 1 : true)
      );
      candidates = adj;
    }
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Hunt mode: checkerboard pattern
  const checkerboard = remaining.filter(i => (Math.floor(i / GRID) + i % GRID) % 2 === 0);
  const pool = checkerboard.length > 0 ? checkerboard : remaining;
  return pool[Math.floor(Math.random() * pool.length)];
}

function normalizeShots(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw).map(Number);
}

function normalizeShips(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw).map((ship) =>
    Array.isArray(ship) ? ship : Object.values(ship).map(Number)
  );
}

// ── Placement UI ──────────────────────────────────────────────────────────

function PlacementGrid({ placedShips, shipDefs, onPlace, onReset }) {
  const { t } = useLanguage();
  const [horizontal, setHorizontal] = useState(true);
  const [hoverCells, setHoverCells] = useState([]);
  const [hoverValid, setHoverValid] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);

  const placedCells = new Set(placedShips.flat());
  const done = currentIdx >= shipDefs.length;
  const current = shipDefs[currentIdx];

  const handleMouseEnter = (index) => {
    if (done) return;
    const cells = getShipCells(index, current.size, horizontal);
    if (!cells) { setHoverCells([]); return; }
    setHoverCells(cells);
    setHoverValid(!hasOverlap(cells, placedShips));
  };

  const handleClick = (index) => {
    if (done) return;
    const cells = getShipCells(index, current.size, horizontal);
    if (!cells || hasOverlap(cells, placedShips)) return;
    onPlace(cells);
    setCurrentIdx(i => i + 1);
    setHoverCells([]);
  };

  const handleReset = () => {
    setCurrentIdx(0);
    setHoverCells([]);
    onReset();
  };

  return (
    <div>
      <div style={{ marginBottom: "0.75rem" }}>
        {!done ? (
          <>
            <strong>{t.placingShip} {current.name} ({current.size} {t.fields})</strong>
            <br />
            <button className="secondary-btn" onClick={() => { setHorizontal(h => !h); setHoverCells([]); }} style={{ marginTop: "0.4rem" }}>
              {horizontal ? t.horizontal : t.vertical}
            </button>
          </>
        ) : (
          <strong style={{ color: "#27ae60" }}>{t.allPlaced}</strong>
        )}
      </div>

      <div className="bs-grid" onMouseLeave={() => setHoverCells([])}>
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const isPlaced = placedCells.has(i);
          const isHover = hoverCells.includes(i);
          let bg = "#d6eaf8";
          if (isPlaced) bg = "#7f8c8d";
          if (isHover) bg = hoverValid ? "#2ecc71" : "#e74c3c";
          return (
            <div key={i} className="bs-cell"
              onMouseEnter={() => handleMouseEnter(i)}
              onClick={() => handleClick(i)}
              style={{ background: bg, cursor: done ? "default" : "pointer" }}
            />
          );
        })}
      </div>

      <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {shipDefs.map((s, idx) => (
          <span key={idx} style={{
            fontSize: "0.8rem",
            textDecoration: idx < currentIdx ? "line-through" : "none",
            color: idx < currentIdx ? "#27ae60" : idx === currentIdx ? "#2980b9" : "#aaa",
          }}>
            {s.name}({s.size})
          </span>
        ))}
      </div>

      <button className="secondary-btn" onClick={handleReset} style={{ marginTop: "0.5rem" }}>
        {t.resetPlacement}
      </button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

function Battleship() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName] = useState(() => localStorage.getItem("playerName") || "");
  const [placedShips, setPlacedShips] = useState([]);
  const [phase, setPhase] = useState("place"); // place | play

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) { s = uuidv4(); localStorage.setItem("playerId", s); }
    return s;
  });

  const SHIPS = SHIP_DEFS(t);

  // ── Computer mode ──────────────────────────────────────────────────────

  const initComputerGame = (myShips) => {
    const aiShips = placeShipsRandomly();
    return {
      id: "local",
      player_x: playerId, player_x_name: playerName,
      player_x_ships: myShips, player_x_shots: [],
      player_o: "computer", player_o_name: t.computer,
      player_o_ships: aiShips, player_o_shots: [],
      turn: "X", winner: null,
    };
  };

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setPhase("place");
    setPlacedShips([]);
    setGame(null);
  }, [isComputer]);

  const handleConfirmComputerPlacement = () => {
    if (placedShips.length !== SHIPS.length) return;
    const g = initComputerGame(placedShips);
    setGame(g);
    setPhase("play");
  };

  const doAiShot = (currentGame) => {
    setTimeout(() => {
      const shots = normalizeShots(currentGame.player_o_shots);
      const myShips = normalizeShips(currentGame.player_x_ships);
      const shot = getAiShot(shots, myShips);
      const newShots = [...shots, shot];
      const allSunk = myShips.flat().every(c => newShots.includes(c));
      setGame(prev => ({
        ...prev,
        player_o_shots: newShots,
        turn: allSunk ? null : "X",
        winner: allSunk ? "O" : null,
      }));
    }, 600);
  };

  const handleComputerShot = (index) => {
    if (!game || game.winner || game.turn !== "X") return;
    const shots = normalizeShots(game.player_x_shots);
    if (shots.includes(index)) return;
    const opponentShips = normalizeShips(game.player_o_ships);
    const newShots = [...shots, index];
    const allSunk = opponentShips.flat().every(c => newShots.includes(c));
    const newGame = {
      ...game,
      player_x_shots: newShots,
      turn: allSunk ? null : "O",
      winner: allSunk ? "X" : null,
    };
    setGame(newGame);
    if (!allSunk) doAiShot(newGame);
  };

  // ── Online mode ────────────────────────────────────────────────────────

  const createOnlineGame = async () => {
    const gRef = ref(db, "battleship");
    const newRef = push(gRef);
    await set(newRef, {
      player_x: playerId, player_x_name: playerName,
      player_x_ships: null, player_x_shots: [],
      player_o: null, player_o_name: null,
      player_o_ships: null, player_o_shots: [],
      turn: "X", winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) { setPlacedShips([]); setGame(null); setPhase("place"); return; }
    const id = await createOnlineGame();
    navigate(`/battleship?gameId=${id}&mode=online`);
  };

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `battleship/${gameIdFromUrl}`);
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
        onDisconnect(ref(db, `battleship/${gameIdFromUrl}/player_o`)).set(null);
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
    const gameRef = ref(db, `battleship/${gameIdFromUrl}`);
    const unsub = onValue(gameRef, (snap) => {
      if (snap.exists()) setGame({ ...snap.val(), id: gameIdFromUrl });
    });
    return () => unsub();
  }, [gameIdFromUrl, isComputer]);

  const handleConfirmOnlinePlacement = async () => {
    if (placedShips.length !== SHIPS.length) return;
    const gameRef = ref(db, `battleship/${game.id}`);
    const field = playerSymbol === "X" ? "player_x_ships" : "player_o_ships";
    await update(gameRef, { [field]: placedShips });
    setPhase("play");
  };

  const handleOnlineShot = async (index) => {
    if (!game || game.winner || game.turn !== playerSymbol || playerSymbol === "Spectator") return;
    const gameRef = ref(db, `battleship/${game.id}`);
    const snap = await get(gameRef);
    const fd = snap.val();
    if (fd.turn !== playerSymbol || fd.winner) return;
    const myShots = normalizeShots(playerSymbol === "X" ? fd.player_x_shots : fd.player_o_shots);
    if (myShots.includes(index)) return;
    const opponentShips = normalizeShips(playerSymbol === "X" ? fd.player_o_ships : fd.player_x_ships);
    const newShots = [...myShots, index];
    const allSunk = opponentShips.flat().every(c => newShots.includes(c));
    const updates = { turn: playerSymbol === "X" ? "O" : "X" };
    if (playerSymbol === "X") updates.player_x_shots = newShots;
    else updates.player_o_shots = newShots;
    if (allSunk) { updates.winner = playerSymbol; updates.turn = null; }
    await update(gameRef, updates);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/battleship?gameId=${game?.id}&mode=online`;
  const effectiveSym = isComputer ? "X" : playerSymbol;

  const myShips = normalizeShips(effectiveSym === "X" ? game?.player_x_ships : game?.player_o_ships);
  const opponentShips = normalizeShips(effectiveSym === "X" ? game?.player_o_ships : game?.player_x_ships);
  const myShots = normalizeShots(effectiveSym === "X" ? game?.player_x_shots : game?.player_o_shots);
  const opponentShots = normalizeShots(effectiveSym === "X" ? game?.player_o_shots : game?.player_x_shots);

  const myShipCells = new Set(myShips.flat());
  const opponentShipCells = new Set(opponentShips.flat());
  const incomingHits = new Set(opponentShots.filter(s => myShipCells.has(s)));
  const incomingMisses = new Set(opponentShots.filter(s => !myShipCells.has(s)));
  const shotHits = new Set(myShots.filter(s => opponentShipCells.has(s)));
  const shotMisses = new Set(myShots.filter(s => !opponentShipCells.has(s)));

  const iHavePlaced = isComputer ? phase === "play" : myShips.length === SHIPS.length;
  const opponentHasPlaced = isComputer ? true : opponentShips.length === SHIPS.length;
  const bothPlaced = iHavePlaced && opponentHasPlaced;

  // No game yet
  if (!gameIdFromUrl && !isComputer) {
    return (
      <div style={{ textAlign: "center", marginTop: "4rem", padding: "0 1rem" }}>
        <h1>🚢 {t.battleship}</h1>
        <p>{playerName}</p>
        <button className="primary-btn" onClick={handleStart}>{t.createGame}</button>
        <br /><br />
        <button className="secondary-btn" onClick={() => navigate("/")}>{t.back}</button>
      </div>
    );
  }

  // Placement phase
  if ((isComputer && phase === "place") || (!isComputer && game && !iHavePlaced && effectiveSym !== "Spectator")) {
    return (
      <div style={{ textAlign: "center", padding: "1rem" }}>
        <h1>🚢 {t.battleship}</h1>
        <h2>{t.placeFleet}</h2>
        <PlacementGrid
          placedShips={placedShips}
          shipDefs={SHIPS}
          onPlace={(cells) => setPlacedShips(prev => [...prev, cells])}
          onReset={() => setPlacedShips([])}
        />
        {placedShips.length === SHIPS.length && (
          <button
            className="primary-btn"
            onClick={isComputer ? handleConfirmComputerPlacement : handleConfirmOnlinePlacement}
            style={{ marginTop: "1rem" }}
          >
            {t.confirmFleet}
          </button>
        )}
        <br />
        <button className="secondary-btn" onClick={() => navigate("/")} style={{ marginTop: "0.75rem" }}>
          {t.gameSelection}
        </button>
      </div>
    );
  }

  // Invite / waiting for opponent
  if (!isComputer && effectiveSym === "X" && game && !game.player_o) {
    return (
      <div style={{ textAlign: "center", marginTop: "3rem", padding: "0 1rem" }}>
        <h1>🚢 {t.battleship}</h1>
        <p>{t.inviteFriend}</p>
        <input readOnly value={inviteLink}
          style={{ width: "80%", maxWidth: "350px", padding: "0.4rem", fontSize: "0.85rem" }}
          onClick={(e) => e.target.select()} />
        <button onClick={() => navigator.clipboard.writeText(inviteLink)} style={{ marginLeft: "0.5rem" }}>
          {t.copyLink}
        </button>
        <p style={{ color: "#888", marginTop: "1rem" }}>{t.waitingOpponent}</p>
        <button className="secondary-btn" onClick={() => navigate("/")}>{t.gameSelection}</button>
      </div>
    );
  }

  // Waiting for both to place
  if (!isComputer && !bothPlaced && effectiveSym !== "Spectator") {
    return (
      <div style={{ textAlign: "center", marginTop: "3rem", padding: "0 1rem" }}>
        <h1>🚢 {t.battleship}</h1>
        <h2 style={{ color: "#27ae60" }}>{t.allPlaced}</h2>
        <p style={{ color: "#888" }}>{t.waitingEnemy}</p>
        <button className="secondary-btn" onClick={() => navigate("/")}>{t.gameSelection}</button>
      </div>
    );
  }

  if (!game) return <div style={{ textAlign: "center", marginTop: "4rem" }}>{t.loading}</div>;

  const canShoot = !game.winner && game.turn === (isComputer ? "X" : effectiveSym);
  const statusText = game.winner
    ? game.winner === (isComputer ? "X" : effectiveSym) ? `🏆 ${t.youWin}` : `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : canShoot ? t.fireNow
    : `⏳ ${game.turn === "X" ? nameX : nameO} ${t.enemyShooting}`;

  return (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <h1>🚢 {t.battleship}</h1>
      <h2 style={{ minHeight: "2rem" }}>{statusText}</h2>

      <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {/* My grid */}
        <div>
          <h3>{t.yourFleet}</h3>
          <div className="bs-grid">
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const isShip = myShipCells.has(i);
              const isHit = incomingHits.has(i);
              const isMiss = incomingMisses.has(i);
              let bg = "#d6eaf8";
              if (isShip) bg = "#7f8c8d";
              if (isHit) bg = "#e74c3c";
              if (isMiss) bg = "#85c1e9";
              return <div key={i} className="bs-cell" style={{ background: bg }} />;
            })}
          </div>
        </div>

        {/* Opponent grid */}
        <div>
          <h3>{t.enemyField}</h3>
          <div className="bs-grid">
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const isHit = shotHits.has(i);
              const isMiss = shotMisses.has(i);
              const canFire = canShoot && !isHit && !isMiss;
              let bg = "#d6eaf8";
              if (isHit) bg = "#e74c3c";
              if (isMiss) bg = "#85c1e9";
              return (
                <div key={i} className="bs-cell"
                  style={{ background: bg, cursor: canFire ? "crosshair" : "default" }}
                  onClick={() => canFire && (isComputer ? handleComputerShot(i) : handleOnlineShot(i))}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#555" }}>
        🔴 {t.hit} &nbsp; 🔵 {t.miss} &nbsp; ⬛ {t.myShip}
      </div>

      {game.winner && (
        <button className="primary-btn" onClick={handleStart} style={{ marginTop: "1rem", marginRight: "0.5rem" }}>
          {t.newGame}
        </button>
      )}
      <button className="secondary-btn" onClick={() => navigate("/")} style={{ marginTop: "1rem" }}>
        {t.gameSelection}
      </button>
    </div>
  );
}

export default Battleship;
