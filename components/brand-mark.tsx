import type { SVGProps } from "react";
import { brandIconPaths, brandIconViewBox, brandLogoPaths, brandLogoViewBox } from "../lib/brand-assets";

/** Original artwork with a light ink treatment for dark app surfaces. */
export function BrandMarkIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" className={"brand-mark " + (className ?? "")} viewBox={brandIconViewBox} preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {brandIconPaths.map(({ d, fill }, index) => <path key={index} d={d} fill={fill} className={index > 0 ? "brand-mark-ink" : undefined} />)}
    </svg>
  );
}

export function BrandMark({ className, style, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" className={"brand-mark " + (className ?? "")} viewBox={brandLogoViewBox} preserveAspectRatio="xMidYMid meet" width={1195} height={193} fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", ...style }} {...props}>
      {brandLogoPaths.map(({ d, fill }, index) => <path key={index} d={d} fill={fill} className={index > 0 ? "brand-mark-ink" : undefined} />)}
    </svg>
  );
}
