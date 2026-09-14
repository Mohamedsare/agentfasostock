/**
 * WhatsApp text formatting.
 *
 * WhatsApp is not Markdown: bold is *one asterisk*, italic _underscore_,
 * strikethrough ~tilde~, and there are no headings, links or tables. LLMs keep
 * producing Markdown (**bold**, "# Titre", inline "1. … 2. …" lists), which
 * shows up as raw asterisks on the client's phone. Every AI reply goes through
 * formatWhatsAppReply() before it is stored and sent.
 */

/** Labels the model sometimes leaves with nothing after them ("Photos :", "Réf :"). */
const EMPTY_LABEL =
  /(^|\s)[-–—•|]?\s*\*?(?:photos?|images?|réf(?:érence)?\.?|ref\.?|lien)\s*:\s*\*?\s*(?=[-–—•|]\s|\d{1,2}[.)]\s|\n|$)/gim;

export function formatWhatsAppReply(input: string): string {
  if (!input) return input;
  let text = input.replace(/\r\n?/g, "\n");

  // Media placeholders the model copies from the history ("Voici la photo : [image] …").
  text = text.replace(/\[(?:image|photo|vid[ée]o|document|audio|fichier)\]\s*:?\s*/gi, "");

  // Markdown → WhatsApp emphasis.
  text = text.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, "*$1*");
  text = text.replace(/__([^_\n]+?)__/g, "_$1_");
  text = text.replace(/~~([^~\n]+?)~~/g, "~$1~");
  // Headings and links have no WhatsApp equivalent: keep the text only.
  text = text.replace(/^\s*#{1,6}\s+/gm, "");
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1");
  // Empty "label :" fragments.
  text = text.replace(EMPTY_LABEL, "$1");
  // Dangling separators left behind ("— 2 000 FCFA - " at line end).
  text = text.replace(/\s+[-–—|]\s*(?=\n|$)/g, "");

  // Inline lists → one item per line: "Voici : 1. *A* 2. *B*" / "… • A • B".
  // Only when the text really holds an inline "1. … 2. …" list — never inside amounts or dates.
  if (/(^|\s)1[.)]\s+\S[\s\S]*\s2[.)]\s+\S/.test(text)) {
    text = text.replace(/[ \t]+(?=\d{1,2}[.)]\s+[^\d\s])/g, "\n");
  }
  text = text.replace(/([^\n])[ \t]+(?=[•▪◦]\s)/g, "$1\n");
  // A list starting right after an intro sentence gets a blank line before it.
  text = text.replace(/([:.!?])\n(?=(?:\d{1,2}[.)]|[•▪◦-])\s)/g, "$1\n\n");
  // The closing question after a list goes on its own paragraph.
  text = text.replace(
    /(\n(?:\d{1,2}[.)]|[•▪◦-])\s[^\n]*?)[ \t]+((?:Laquelle|Lequel|Lesquel|Souhaitez|Voulez|Vous|Quel|Quelle|Dites|Est-ce|Puis-je|Peux|Avez)[^\n]*\?)\s*$/,
    "$1\n\n$2",
  );

  // Inside list items keep "NOM — PRIX": "- *Prix :* 2 000 FCFA" → "— 2 000 FCFA",
  // drop internal references and labels left empty.
  text = text
    .split("\n")
    .map((line) => {
      if (!/^\s*(?:\d{1,2}[.)]|[•▪◦-])\s/.test(line)) return line;
      return line
        .replace(/\s+[-–—|]\s*\*?(?:réf(?:érence)?\.?|ref\.?|sku)\s*:\s*\*?\s*\S+/gi, "")
        .replace(/\s+[-–—|]\s*\*?prix\s*:\s*\*?\s*/gi, " — ")
        .replace(EMPTY_LABEL, "$1")
        .replace(/\s+[-–—|]\s*$/, "");
    })
    .join("\n");

  // No blank lines between the items of one list.
  const LIST_GAP = /(\n(?:\d{1,2}[.)]|[•▪◦-])\s[^\n]*)\n[ \t]*\n(?=(?:\d{1,2}[.)]|[•▪◦-])\s)/g;
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(LIST_GAP, "$1\n");
  }

  // Whitespace hygiene.
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+(?=\S)/g, (m) => (/^\n\s+(?:\d{1,2}[.)]|[•▪◦-])\s/.test(m) ? "\n" : m))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** Plain text for text-to-speech: formatting marks would be read aloud. */
export function stripWhatsAppFormatting(input: string): string {
  return input
    .replace(/(^|[\s(])[*_~]([^*_~\n]+)[*_~](?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/^\s*(?:[•▪◦-]|\d{1,2}[.)])\s+/gm, "")
    .trim();
}

export type WhatsAppSegment = { text: string; bold?: boolean; italic?: boolean; strike?: boolean };

/** Split a line into formatted segments (*gras*, _italique_, ~barré~) for display. */
export function parseWhatsAppLine(line: string): WhatsAppSegment[] {
  const segments: WhatsAppSegment[] = [];
  const pattern = /(^|[\s(])([*_~])([^*_~\n]*[^\s*_~])\2(?=[\s).,!?:;]|$)/g;
  let last = 0;
  for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
    const start = m.index + m[1].length;
    if (start > last) segments.push({ text: line.slice(last, start) });
    const style = m[2] === "*" ? { bold: true } : m[2] === "_" ? { italic: true } : { strike: true };
    segments.push({ text: m[3], ...style });
    last = start + m[2].length * 2 + m[3].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  return segments;
}
