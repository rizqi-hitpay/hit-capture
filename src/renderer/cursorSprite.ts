/**
 * Cursor sprite renderer.
 * Draws a macOS-style pointer cursor with an optional click ripple effect.
 */

const CURSOR_PATH = new Path2D(
  // Simplified macOS arrow cursor (14×20 logical units)
  'M 0 0 L 0 16 L 4 12 L 7 20 L 9 19 L 6 11 L 11 11 Z'
);

interface RippleState {
  t: number;
  x: number;
  y: number;
}

export class CursorSprite {
  private ripples: RippleState[] = [];

  addRipple(x: number, y: number, t: number): void {
    this.ripples.push({ t, x, y });
    // Keep at most 3 concurrent ripples
    if (this.ripples.length > 3) this.ripples.shift();
  }

  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    currentT: number
  ): void {
    // Draw active ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      const age = currentT - r.t;
      const rippleDurationMs = 400;
      if (age > rippleDurationMs) {
        this.ripples.splice(i, 1);
        continue;
      }
      const progress = age / rippleDurationMs;
      const radius = progress * 28 * scale;
      const alpha = (1 - progress) * 0.5;

      ctx.save();
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.restore();
    }

    // Draw cursor shadow
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    ctx.save();
    ctx.translate(1, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill(CURSOR_PATH);
    ctx.restore();

    // Draw cursor body (white fill + dark stroke)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.2 / scale;
    ctx.fill(CURSOR_PATH);
    ctx.stroke(CURSOR_PATH);

    ctx.restore();
  }
}
