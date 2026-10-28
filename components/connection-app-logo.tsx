import Image from "next/image";

export function ConnectionAppLogo({ src, large = false }: { src: string; large?: boolean }) {
  const size = large ? 40 : 28;
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center border border-black/5 bg-white ${large ? "size-14 rounded-2xl" : "size-11 rounded-xl"}`}>
      <Image src={src} alt="" width={size} height={size} unoptimized className={large ? "size-10 object-contain" : "size-7 object-contain"} />
    </span>
  );
}
