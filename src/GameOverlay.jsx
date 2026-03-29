import { useEffect, useRef } from "react";
import { useLanguage } from "./LanguageContext";

// ── Confetti ────────────────────────────────────────────────────────────────
function Confetti({ active }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 100,
      r: 4 + Math.random() * 6,
      d: 2 + Math.random() * 3,
      color: `hsl(${Math.random() * 360},90%,60%)`,
      tilt: Math.random() * 10 - 5,
      tiltAngle: 0,
      tiltSpeed: 0.05 + Math.random() * 0.1,
    }));

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.tiltAngle += p.tiltSpeed;
        p.y += p.d;
        p.x += Math.sin(frame * 0.02 + p.tiltAngle) * 1.5;
        p.tilt = Math.sin(p.tiltAngle) * 12;
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
        ctx.stroke();
      });
      frame++;
      if (frame < 220) animRef.current = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: 9999 }}
    />
  );
}

// ── Win/Loss/Draw Overlay ───────────────────────────────────────────────────
export function GameResultOverlay({ result, winnerName, loserName, onClose, children }) {
  const { t } = useLanguage();

  const isWin = result === "win";
  const isLoss = result === "loss";

  const sarcastic = isWin
    ? t.sarcasticWin[Math.floor(Math.random() * t.sarcasticWin.length)]
    : isLoss
    ? t.sarcasticLoss[Math.floor(Math.random() * t.sarcasticLoss.length)]
    : t.sarcasticDraw[Math.floor(Math.random() * t.sarcasticDraw.length)];

  const emoji = isWin ? "🏆" : isLoss ? "💀" : "🤝";
  const headline = isWin
    ? t.youWin
    : isLoss
    ? `${winnerName} ${t.wins}`
    : t.draw;

  return (
    <>
      <Confetti active={isWin} />
      <div className="result-overlay" onClick={onClose}>
        <div
          className={`result-overlay-box ${isWin ? "result-win" : isLoss ? "result-loss" : "result-draw"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="result-emoji">{emoji}</div>
          <h2 className="result-headline">{headline}</h2>
          <p className="result-sarcasm">"{sarcastic}"</p>
          <div className="result-overlay-btns">{children}</div>
        </div>
      </div>
    </>
  );
}

// ── Turn Change Banner (Battleship) ────────────────────────────────────────
export function TurnBanner({ show, text }) {
  if (!show) return null;
  return (
    <div className="turn-banner">
      <span className="turn-banner-text">{text}</span>
    </div>
  );
}

export default Confetti;
