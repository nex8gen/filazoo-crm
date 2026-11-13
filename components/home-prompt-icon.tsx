import Image from "next/image";
import type { HomePrompt } from "@/lib/home-prompts";

const promptArtwork: Record<HomePrompt["icon"], string> = {
  megaphone: "reference-megaphone",
  calendar: "reference-calendar",
  package: "reference-package",
  receipt: "reference-coins",
  mail: "reference-welcome",
  file: "reference-tag",
  list: "reference-calendar",
  boxes: "reference-package",
};

/** Original artwork from the supplied reference; provenance is recorded in public/icons/home-prompts/SOURCES.txt. */
export function HomePromptIcon({ name, size = 36 }: { name: HomePrompt["icon"]; size?: number }) {
  return <Image src={`/icons/home-prompts/${promptArtwork[name]}.png`} width={size} height={size} sizes={`${size}px`} alt="" aria-hidden="true" className="home-prompt-artwork" />;
}
