import { FileText, Film, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMediaAttachment } from "@/lib/types";

/**
 * Outbound media are stored on the conversation timeline as
 * "[image] https://…" with the caption on the next line (lib/engine.ts).
 */
const MEDIA_MESSAGE = /^\[(image|video|document|audio)\] (https?:\/\/\S+)(?:\n([\s\S]*))?$/;

export function parseMediaMessage(content: string): AgentMediaAttachment | null {
  const m = MEDIA_MESSAGE.exec(content.trim());
  if (!m) return null;
  return { type: m[1] as AgentMediaAttachment["type"], url: m[2], caption: m[3]?.trim() || undefined };
}

const ICONS = { document: FileText, video: Film, audio: Music } as const;

/** Thumbnails for images, labelled links for other attachments. */
export function MediaAttachments({ media, className }: { media: AgentMediaAttachment[]; className?: string }) {
  return (
    <div className={cn("grid gap-2", media.length > 1 && "grid-cols-2", className)}>
      {media.map((m, i) =>
        m.type === "image" ? (
          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.caption ?? "Image"} loading="lazy" className="max-h-72 w-full object-cover" />
            {m.caption && <span className="block px-2 py-1 text-xs opacity-80">{m.caption}</span>}
          </a>
        ) : m.type === "video" ? (
          <div key={i} className="overflow-hidden rounded-lg bg-black">
            <video src={m.url} controls preload="metadata" className="max-h-72 w-full" />
            {m.caption && <span className="block bg-muted px-2 py-1 text-xs opacity-80">{m.caption}</span>}
          </div>
        ) : m.type === "audio" ? (
          <div key={i} className="space-y-1">
            <audio src={m.url} controls preload="metadata" className="h-10 w-64 max-w-full" />
            {m.caption && <span className="block text-xs opacity-80">{m.caption}</span>}
          </div>
        ) : (
          <a
            key={i}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs underline-offset-2 hover:underline"
          >
            {(() => {
              const Icon = ICONS[m.type];
              return <Icon className="size-4 shrink-0" />;
            })()}
            <span className="truncate">{m.caption ?? m.url.split("/").pop()}</span>
          </a>
        ),
      )}
    </div>
  );
}
