import * as React from "react";
import { parseWhatsAppLine } from "@/lib/whatsapp-format";
import { cn } from "@/lib/utils";

/** Renders a message the way WhatsApp shows it: line breaks, *gras*, _italique_, ~barré~. */
export function WhatsAppText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {parseWhatsAppLine(line).map((s, j) =>
            s.bold ? (
              <strong key={j} className="font-semibold">{s.text}</strong>
            ) : s.italic ? (
              <em key={j}>{s.text}</em>
            ) : s.strike ? (
              <s key={j}>{s.text}</s>
            ) : (
              <React.Fragment key={j}>{s.text}</React.Fragment>
            ),
          )}
          {i < lines.length - 1 && "\n"}
        </React.Fragment>
      ))}
    </span>
  );
}
