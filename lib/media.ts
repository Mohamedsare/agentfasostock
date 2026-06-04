import "server-only";
import OpenAI, { toFile } from "openai";
import { serverEnv, features } from "@/lib/env";

/**
 * Multi-modal media layer: turns inbound WhatsApp media into text the agent can
 * reason about (speech-to-text, image understanding) and turns the agent's text
 * reply back into a voice note (text-to-speech). All functions degrade
 * gracefully — they return null on failure so the engine can fall back to text.
 */

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: serverEnv.openaiApiKey, baseURL: serverEnv.openaiBaseUrl });
  }
  return client;
}

/** Download a (decrypted) media URL into memory. Returns null on failure. */
async function download(url: string): Promise<{ bytes: Buffer; mimetype: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[media] download failed: HTTP ${res.status}`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const mimetype = res.headers.get("content-type") ?? "application/octet-stream";
    return { bytes, mimetype };
  } catch (err) {
    console.error("[media] download error:", err);
    return null;
  }
}

/** Transcribe a voice note / audio file to text (speech-to-text). */
export async function transcribeAudio(url: string, mimetype?: string): Promise<string | null> {
  if (!features.openai) return null;
  const dl = await download(url);
  if (!dl) return null;

  try {
    const ext = extensionFor(mimetype ?? dl.mimetype);
    const file = await toFile(dl.bytes, `audio.${ext}`, { type: mimetype ?? dl.mimetype });
    const result = await getClient().audio.transcriptions.create({
      file,
      model: serverEnv.openaiTranscribeModel,
    });
    const text = result.text?.trim();
    return text || null;
  } catch (err) {
    console.error("[media] transcription failed:", err);
    return null;
  }
}

/** Describe an image (in French) so the agent understands what the client sent. */
export async function describeImage(url: string, caption?: string): Promise<string | null> {
  if (!features.openai) return null;
  try {
    const completion = await getClient().chat.completions.create({
      model: serverEnv.openaiModel,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Décris en français, en une ou deux phrases, ce que montre cette image envoyée " +
                "par un client (produit, document, capture d'écran, problème visible...). " +
                "Sois factuel et concis." +
                (caption ? ` Légende fournie par le client : « ${caption} ».` : ""),
            },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("[media] image description failed:", err);
    return null;
  }
}

/** Synthesize a spoken reply (text-to-speech). Returns MP3 bytes + mimetype. */
export async function synthesizeSpeech(
  text: string,
): Promise<{ bytes: Uint8Array; mimetype: string } | null> {
  if (!features.openai || !text.trim()) return null;
  try {
    const res = await getClient().audio.speech.create({
      model: serverEnv.openaiTtsModel,
      voice: serverEnv.openaiTtsVoice,
      input: text,
      response_format: "mp3",
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, mimetype: "audio/mpeg" };
  } catch (err) {
    console.error("[media] speech synthesis failed:", err);
    return null;
  }
}

/** Map a mime type to a file extension Whisper recognises. */
function extensionFor(mimetype: string): string {
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("mpeg") || mimetype.includes("mp3")) return "mp3";
  if (mimetype.includes("mp4") || mimetype.includes("m4a")) return "m4a";
  if (mimetype.includes("wav")) return "wav";
  if (mimetype.includes("webm")) return "webm";
  if (mimetype.includes("amr")) return "amr";
  if (mimetype.includes("aac")) return "aac";
  return "ogg";
}
