import type { PortalDesign } from "./portal-design.ts";

export function defaultPortalDesign(brandName = "Filazoo"): PortalDesign {
  return {
    brandName, logoUrl: "", accent: "#25865b", theme: "minimal", layout: "columns",
    heading: "", welcome: "",
    announcement: "", footer: "", supportEmail: "",
    features: { downloadInvoice: true, sendMessages: true, languageSwitcher: true },
    sections: [
      { id: "overview", type: "overview", title: "Payment overview", body: "", enabled: true },
      { id: "tracking", type: "tracking", title: "Order tracking", body: "", enabled: true },
      { id: "invoice", type: "invoice", title: "Invoices", body: "", enabled: true },
      { id: "messages", type: "messages", title: "Messages", body: "", enabled: true },
    ],
  };
}

export function portalAccentForeground(color: string) {
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? "#111827" : "#ffffff";
}
