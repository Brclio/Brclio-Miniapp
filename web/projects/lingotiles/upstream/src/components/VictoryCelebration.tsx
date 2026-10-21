import { useEffect, useRef } from 'react';
import './victory.css';

type VictoryCelebrationProps = {
  /** A new ID for every attempt. Render this component only for a completed win. */
  runId: string;
  stars: number;
  enabled?: boolean;
};

const DURATION_MS = 2600;
const COLORS = ['#236ec0', '#236ec0', '#236ec0', '#f4d758', '#f4d758', '#d64b59', '#326450'];

function drawStar(context: CanvasRenderingContext2D, radius: number) {
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = point * Math.PI / 5 - Math.PI / 2;
    const length = radius * (point % 2 ? .46 : 1);
    const x = Math.cos(angle) * length;
    const y = Math.sin(angle) * length;
    if (point === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
}

/** A finite canvas burst, with no timers or animation frames left after unmount. */
export default function VictoryCelebration({ runId, stars, enabled = true }: VictoryCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emittedRun = useRef<string | null>(null);
  const starCount = Math.max(1, Math.min(3, Math.round(stars)));

  useEffect(() => {
    if (!enabled || !runId || emittedRun.current === runId) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionPreference.matches) return;

    let frame = 0;
    let active = true;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);

    const particles = Array.from({ length: 66 }, (_, index) => {
      const angle = -Math.PI + (index / 65) * Math.PI;
      const speed = 180 + ((index * 71) % 210);
      return {
        vx: Math.cos(angle) * speed * Math.min(1, width / 650),
        vy: Math.sin(angle) * speed - 80,
        size: 5 + (index % 5),
        spin: (index % 2 ? 1 : -1) * (2 + index % 4),
        color: COLORS[index % COLORS.length],
        isStar: index % 9 === 0,
      };
    });
    let start = 0;
    const draw = (now: number) => {
      if (!active) return;
      // Defer the emission until a frame actually runs. StrictMode's first setup
      // is cleaned up before this point, so it cannot consume or double the burst.
      if (!start) { start = now; emittedRun.current = runId; }
      const elapsed = now - start;
      const seconds = elapsed / 1000;
      context.clearRect(0, 0, width, height);
      if (elapsed >= DURATION_MS) return;

      const fade = Math.min(1, Math.max(0, (DURATION_MS - elapsed) / 700));
      for (const [index, particle] of particles.entries()) {
        context.save();
        context.globalAlpha = fade;
        context.fillStyle = particle.color;
        context.translate(width / 2 + particle.vx * seconds, height * .4 + particle.vy * seconds + 190 * seconds * seconds);
        context.rotate(seconds * particle.spin + index);
        if (particle.isStar) drawStar(context, particle.size);
        else context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * .65);
        context.restore();
      }

      for (let index = 0; index < starCount; index++) {
        const age = elapsed - index * 150;
        if (age < 0) continue;
        const progress = Math.min(1, age / 450);
        const eased = 1 - Math.pow(1 - progress, 3);
        context.save();
        context.globalAlpha = Math.min(1, age / 120) * Math.max(0, 1 - Math.max(0, age - 1000) / 800);
        context.fillStyle = '#f4d758';
        context.translate(width / 2 + (index - (starCount - 1) / 2) * Math.min(74, width * .16), height * .29 - eased * 35);
        context.rotate((index - 1) * .15);
        drawStar(context, (15 + eased * 14) * Math.min(1, width / 420));
        context.restore();
      }
      frame = window.requestAnimationFrame(draw);
    };
    const stop = () => {
      active = false;
      window.cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
    const handlePreference = () => { if (motionPreference.matches) stop(); };
    motionPreference.addEventListener('change', handlePreference);
    frame = window.requestAnimationFrame(draw);
    return () => {
      stop();
      motionPreference.removeEventListener('change', handlePreference);
    };
  }, [enabled, runId, starCount]);

  if (!enabled || !runId) return null;
  return <div className="victory-celebration" aria-hidden="true" data-run-id={runId}>
    <canvas ref={canvasRef} className="victory-canvas" />
    <div className="victory-still"><span>{'★'.repeat(starCount)}</span><strong>本关挑战成功</strong></div>
  </div>;
}
