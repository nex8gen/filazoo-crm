import Image from "next/image";
import type { PromptIconName } from "@/lib/home-prompts";

const promptArtwork: Record<PromptIconName, string> = {
  megaphone: "reference-megaphone",
  calendar: "reference-calendar",
  package: "reference-package",
  receipt: "reference-coins",
  mail: "reference-welcome",
  file: "reference-tag",
  list: "reference-calendar",
  boxes: "reference-package",
  repair: "workflow-repair",
};

/** Serve original transparent artwork without thumbnail recompression; see SOURCES.txt. */
export function HomePromptIcon({ name, size = 36 }: { name: PromptIconName; size?: number }) {
  return <Image src={`/icons/home-prompts/${promptArtwork[name]}.png`} width={size} height={size} unoptimized alt="" aria-hidden="true" className="home-prompt-artwork shrink-0 object-contain" />;
}
