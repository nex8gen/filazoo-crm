"use client";

import type { CSSProperties } from "react";
import { AgentWorkIcon } from "@/components/agent-work-icon";
import ParticleSphereAnimation from "@/components/ui/orbiting-circles-02-utils/particalsphear";
import type { AgentWorkArea } from "@/lib/ai/agent-progress";
import "./orbiting-circles-02.css";

const orbits: { diameter: string; duration: string; reverse?: boolean; icons: { area: AgentWorkArea; angle: number }[] }[] = [
  { diameter: "60%", duration: "24s", icons: [{ area: "invoice", angle: -65 }, { area: "email", angle: 35 }, { area: "message", angle: 95 }] },
  { diameter: "76%", duration: "32s", reverse: true, icons: [{ area: "company", angle: -40 }, { area: "product", angle: 70 }] },
  { diameter: "92%", duration: "42s", icons: [{ area: "flow", angle: -55 }, { area: "workspace", angle: 20 }] },
];

export default function OrbitingCirclesGlobe({ active = true }: { active?: boolean }) {
  return <div className="agent-orbit-scene" data-active={active} role="img" aria-label="Agent connected to invoices, email, chat, customers, products and workflows">
    <div aria-hidden="true" className="agent-orbit-artwork">
      <ParticleSphereAnimation active={active} />
      {orbits.map((orbit) => <div key={orbit.diameter} className="agent-orbit-ring" style={{ width: orbit.diameter }}>
        {[...orbit.icons, ...orbit.icons.map((icon) => ({ ...icon, angle: icon.angle + 180 }))].map(({ area, angle }) => <div key={`${area}-${angle}`} className="agent-orbit-traveler" style={{
          "--start-angle": `${angle}deg`,
          "--counter-angle": `${-angle}deg`,
          "--orbit-turn": orbit.reverse ? "-360deg" : "360deg",
          "--orbit-duration": orbit.duration,
        } as CSSProperties}>
          <div className={`agent-orbit-badge agent-orbit-${area}`}><AgentWorkIcon area={area} className="size-3.5" /></div>
        </div>)}
      </div>)}
    </div>
  </div>;
}
