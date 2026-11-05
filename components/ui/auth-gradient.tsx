"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function AuthGradient() {
  const reducedMotion = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[#052e20] bg-[radial-gradient(ellipse_at_90%_80%,#3ecf8e,transparent_65%),radial-gradient(ellipse_at_10%_50%,#08794e,transparent_50%)]"><GrainGradient speed={reducedMotion ? 0 : 1} scale={1} rotation={0} offsetX={0} offsetY={0} softness={0.5} intensity={0.5} noise={0.25} shape="corners" frame={2854.5} colors={["#A7F3D0", "#3ECF8E", "#08794E", "#3ECF8E"]} colorBack="#052e20" className="absolute inset-0 size-full" /><div className="absolute inset-0 bg-gradient-to-b from-[#052e20]/70 via-[#052e20]/20 to-[#052e20]/65" /></div>;
}
