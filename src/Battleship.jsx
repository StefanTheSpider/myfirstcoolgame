import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { db } from "./firebaseClient";
import {
  ref,
  set,
  update,
  get,
  onValue,
  push,
  onDisconnect,
} from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import { useLanguage } from "./LanguageContext";
import RulesModal from "./RulesModal";
import { GameResultOverlay, TurnBanner } from "./GameOverlay";
import GameSuggestion from "./GameSuggestion";

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
  for (const { size } of [
    { size: 5 },
    { size: 4 },
    { size: 3 },
    { size: 3 },
    { size: 2 },
  ]) {
    let placed = false,
      attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      const horiz = Math.random() > 0.5;
      const row = Math.floor(Math.random() * (horiz ? GRID : GRID - size + 1));
      const col = Math.floor(Math.random() * (horiz ? GRID - size + 1 : GRID));
      const cells = [];
      for (let i = 0; i < size; i++)
        cells.push(horiz ? row * GRID + col + i : (row + i) * GRID + col);
      if (cells.every((c) => !occupied.has(c))) {
        cells.forEach((c) => occupied.add(c));
        ships.push(cells);
        placed = true;
      }
    }
  }
  return ships;
}

function getAiShot(shots, enemyShips) {
  const allShipCells = enemyShips.flat();
  const hits = shots.filter((s) => allShipCells.includes(s));
  const remaining = Array.from({ length: GRID * GRID }, (_, i) => i).filter(
    (i) => !shots.includes(i),
  );
  const unsunkHits = hits.filter((h) => {
    const ship = enemyShips.find((s) => s.includes(h));
    return ship && !ship.every((c) => shots.includes(c));
  });
  if (unsunkHits.length > 0) {
    const lastHit = unsunkHits[unsunkHits.length - 1];
    const row = Math.floor(lastHit / GRID),
      col = lastHit % GRID;
    let candidates = [];
    if (unsunkHits.length > 1) {
      const prev = unsunkHits[unsunkHits.length - 2];
      const dr = Math.floor(lastHit / GRID) - Math.floor(prev / GRID);
      const dc = (lastHit % GRID) - (prev % GRID);
      const next = lastHit + dr * GRID + dc;
      const back = unsunkHits[0] - dr * GRID - dc;
      if (
        next >= 0 &&
        next < GRID * GRID &&
        Math.floor(next / GRID) === row + dr &&
        next % GRID === col + dc &&
        !shots.includes(next)
      )
        candidates.push(next);
      if (back >= 0 && back < GRID * GRID && !shots.includes(back))
        candidates.push(back);
    }
    if (candidates.length === 0) {
      candidates = [
        lastHit - 1,
        lastHit + 1,
        lastHit - GRID,
        lastHit + GRID,
      ].filter(
        (n) =>
          n >= 0 &&
          n < GRID * GRID &&
          !shots.includes(n) &&
          (n === lastHit - 1
            ? col > 0
            : n === lastHit + 1
              ? col < GRID - 1
              : true),
      );
    }
    if (candidates.length > 0)
      return candidates[Math.floor(Math.random() * candidates.length)];
  }
  const checker = remaining.filter(
    (i) => (Math.floor(i / GRID) + (i % GRID)) % 2 === 0,
  );
  const pool = checker.length > 0 ? checker : remaining;
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
    Array.isArray(ship) ? ship : Object.values(ship).map(Number),
  );
}

// ── Placement Grid ─────────────────────────────────────────────────────────

function PlacementGrid({ placedShips, shipDefs, onPlace, onSwap, onReset }) {
  const { t } = useLanguage();
  const gridRef = useRef(null);

  // What ship are we currently placing / repositioning?
  const [pickedUpIdx, setPickedUpIdx] = useState(null);   // index in placedShips, or null
  const [horizontal, setHorizontal] = useState(true);
  const [grabOffset, setGrabOffset] = useState(0);        // which cell within the ship was grabbed
  const [previewAnchor, setPreviewAnchor] = useState(null); // top-left start cell for preview

  // Refs mirror state so pointer-event closures always see latest values
  const horizontalRef    = useRef(true);
  const grabOffsetRef    = useRef(0);
  const previewAnchorRef = useRef(null);
  const isDraggingRef    = useRef(false);
  const pickedUpIdxRef   = useRef(null);
  const downXRef         = useRef(0);   // pointer-down screen X
  const downYRef         = useRef(0);   // pointer-down screen Y
  const dirLockRef       = useRef(false); // has direction been locked this drag?
  // double-tap detection
  const lastTapRef       = useRef(0);
  const lastTapCellRef   = useRef(null);

  const currentIdx = pickedUpIdx !== null ? pickedUpIdx : placedShips.length;
  const done = pickedUpIdx === null && placedShips.length >= shipDefs.length;
  const current = done ? null : shipDefs[currentIdx];
  const allPlacedCells = new Set(placedShips.flat());

  // Sync refs
  useEffect(() => { horizontalRef.current = horizontal; }, [horizontal]);
  useEffect(() => { grabOffsetRef.current = grabOffset; }, [grabOffset]);
  useEffect(() => { previewAnchorRef.current = previewAnchor; }, [previewAnchor]);
  useEffect(() => { pickedUpIdxRef.current = pickedUpIdx; }, [pickedUpIdx]);

  // Keyboard R to rotate
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "r" || e.key === "R") {
        const next = !horizontalRef.current;
        setHorizontal(next); horizontalRef.current = next;
        setPreviewAnchor(null); previewAnchorRef.current = null;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Given pointer position, compute the ship's top-left anchor cell
  // taking the grab offset into account so the ship "sticks" to the grabbed cell
  const anchorFromPointer = (pointerCell, horiz, offset, size) => {
    if (pointerCell === null) return null;
    const row = Math.floor(pointerCell / GRID);
    const col = pointerCell % GRID;
    if (horiz) {
      const anchorCol = Math.max(0, Math.min(col - offset, GRID - size));
      return row * GRID + anchorCol;
    } else {
      const anchorRow = Math.max(0, Math.min(row - offset, GRID - size));
      return anchorRow * GRID + col;
    }
  };

  const getPreview = (anchor, horiz) => {
    if (!current || anchor === null) return { cells: [], valid: false };
    const cells = getShipCells(anchor, current.size, horiz);
    if (!cells) return { cells: [], valid: false };
    const others = placedShips.filter((_, i) => i !== pickedUpIdx);
    return { cells, valid: !hasOverlap(cells, others) };
  };

  const { cells: previewCells, valid: previewValid } = getPreview(previewAnchor, horizontal);

  // Returns cell index under a screen point (works for mouse + touch)
  const getCellAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const raw = el.dataset.cellIdx ?? el.parentElement?.dataset.cellIdx;
    if (raw === undefined) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  };

  const commitPlacement = () => {
    const anchor = previewAnchorRef.current;
    const horiz  = horizontalRef.current;
    const pIdx   = pickedUpIdxRef.current;
    if (!current || anchor === null) return;
    const cells = getShipCells(anchor, current.size, horiz);
    if (!cells) return;
    const others = placedShips.filter((_, i) => i !== pIdx);
    if (hasOverlap(cells, others)) return;
    if (pIdx !== null) {
      onSwap(pIdx, cells);
      setPickedUpIdx(null); pickedUpIdxRef.current = null;
    } else {
      onPlace(cells);
    }
    setPreviewAnchor(null); previewAnchorRef.current = null;
    isDraggingRef.current = false;
  };

  const updatePreviewFromPoint = (x, y) => {
    const pointerCell = getCellAt(x, y);
    if (pointerCell === null) return;
    const size = current?.size;
    if (!size) return;
    const anchor = anchorFromPointer(pointerCell, horizontalRef.current, grabOffsetRef.current, size);
    setPreviewAnchor(anchor);
    previewAnchorRef.current = anchor;
  };

  // ── Pointer events ─────────────────────────────────────────────────────────

  const handlePointerDown = (e, cellIdx) => {
    e.preventDefault();
    gridRef.current?.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    downXRef.current = e.clientX;
    downYRef.current = e.clientY;
    dirLockRef.current = false;

    // Double-tap on same cell → rotate
    const now = Date.now();
    if (now - lastTapRef.current < 350 && lastTapCellRef.current === cellIdx) {
      const next = !horizontalRef.current;
      setHorizontal(next); horizontalRef.current = next;
      setPreviewAnchor(null); previewAnchorRef.current = null;
      isDraggingRef.current = false;
      lastTapRef.current = 0; lastTapCellRef.current = null;
      return;
    }
    lastTapRef.current = now;
    lastTapCellRef.current = cellIdx;

    if (allPlacedCells.has(cellIdx)) {
      const shipIdx = placedShips.findIndex((cells) => cells.includes(cellIdx));
      if (shipIdx !== -1) {
        const shipCells = placedShips[shipIdx];
        const offset = shipCells.indexOf(cellIdx);
        const existingHoriz = shipCells.length < 2 || (shipCells[1] - shipCells[0] === 1);
        setHorizontal(existingHoriz); horizontalRef.current = existingHoriz;
        setGrabOffset(offset);        grabOffsetRef.current = offset;
        setPickedUpIdx(shipIdx);      pickedUpIdxRef.current = shipIdx;
        dirLockRef.current = true; // keep ship's existing orientation until moved
        const anchor = anchorFromPointer(cellIdx, existingHoriz, offset, shipDefs[shipIdx].size);
        setPreviewAnchor(anchor); previewAnchorRef.current = anchor;
        return;
      }
    }
    if (done) return;
    setGrabOffset(0); grabOffsetRef.current = 0;
    const size = current?.size ?? 1;
    const anchor = anchorFromPointer(cellIdx, horizontalRef.current, 0, size);
    setPreviewAnchor(anchor); previewAnchorRef.current = anchor;
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current && done) return;

    // Auto-detect orientation from drag direction (after 1+ cell of movement)
    if (isDraggingRef.current && !dirLockRef.current) {
      const dx = Math.abs(e.clientX - downXRef.current);
      const dy = Math.abs(e.clientY - downYRef.current);
      const threshold = 12; // px before we lock direction
      if (dx > threshold || dy > threshold) {
        const newHoriz = dx >= dy;
        if (newHoriz !== horizontalRef.current) {
          setHorizontal(newHoriz); horizontalRef.current = newHoriz;
          // reset grab offset when orientation changes mid-drag
          setGrabOffset(0); grabOffsetRef.current = 0;
        }
        dirLockRef.current = true;
      }
    }

    updatePreviewFromPoint(e.clientX, e.clientY);
  };

  const handlePointerUp = (e) => {
    if (isDraggingRef.current) {
      updatePreviewFromPoint(e.clientX, e.clientY);
      commitPlacement();
    }
    isDraggingRef.current = false;
  };

  const handlePointerLeave = () => {
    if (!isDraggingRef.current) {
      setPreviewAnchor(null); previewAnchorRef.current = null;
    }
  };

  const handleReset = () => {
    onReset();
    setPickedUpIdx(null); pickedUpIdxRef.current = null;
    setPreviewAnchor(null); previewAnchorRef.current = null;
    isDraggingRef.current = false;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>

      {/* Grid */}
      <div
        ref={gridRef}
        className="bs-grid"
        style={{ touchAction: "none", cursor: done ? "default" : "crosshair" }}
        onPointerDown={(e) => {
          const idx = getCellAt(e.clientX, e.clientY);
          if (idx !== null) handlePointerDown(e, idx);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const shipIdx = placedShips.findIndex((cells) => cells.includes(i));
          const isPickedUp = shipIdx === pickedUpIdx && pickedUpIdx !== null;
          const isPlaced = allPlacedCells.has(i) && !isPickedUp;
          const isPreview = previewCells.includes(i);
          let cls = "bs-cell-empty";
          if (isPickedUp) cls = "bs-cell-pickedup";
          else if (isPlaced) cls = "bs-cell-placed";
          if (isPreview) cls = previewValid ? "bs-cell-hover-valid" : "bs-cell-hover-invalid";
          return (
            <div key={i} data-cell-idx={i} className={`bs-cell ${cls}`} />
          );
        })}
      </div>

      {/* Controls below the grid */}
      {!done ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: pickedUpIdx !== null ? "#fbbf24" : "#a78bfa", fontWeight: 700, marginBottom: "0.5rem" }}>
            {pickedUpIdx !== null ? "✋ " : ""}{t.placingShip} <span style={{ color: "white" }}>{current?.name}</span> ({current?.size} {t.fields})
          </p>
          <button className="rotate-btn" onClick={() => {
            const next = !horizontalRef.current;
            setHorizontal(next); horizontalRef.current = next;
            setPreviewAnchor(null); previewAnchorRef.current = null;
          }}>
            🔄 {horizontal ? t.horizontal : t.vertical} — {t.rotate}
          </button>
          <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", marginTop: "0.4rem" }}>
            {pickedUpIdx !== null ? t.dragToReplace : t.dragToPlace}
          </p>
        </div>
      ) : (
        <p style={{ color: "#34d399", fontWeight: 700, fontSize: "1.1rem" }}>✅ {t.allPlaced}</p>
      )}

      {/* Ship checklist */}
      <div className="ship-list">
        {shipDefs.map((s, idx) => {
          const isPlacedShip = idx < placedShips.length;
          const isActive = idx === currentIdx;
          const isPickedUpShip = idx === pickedUpIdx;
          return (
            <span key={idx} className={`ship-tag ${isPickedUpShip ? "ship-pickedup" : isPlacedShip ? "ship-done" : isActive ? "ship-active" : "ship-pending"}`}>
              {isPickedUpShip ? "✋" : isPlacedShip ? "✓" : ""} {s.name} ({s.size})
            </span>
          );
        })}
      </div>

      <button className="btn-secondary" onClick={handleReset} style={{ fontSize: "0.85rem" }}>
        🔄 {t.resetPlacement}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

function Battleship() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const gameIdFromUrl = params.get("gameId");
  const mode = params.get("mode") || "online";
  const isComputer = mode === "computer";

  const [game, setGame] = useState(null);
  const [playerSymbol, setPlayerSymbol] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("playerName") || "");
  const [nameInput, setNameInput] = useState("");
  const [placedShips, setPlacedShips] = useState([]);
  const [phase, setPhase] = useState("place");
  const [showRules, setShowRules] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showTurnBanner, setShowTurnBanner] = useState(false);
  const prevTurnRef = useRef(null);
  const turnBannerTextRef = useRef("");

  const [playerId] = useState(() => {
    let s = localStorage.getItem("playerId");
    if (!s) {
      s = uuidv4();
      localStorage.setItem("playerId", s);
    }
    return s;
  });

  const SHIPS = SHIP_DEFS(t);

  // ── Computer ───────────────────────────────────────────────────────────

  const initComputerGame = (myShips) => ({
    id: "local",
    player_x: playerId,
    player_x_name: playerName,
    player_x_ships: myShips,
    player_x_shots: [],
    player_o: "computer",
    player_o_name: t.computer,
    player_o_ships: placeShipsRandomly(),
    player_o_shots: [],
    turn: "X",
    winner: null,
  });

  useEffect(() => {
    if (!isComputer) return;
    setPlayerSymbol("X");
    setPhase("place");
    setPlacedShips([]);
    setGame(null);
  }, [isComputer]);

  const doAiShot = (currentGame) => {
    setTimeout(() => {
      const shots = normalizeShots(currentGame.player_o_shots);
      const myShips = normalizeShips(currentGame.player_x_ships);
      const shot = getAiShot(shots, myShips);
      const newShots = [...shots, shot];
      const allSunk = myShips.flat().every((c) => newShots.includes(c));
      setGame((prev) => ({
        ...prev,
        player_o_shots: newShots,
        turn: allSunk ? null : "X",
        winner: allSunk ? "O" : null,
      }));
    }, 700);
  };

  const handleComputerShot = (index) => {
    if (!game || game.winner || game.turn !== "X") return;
    const shots = normalizeShots(game.player_x_shots);
    if (shots.includes(index)) return;
    const opShips = normalizeShips(game.player_o_ships);
    const newShots = [...shots, index];
    const allSunk = opShips.flat().every((c) => newShots.includes(c));
    const newGame = {
      ...game,
      player_x_shots: newShots,
      turn: allSunk ? null : "O",
      winner: allSunk ? "X" : null,
    };
    setGame(newGame);
    if (!allSunk) doAiShot(newGame);
  };

  // ── Online ─────────────────────────────────────────────────────────────

  const createOnlineGame = async () => {
    const gRef = ref(db, "battleship");
    const newRef = push(gRef);
    await set(newRef, {
      player_x: playerId,
      player_x_name: playerName,
      player_x_ships: null,
      player_x_shots: [],
      player_o: null,
      player_o_name: null,
      player_o_ships: null,
      player_o_shots: [],
      turn: "X",
      winner: null,
    });
    onDisconnect(newRef).remove();
    return newRef.key;
  };

  const handleStart = async () => {
    if (isComputer) {
      setPlacedShips([]);
      setGame(null);
      setPhase("place");
      return;
    }
    const id = await createOnlineGame();
    navigate(`/battleship?gameId=${id}&mode=online`);
  };

  useEffect(() => {
    if (!gameIdFromUrl || isComputer) return;
    const gameRef = ref(db, `battleship/${gameIdFromUrl}`);
    const init = async () => {
      const snap = await get(gameRef);
      if (!snap.exists()) {
        navigate("/");
        return;
      }
      const data = snap.val();
      setGame({ ...data, id: gameIdFromUrl });
      if (data.player_x === playerId) {
        setPlayerSymbol("X");
        onDisconnect(gameRef).remove();
      } else if (!data.player_o) {
        await update(gameRef, {
          player_o: playerId,
          player_o_name: playerName,
        });
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

  useEffect(() => {
    if (!game?.winner) {
      setShowOverlay(false);
      return;
    }
    const timer = setTimeout(() => setShowOverlay(true), 600);
    return () => clearTimeout(timer);
  }, [game?.winner]);

  useEffect(() => {
    if (!game?.turn || game?.winner) return;
    if (prevTurnRef.current !== null && prevTurnRef.current !== game.turn) {
      const name =
        game.turn === "X"
          ? game.player_x_name || "Player X"
          : game.player_o_name || "Player O";
      turnBannerTextRef.current = `${name} ${t.nowShooting}`;
      setShowTurnBanner(true);
      const timer = setTimeout(() => setShowTurnBanner(false), 2000);
      prevTurnRef.current = game.turn;
      return () => clearTimeout(timer);
    }
    prevTurnRef.current = game.turn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.turn, game?.winner]);

  const handleConfirmPlacement = async () => {
    if (placedShips.length !== SHIPS.length) return;
    if (isComputer) {
      setGame(initComputerGame(placedShips));
      setPhase("play");
    } else {
      const gameRef = ref(db, `battleship/${game.id}`);
      const field = playerSymbol === "X" ? "player_x_ships" : "player_o_ships";
      await update(gameRef, { [field]: placedShips });
      setPhase("play");
    }
  };

  const handleOnlineShot = async (index) => {
    if (
      !game ||
      game.winner ||
      game.turn !== playerSymbol ||
      playerSymbol === "Spectator"
    )
      return;
    const gameRef = ref(db, `battleship/${game.id}`);
    const snap = await get(gameRef);
    const fd = snap.val();
    if (fd.turn !== playerSymbol || fd.winner) return;
    const myShots = normalizeShots(
      playerSymbol === "X" ? fd.player_x_shots : fd.player_o_shots,
    );
    if (myShots.includes(index)) return;
    const opShips = normalizeShips(
      playerSymbol === "X" ? fd.player_o_ships : fd.player_x_ships,
    );
    const newShots = [...myShots, index];
    const allSunk = opShips.flat().every((c) => newShots.includes(c));
    const updates = { turn: playerSymbol === "X" ? "O" : "X" };
    if (playerSymbol === "X") updates.player_x_shots = newShots;
    else updates.player_o_shots = newShots;
    if (allSunk) {
      updates.winner = playerSymbol;
      updates.turn = null;
    }
    await update(gameRef, updates);
  };

  const copyLink = (link) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Compute display values ─────────────────────────────────────────────

  const effectiveSym = isComputer ? "X" : playerSymbol;
  const nameX = game?.player_x_name || "Player X";
  const nameO = game?.player_o_name || (isComputer ? t.computer : "Player O");
  const inviteLink = `${window.location.origin}/battleship?gameId=${game?.id}&mode=online`;

  const myShips = normalizeShips(
    effectiveSym === "X" ? game?.player_x_ships : game?.player_o_ships,
  );
  const opponentShips = normalizeShips(
    effectiveSym === "X" ? game?.player_o_ships : game?.player_x_ships,
  );
  const myShots = normalizeShots(
    effectiveSym === "X" ? game?.player_x_shots : game?.player_o_shots,
  );
  const opponentShots = normalizeShots(
    effectiveSym === "X" ? game?.player_o_shots : game?.player_x_shots,
  );

  const myShipCells = new Set(myShips.flat());
  const opponentShipCells = new Set(opponentShips.flat());
  const incomingHits = new Set(opponentShots.filter((s) => myShipCells.has(s)));
  const incomingMisses = new Set(
    opponentShots.filter((s) => !myShipCells.has(s)),
  );
  const shotHits = new Set(myShots.filter((s) => opponentShipCells.has(s)));
  const shotMisses = new Set(myShots.filter((s) => !opponentShipCells.has(s)));

  const iHavePlaced = isComputer
    ? phase === "play"
    : myShips.length === SHIPS.length;
  const opponentHasPlaced = isComputer
    ? true
    : opponentShips.length === SHIPS.length;
  const bothPlaced = iHavePlaced && opponentHasPlaced;

  const topBar = (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        width: "100%",
        maxWidth: "700px",
        padding: "0.5rem 1rem 0",
      }}
    >
      <button className="btn-icon" onClick={() => setShowRules(true)}>
        📖 {t.rules}
      </button>
    </div>
  );

  // No game / create
  if (!gameIdFromUrl && !isComputer) {
    return (
      <div
        className="fade-in"
        style={{ textAlign: "center", padding: "2rem 1rem" }}
      >
        {topBar}
        <h1 className="game-title">🚢 {t.battleship}</h1>
        <p style={{ color: "rgba(255,255,255,0.5)", marginBottom: "1.5rem" }}>
          {playerName}
        </p>
        <button className="btn-primary" onClick={handleStart}>
          {t.createGame}
        </button>
        {showRules && (
          <RulesModal
            gameKey="battleship"
            onClose={() => setShowRules(false)}
          />
        )}
      </div>
    );
  }

  // Placement phase
  if (
    (isComputer && phase === "place") ||
    (!isComputer && game && !iHavePlaced && effectiveSym !== "Spectator")
  ) {
    return (
      <div className="fade-in" style={{ textAlign: "center", padding: "1rem" }}>
        {topBar}
        <h1 className="game-title">🚢 {t.battleship}</h1>
        <h2
          style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: "1.1rem",
            marginBottom: "1rem",
          }}
        >
          {t.placeFleet}
        </h2>
        <PlacementGrid
          placedShips={placedShips}
          shipDefs={SHIPS}
          onPlace={(cells) => setPlacedShips((prev) => [...prev, cells])}
          onSwap={(idx, cells) => setPlacedShips((prev) => prev.map((s, i) => i === idx ? cells : s))}
          onReset={() => setPlacedShips([])}
        />
        {placedShips.length === SHIPS.length && (
          <button
            className="btn-success"
            onClick={handleConfirmPlacement}
            style={{ marginTop: "1rem" }}
          >
            ✅ {t.confirmFleet}
          </button>
        )}
        {showRules && (
          <RulesModal
            gameKey="battleship"
            onClose={() => setShowRules(false)}
          />
        )}
      </div>
    );
  }

  // Waiting for opponent
  if (!isComputer && effectiveSym === "X" && game && !game.player_o) {
    return (
      <div
        className="fade-in"
        style={{ textAlign: "center", padding: "2rem 1rem" }}
      >
        {topBar}
        <h1 className="game-title">🚢 {t.battleship}</h1>
        <div className="invite-box">
          <p>{t.inviteFriend}</p>
          <div className="invite-row">
            <input
              readOnly
              value={inviteLink}
              className="invite-input"
              onClick={(e) => e.target.select()}
            />
            <button
              className="btn-primary"
              onClick={() => copyLink(inviteLink)}
            >
              {copied ? "✅" : t.copyLink}
            </button>
          </div>
        </div>
        <p style={{ color: "rgba(255,255,255,0.4)", marginTop: "1rem" }}>
          {t.waitingOpponent}
        </p>
        {showRules && (
          <RulesModal
            gameKey="battleship"
            onClose={() => setShowRules(false)}
          />
        )}
      </div>
    );
  }

  // Waiting for both to place
  if (!isComputer && !bothPlaced && effectiveSym !== "Spectator") {
    return (
      <div
        className="fade-in"
        style={{ textAlign: "center", padding: "2rem 1rem" }}
      >
        {topBar}
        <h1 className="game-title">🚢 {t.battleship}</h1>
        <div className="status-badge status-wait" style={{ marginTop: "1rem" }}>
          ⏳ {t.waitingEnemy}
        </div>
        {showRules && (
          <RulesModal
            gameKey="battleship"
            onClose={() => setShowRules(false)}
          />
        )}
      </div>
    );
  }

  if (!game)
    return (
      <div
        style={{
          textAlign: "center",
          marginTop: "4rem",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {t.loading}
      </div>
    );

  if (!playerName && effectiveSym !== "Spectator" && !isComputer) {
    const handleNameSubmit = () => {
      const trimmed = nameInput.trim();
      if (trimmed) { localStorage.setItem("playerName", trimmed); setPlayerName(trimmed); }
    };
    return (
      <div className="fade-in" style={{ textAlign: "center", marginTop: "4rem", padding: "0 1rem" }}>
        <h2 style={{ color: "rgba(255,255,255,0.7)", marginBottom: "1rem" }}>{t.enterNameFirst}</h2>
        <input type="text" value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
          className="name-input" />
        <br />
        <button className="btn-primary" onClick={handleNameSubmit} style={{ marginTop: "1rem" }}>
          {t.confirmName}
        </button>
      </div>
    );
  }

  const overlayResult = !game.winner
    ? null
    : game.winner === (isComputer ? "X" : effectiveSym)
      ? "win"
      : "loss";

  const canShoot =
    !game.winner && game.turn === (isComputer ? "X" : effectiveSym);
  const statusClass = game.winner
    ? "status-win"
    : canShoot
      ? "status-turn"
      : "status-wait";
  const statusText = game.winner
    ? game.winner === (isComputer ? "X" : effectiveSym)
      ? `🏆 ${t.youWin}`
      : `🏆 ${game.winner === "X" ? nameX : nameO} ${t.wins}`
    : canShoot
      ? `🎯 ${t.fireNow}`
      : `⏳ ${game.turn === "X" ? nameX : nameO} ${t.enemyShooting}`;

  return (
    <div
      className="fade-in"
      style={{ textAlign: "center", padding: "0.5rem 0.5rem 1rem" }}
    >
      {topBar}
      <h1 className="game-title">🚢 {t.battleship}</h1>
      <div className={`status-badge ${statusClass}`}>{statusText}</div>

      <div className="player-bar">
        <span className="player-x">🔵 {nameX}</span>
        <span>{t.vs}</span>
        <span className="player-o">🔴 {nameO}</span>
      </div>

      <div
        className="bs-grids-row"
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "1.5rem",
          flexWrap: "wrap",
          marginTop: "0.75rem",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "0.85rem",
              color: "rgba(255,255,255,0.45)",
              marginBottom: "0.3rem",
            }}
          >
            {t.yourFleet}
          </p>
          <div className="bs-grid">
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const isShip = myShipCells.has(i);
              const isHit = incomingHits.has(i);
              const isMiss = incomingMisses.has(i);
              let cls = "bs-cell-empty";
              if (isShip) cls = "bs-cell-ship";
              if (isHit) cls = "bs-cell-hit";
              if (isMiss) cls = "bs-cell-miss";
              return <div key={i} className={`bs-cell ${cls}`} />;
            })}
          </div>
        </div>
        <div>
          <p
            style={{
              fontSize: "0.85rem",
              color: "rgba(255,255,255,0.45)",
              marginBottom: "0.3rem",
            }}
          >
            {t.enemyField}
          </p>
          <div className="bs-grid">
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const isHit = shotHits.has(i);
              const isMiss = shotMisses.has(i);
              const canFire = canShoot && !isHit && !isMiss;
              let cls = "bs-cell-empty";
              if (isHit) cls = "bs-cell-hit";
              if (isMiss) cls = "bs-cell-miss";
              return (
                <div
                  key={i}
                  className={`bs-cell ${cls}`}
                  style={{ cursor: canFire ? "crosshair" : "default" }}
                  onClick={() =>
                    canFire &&
                    (isComputer ? handleComputerShot(i) : handleOnlineShot(i))
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: "0.78rem",
          color: "rgba(255,255,255,0.35)",
          marginTop: "0.5rem",
        }}
      >
        🔴 {t.hit} &nbsp; 🔵 {t.miss} &nbsp; ⬛ {t.myShip}
      </div>

      {showOverlay && overlayResult && (
        <GameResultOverlay
          result={overlayResult}
          winnerName={game.winner === "X" ? nameX : nameO}
          onClose={() => setShowOverlay(false)}
        >
          <button
            className="btn-primary"
            onClick={() => {
              setShowOverlay(false);
              handleStart();
            }}
          >
            {t.newGame}
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowOverlay(false)}
          >
            ✕
          </button>
        </GameResultOverlay>
      )}

      <TurnBanner show={showTurnBanner} text={turnBannerTextRef.current} />

      {!isComputer && gameIdFromUrl && game.player_o && (
        <GameSuggestion gameType="battleship" gameId={gameIdFromUrl} playerId={playerId} currentGame="/battleship" />
      )}

      {showRules && (
        <RulesModal gameKey="battleship" onClose={() => setShowRules(false)} />
      )}
    </div>
  );
}

export default Battleship;
