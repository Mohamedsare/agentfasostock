/**
 * Centralised, typed access to environment variables.
 *
 * Server-only secrets are read lazily so that importing this module from a
 * client bundle never throws — only the getter throws if a secret is missing
 * when actually used on the server.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

/** Public values — safe to read in the browser. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000",
};

/** True when the public Supabase config is present. */
export const isSupabaseConfigured =
  Boolean(publicEnv.supabaseUrl) && Boolean(publicEnv.supabaseAnonKey);

/** Server-only secrets. Each getter throws if the variable is absent. */
export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get wasenderApiKey() {
    return required("WASENDER_API_KEY", process.env.WASENDER_API_KEY);
  },
  get wasenderBaseUrl() {
    return process.env.WASENDER_BASE_URL || "https://wasenderapi.com/api";
  },
  get wasenderWebhookSecret() {
    return process.env.WASENDER_WEBHOOK_SECRET ?? "";
  },
  /**
   * Account-level Wasender Personal Access Token — manages WhatsApp sessions
   * (create / QR / connect / status) for every tenant under the platform's
   * single Wasender account. Distinct from a per-session key (used to send).
   */
  get wasenderAccountToken() {
    return required(
      "WASENDER_ACCOUNT_TOKEN",
      process.env.WASENDER_ACCOUNT_TOKEN || process.env.WASENDER_API_KEY,
    );
  },
  /** Passphrase used to encrypt tenant secrets at rest (see lib/crypto.ts). */
  get appEncryptionKey() {
    return required(
      "APP_ENCRYPTION_KEY",
      process.env.APP_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  /** Platform OpenAI key used as a fallback when a tenant hasn't set their own. */
  get platformOpenaiApiKey() {
    return process.env.OPENAI_API_KEY ?? "";
  },
  get openaiModel() {
    return process.env.OPENAI_MODEL || "gpt-4o-mini";
  },
  /** Speech-to-text model for inbound voice notes. */
  get openaiTranscribeModel() {
    return process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  },
  /**
   * Primary language (ISO-639-1) of inbound voice notes. Forcing it stops
   * Whisper mis-detecting French/Mooré audio as another language. Set to ""
   * to let Whisper auto-detect.
   */
  get openaiTranscribeLanguage() {
    return process.env.OPENAI_TRANSCRIBE_LANGUAGE ?? "fr";
  },
  /** Text-to-speech model + voice for voice replies. */
  get openaiTtsModel() {
    return process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  },
  /**
   * Voice for spoken replies. Defaults to a feminine voice ("shimmer") to match
   * the assistant's persona (Latifatou). Other feminine options: coral, nova,
   * sage. Override with OPENAI_TTS_VOICE.
   */
  get openaiTtsVoice() {
    return process.env.OPENAI_TTS_VOICE || "shimmer";
  },
  get openaiBaseUrl() {
    return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  },
  get resendApiKey() {
    return required("RESEND_API_KEY", process.env.RESEND_API_KEY);
  },
  get resendFromEmail() {
    return process.env.RESEND_FROM_EMAIL || "AgentFS <onboarding@resend.dev>";
  },
  get adminEmail() {
    return required("ADMIN_EMAIL", process.env.ADMIN_EMAIL);
  },
  /**
   * Platform super-admin email (the app owner). Receives a notification on every
   * new user signup. Distinct from the per-tenant ADMIN_EMAIL.
   */
  get superAdminEmail() {
    return process.env.SUPER_ADMIN_EMAIL || "mohamedsare078@gmail.com";
  },
  /** Phone (E.164) that receives lead alerts over WhatsApp instead of email. */
  get adminWhatsapp() {
    return process.env.ADMIN_WHATSAPP || "+212771668079";
  },
  get appUrl() {
    return process.env.APP_URL || "http://localhost:3000";
  },
};

/** Feature flags derived from which secrets are configured. */
export const features = {
  get openai() {
    return Boolean(process.env.OPENAI_API_KEY);
  },
  get wasender() {
    return Boolean(process.env.WASENDER_API_KEY);
  },
  get resend() {
    return Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.ADMIN_EMAIL);
  },
};
