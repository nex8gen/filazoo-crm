"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EditorColorControl, EditorSelect } from "@/components/email-editor-controls";

export function EmailImageMaker({ onCreate, disabled }: { onCreate: (src: string, alt: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState("Your next great idea"), [caption, setCaption] = useState("Made possible with Filazoo");
  const [background, setBackground] = useState("#0b494c"), [color, setColor] = useState("#ffffff"), [shape, setShape] = useState("wide"), [error, setError] = useState("");
  function make() {
    try {
      const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = shape === "square" ? 1200 : 600;
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Image creation is unavailable in this browser.");
      ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      let size = 72; ctx.font = `600 ${size}px Arial`;
      while (ctx.measureText(title).width > 1050 && size > 20) { size -= 2; ctx.font = `600 ${size}px Arial`; }
      ctx.fillText(title, 600, canvas.height / 2 - 28);
      ctx.font = "30px Arial"; ctx.globalAlpha = .85; ctx.fillText(caption, 600, canvas.height / 2 + 58, 1050);
      const src = canvas.toDataURL("image/png");
      if (src.length > 1_000_000) throw new Error("The banner is too large. Try less text.");
      onCreate(src, [title, caption].filter(Boolean).join(" — ")); setOpen(false); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the image."); }
  }
  return <><Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}><ImagePlus />Make an image</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="!z-[90]"><DialogHeader><DialogTitle>Create an email banner</DialogTitle><DialogDescription>Make a real PNG banner using your text and brand colors.</DialogDescription></DialogHeader><label className="email-designer-field">Headline<Input aria-label="Banner headline" value={title} maxLength={100} onChange={event => setTitle(event.target.value)} /></label><label className="email-designer-field">Caption<Input aria-label="Banner caption" value={caption} maxLength={180} onChange={event => setCaption(event.target.value)} /></label><EditorSelect label="Banner shape" value={shape} options={[{ value: "wide", label: "Wide, 2:1" }, { value: "square", label: "Square" }]} onChange={setShape} /><EditorColorControl label="Banner background" value={background} onChange={setBackground} /><EditorColorControl label="Banner text color" value={color} onChange={setColor} />{error ? <NotificationToast>{error}</NotificationToast> : null}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={make}>Create and insert image</Button></DialogFooter></DialogContent></Dialog></>;
}
