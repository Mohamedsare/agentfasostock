/**
 * Offline validation of the inbound webhook parser (multi-modal).
 *
 *   npx tsx --conditions=react-server scripts/test-webhook-parse.ts
 *
 * Feeds realistic Wasender `messages.upsert` payloads (text, voice note, image,
 * document, status-update) through parseWasenderWebhook and checks that each is
 * classified and extracted correctly. No network / no API keys required — this
 * exercises only the pure parsing layer.
 */
// Ensure the media layer sees "OpenAI not configured" for the degradation test.
delete process.env.OPENAI_API_KEY;
import { parseWasenderWebhook } from "@/lib/wasender";
import { transcribeAudio, describeImage, synthesizeSpeech } from "@/lib/media";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

function upsert(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    event: "messages.upsert",
    data: {
      messages: {
        key: { remoteJid: "22670112233@s.whatsapp.net", fromMe: false, id: "MSG_" + Math.random() },
        pushName: "Awa Test",
        messageTimestamp: 1733300000,
        message,
        ...extra,
      },
    },
  };
}

console.log("\n── 1. Texte simple ──");
{
  const r = parseWasenderWebhook(upsert({ conversation: "Bonjour, je gère une boutique" }));
  check("parsed", r !== null);
  check("kind=text", r?.kind === "text", r?.kind);
  check("from normalisé", r?.from === "22670112233", r?.from);
  check("texte extrait", r?.text === "Bonjour, je gère une boutique", r?.text);
}

console.log("\n── 2. Note vocale (voice note) ──");
{
  const r = parseWasenderWebhook(
    upsert({
      audioMessage: {
        url: "https://mmg.whatsapp.net/v/enc/abc.enc",
        mediaKey: "Zm9vYmFybWVkaWFrZXk=",
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
        fileSha256: "c2hhMjU2",
      },
    }),
  );
  check("parsed", r !== null);
  check("kind=audio", r?.kind === "audio", r?.kind);
  check("ptt=true (voice note)", r?.media?.ptt === true, r?.media?.ptt);
  check("url média présente", Boolean(r?.media?.url?.startsWith("https://")), r?.media?.url);
  check("mediaKey présente", Boolean(r?.media?.mediaKey), r?.media?.mediaKey);
  check("mimetype audio", Boolean(r?.media?.mimetype?.includes("ogg")), r?.media?.mimetype);
  check("rawMessage présent (pour décryptage)", Boolean(r?.rawMessage));
  check("rawMessage contient audioMessage", Boolean((r?.rawMessage as any)?.message?.audioMessage));
}

console.log("\n── 3. Image avec légende ──");
{
  const r = parseWasenderWebhook(
    upsert({
      imageMessage: {
        url: "https://mmg.whatsapp.net/v/enc/img.enc",
        mediaKey: "aW1hZ2VrZXk=",
        mimetype: "image/jpeg",
        caption: "Voici mon magasin",
        fileSha256: "aW1nc2hh",
      },
    }),
  );
  check("parsed", r !== null);
  check("kind=image", r?.kind === "image", r?.kind);
  check("caption → text", r?.text === "Voici mon magasin", r?.text);
  check("media.caption", r?.media?.caption === "Voici mon magasin", r?.media?.caption);
  check("mimetype image", r?.media?.mimetype === "image/jpeg", r?.media?.mimetype);
}

console.log("\n── 4. Document ──");
{
  const r = parseWasenderWebhook(
    upsert({
      documentMessage: {
        url: "https://mmg.whatsapp.net/v/enc/doc.enc",
        mediaKey: "ZG9ja2V5",
        mimetype: "application/pdf",
        fileName: "facture.pdf",
      },
    }),
  );
  check("kind=document", r?.kind === "document", r?.kind);
  check("fileName extrait", r?.media?.fileName === "facture.pdf", r?.media?.fileName);
}

console.log("\n── 5. extendedTextMessage (reply/quote) ──");
{
  const r = parseWasenderWebhook(
    upsert({ extendedTextMessage: { text: "Oui je suis intéressé par une démo" } }),
  );
  check("kind=text", r?.kind === "text", r?.kind);
  check("texte extrait", r?.text === "Oui je suis intéressé par une démo", r?.text);
}

console.log("\n── 6. Message sortant (fromMe) reste parsé mais marqué fromMe ──");
{
  const payload = upsert({ conversation: "écho sortant" });
  payload.data.messages.key.fromMe = true;
  const r = parseWasenderWebhook(payload);
  check("fromMe=true", r?.fromMe === true, r?.fromMe);
}

console.log("\n── 7. Évènement non-message (statut) → ignoré (null) ──");
{
  const r = parseWasenderWebhook({ event: "messages.update", data: { messages: { key: {} } } });
  check("retourne null", r === null, r);
}

console.log("\n── 7b. Adressage @lid : phone résolu + lid capturé (anti-doublon) ──");
{
  const r = parseWasenderWebhook({
    event: "messages.received",
    data: {
      messages: {
        key: {
          id: "LIDMSG1",
          fromMe: false,
          senderPn: "22655889119@s.whatsapp.net",
          remoteJid: "154426253816038@lid",
          senderLid: "154426253816038@lid",
          cleanedSenderPn: "22655889119",
        },
        pushName: "Awa Lid",
        messageTimestamp: 1733300000,
        message: { conversation: "Bonjour via lid" },
      },
    },
  });
  check("from = vrai numéro (pas le lid)", r?.from === "22655889119", r?.from);
  check("lid capturé", r?.lid === "154426253816038@lid", r?.lid);
}

console.log("\n── 7c. lid-only (sans senderPn) → from = lid, lid capturé ──");
{
  const r = parseWasenderWebhook({
    event: "messages.received",
    data: {
      messages: {
        key: { id: "LIDMSG2", fromMe: false, remoteJid: "154426253816038@lid" },
        pushName: "Awa Lid",
        messageTimestamp: 1733300000,
        message: { conversation: "Bonjour lid seul" },
      },
    },
  });
  check("from = digits du lid (fallback)", r?.from === "154426253816038", r?.from);
  check("lid capturé", r?.lid === "154426253816038@lid", r?.lid);
}

void (async () => {
  console.log("\n── 8. Couche média : dégradation propre sans clé OpenAI ──");
  const t = await transcribeAudio("https://example.com/a.ogg", "audio/ogg");
  check("transcribeAudio → null (pas de throw)", t === null, t);
  const d = await describeImage("https://example.com/i.jpg", "légende");
  check("describeImage → null (pas de throw)", d === null, d);
  const s = await synthesizeSpeech("Bonjour");
  check("synthesizeSpeech → null (pas de throw)", s === null, s);

  console.log(`\n──────────────\nRésultat : ${passed} OK, ${failed} échec(s)\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
