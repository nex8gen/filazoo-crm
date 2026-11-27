"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

const GrainGradient = dynamic(() => import("@paper-design/shaders-react").then(module => module.GrainGradient), { ssr: false });
const animationQuery = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

function subscribe(listener: () => void) {
  const query = window.matchMedia(animationQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function AuthGradient() {
  const animated = useSyncExternalStore(subscribe, () => window.matchMedia(animationQuery).matches, () => false);
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[#0A2D53] bg-[radial-gradient(ellipse_at_90%_80%,#4c8bc4,transparent_65%),radial-gradient(ellipse_at_10%_50%,#164b7b,transparent_50%)]">{animated ? <GrainGradient speed={1} scale={1} rotation={0} offsetX={0} offsetY={0} softness={0.5} intensity={0.5} noise={0.25} shape="corners" frame={2854.5} colors={["#B9D8F2", "#4C8BC4", "#164B7B", "#3974AB"]} colorBack="#0A2D53" className="absolute inset-0 size-full" /> : null}<div className="absolute inset-0 bg-gradient-to-b from-[#061b34]/70 via-[#0A2D53]/20 to-[#061b34]/65" /></div>;
}
