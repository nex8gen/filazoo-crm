"use client";

import { useEffect, useRef } from "react";

function createParticles() {
  let seed = 21;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  return Array.from({ length: 1_500 }, () => {
    const y = 1 - random() * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = random() * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
  });
}

const particles = createParticles();

export default function ParticleSphereAnimation({ active = true }: { active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let size = 0;
    let rotation = 0;
    let lastDraw = 0;
    let inView = true;

    function draw() {
      if (!context || !size) return;
      context.clearRect(0, 0, size, size);
      const radius = size * 0.47;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      particles.forEach((particle, index) => {
        const x = particle.x * cosine + particle.z * sine;
        const z = particle.z * cosine - particle.x * sine;
        const depth = (z + 1) / 2;
        const opacity = 0.15 + depth * 0.65;
        const warm = Math.abs(particle.y) < 0.16 && index % 4 === 0;
        context.fillStyle = warm ? `rgba(245,170,100,${opacity})` : `rgba(${105 + Math.round(depth * 25)},${140 + Math.round(depth * 20)},250,${opacity})`;
        context.beginPath();
        context.arc(size / 2 + x * radius, size / 2 + particle.y * radius, 0.4 + depth * 0.45, 0, Math.PI * 2);
        context.fill();
      });
    }

    function tick(time: number) {
      if (time - lastDraw >= 40) {
        rotation += 0.004;
        draw();
        lastDraw = time;
      }
      frame = requestAnimationFrame(tick);
    }

    function syncAnimation() {
      cancelAnimationFrame(frame);
      draw();
      if (active && inView && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(tick);
    }

    const resize = new ResizeObserver(() => {
      size = canvas.getBoundingClientRect().width;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      syncAnimation();
    });
    const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; syncAnimation(); });
    resize.observe(canvas);
    visibility.observe(canvas);
    reducedMotion.addEventListener("change", syncAnimation);
    document.addEventListener("visibilitychange", syncAnimation);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      reducedMotion.removeEventListener("change", syncAnimation);
      document.removeEventListener("visibilitychange", syncAnimation);
    };
  }, [active]);

  return <canvas ref={canvasRef} className="agent-orbit-particles" aria-hidden="true" />;
}
