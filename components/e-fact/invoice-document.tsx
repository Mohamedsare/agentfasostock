/**
 * E_Fact — the printable documents.
 *
 * `EFactPreview` renders the single element (#efact-document) that `@media
 * print` isolates into the exported PDF, switching layout on the document kind:
 * an itemised invoice/quote, or a narrative payment receipt. It intentionally
 * uses fixed light colours (never the app theme tokens) so it always prints as
 * a crisp white page, even in dark mode.
 */
import {
  type EFactDocument,
  amountToWords,
  computeTotals,
  currencySymbol,
  formatDate,
  formatMoney,
} from "./types";

/** Slightly darken a hex colour for gradients/borders without a colour lib. */
function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  const f = 1 - amount;
  const to = (n: number) => clamp(Math.round(n * f)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Shared page shell: accent band + branded header. */
function DocShell({
  doc,
  title,
  numberLabel,
  children,
}: {
  doc: EFactDocument;
  title: string;
  numberLabel: string;
  children: React.ReactNode;
}) {
  const accent = doc.accent || "#16A34A";
  const accentDark = shade(accent, 0.28);
  const emitterName = doc.emitter.company || doc.emitter.name || "Votre entreprise";

  return (
    <div
      id="efact-document"
      className="relative mx-auto w-full max-w-[820px] overflow-hidden bg-white text-slate-800 shadow-xl"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div
        className="h-2 w-full"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accentDark})` }}
      />
      <div className="px-8 pb-10 pt-8 sm:px-12">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {doc.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL, must print
              <img src={doc.logo} alt="Logo" className="h-16 w-16 rounded-lg object-contain" />
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-lg text-2xl font-black text-white"
                style={{ background: accent }}
              >
                {emitterName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-lg font-bold leading-tight text-slate-900">{emitterName}</p>
              {doc.emitter.company && doc.emitter.name && (
                <p className="text-sm text-slate-500">{doc.emitter.name}</p>
              )}
              {doc.emitter.website && <p className="text-sm text-slate-500">{doc.emitter.website}</p>}
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-black tracking-tight" style={{ color: accent }}>
              {title}
            </h1>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-700">
              {numberLabel} {doc.number || "—"}
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────  Invoice / quote  ───────────────────────── */

function InvoiceDocument({ doc }: { doc: EFactDocument }) {
  const totals = computeTotals(doc);
  const accent = doc.accent || "#16A34A";
  const accentDark = shade(accent, 0.28);
  const isFacture = doc.kind === "facture";
  const dueLabel = isFacture ? "Échéance" : "Valable jusqu'au";
  const sym = currencySymbol(doc.currency);
  const clientName = doc.client.company || doc.client.name || "Client";
  const money = (n: number) => formatMoney(n, doc.currency).replace(` ${sym}`, "");

  return (
    <DocShell doc={doc} title={isFacture ? "FACTURE" : "DEVIS"} numberLabel="N°">
      {/* Parties + dates */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div>
          <SectionLabel>Émetteur</SectionLabel>
          <div className="mt-1.5 space-y-0.5 text-sm text-slate-600">
            {doc.emitter.address && <WrapLines text={doc.emitter.address} />}
            {doc.emitter.phone && <p>{doc.emitter.phone}</p>}
            {doc.emitter.email && <p>{doc.emitter.email}</p>}
            {doc.emitter.taxId && <p className="text-slate-500">IFU / RCCM : {doc.emitter.taxId}</p>}
          </div>
        </div>
        <div>
          <SectionLabel>Facturé à</SectionLabel>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{clientName}</p>
          <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
            {doc.client.company && doc.client.name && <p>{doc.client.name}</p>}
            {doc.client.address && <WrapLines text={doc.client.address} />}
            {doc.client.phone && <p>{doc.client.phone}</p>}
            {doc.client.email && <p>{doc.client.email}</p>}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4">
          <MetaLine label="Date d'émission" value={formatDate(doc.issueDate)} />
          <MetaLine label={dueLabel} value={formatDate(doc.dueDate)} />
          <MetaLine label="Devise" value={`${doc.currency} · ${sym}`} />
        </div>
      </div>

      {/* Line items */}
      <div className="mt-8 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ background: accent }} className="text-white">
              <th className="px-4 py-3 text-left font-semibold">Désignation</th>
              <th className="w-16 px-3 py-3 text-right font-semibold">Qté</th>
              <th className="w-32 px-3 py-3 text-right font-semibold">P.U. ({sym})</th>
              <th className="w-36 px-4 py-3 text-right font-semibold">Montant ({sym})</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, i) => (
              <tr key={line.id} className={i % 2 === 1 ? "bg-slate-50/70" : "bg-white"}>
                <td className="px-4 py-3 align-top text-slate-700">
                  {line.description || <span className="text-slate-400">Article / service…</span>}
                </td>
                <td className="px-3 py-3 text-right align-top tabular-nums text-slate-600">
                  {line.quantity}
                </td>
                <td className="px-3 py-3 text-right align-top tabular-nums text-slate-600">
                  {money(line.unitPrice)}
                </td>
                <td className="px-4 py-3 text-right align-top font-medium tabular-nums text-slate-900">
                  {money(line.quantity * line.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals (no VAT) */}
      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs space-y-1.5">
          <TotalRow label="Sous-total" value={formatMoney(totals.subtotal, doc.currency)} />
          {doc.discountRate > 0 && (
            <TotalRow
              label={`Remise (${doc.discountRate}%)`}
              value={`- ${formatMoney(totals.discount, doc.currency)}`}
            />
          )}
          <div
            className="mt-2 flex items-center justify-between rounded-lg px-4 py-3 text-white"
            style={{ background: `linear-gradient(90deg, ${accent}, ${accentDark})` }}
          >
            <span className="text-sm font-semibold uppercase tracking-wide">
              {isFacture ? "Total à payer" : "Total"}
            </span>
            <span className="text-lg font-black tabular-nums">
              {formatMoney(totals.total, doc.currency)}
            </span>
          </div>
        </div>
      </div>

      {(doc.paymentInfo || doc.notes) && (
        <div className="mt-8 grid grid-cols-1 gap-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
          {doc.paymentInfo && (
            <div>
              <SectionLabel>Modalités de paiement</SectionLabel>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600">{doc.paymentInfo}</p>
            </div>
          )}
          {doc.notes && (
            <div>
              <SectionLabel>Notes</SectionLabel>
              <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600">{doc.notes}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-10 flex items-end justify-between">
        <p className="text-[11px] text-slate-400">Document généré avec E_Fact · FasoStock</p>
        <SignatureMark signature={doc.signature} label="Cachet & signature" />
      </div>
    </DocShell>
  );
}

/* ────────────────────────────  Receipt  ──────────────────────────── */

function ReceiptDocument({ doc }: { doc: EFactDocument }) {
  const accent = doc.accent || "#16A34A";
  const accentDark = shade(accent, 0.28);
  const prestataire = doc.emitter.name || doc.emitter.company || "—";
  const clientName = doc.client.name || doc.client.company || "—";
  const clientContact =
    [doc.client.phone, doc.client.email].filter(Boolean).join(" · ") || "—";

  const situation =
    doc.paymentStatus === "integral"
      ? "Payé intégralement"
      : `Acompte — Reste à payer : ${formatMoney(doc.remaining, doc.currency)}`;

  return (
    <DocShell doc={doc} title="REÇU DE PAIEMENT" numberLabel="Reçu n°">
      <PaidStamp
        label={doc.paymentStatus === "acompte" ? "ACOMPTE" : "PAYÉ"}
        date={formatDate(doc.issueDate)}
      />

      {/* Parties */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <SectionLabel>Je soussigné</SectionLabel>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{prestataire}</p>
          <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
            {doc.emitter.activity && <p>{doc.emitter.activity}</p>}
            {doc.emitter.phone && <p>Tél. : {doc.emitter.phone}</p>}
            {doc.emitter.email && <p>{doc.emitter.email}</p>}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <SectionLabel>Reconnais avoir reçu de</SectionLabel>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">{clientName}</p>
          <p className="mt-0.5 text-sm text-slate-600">{clientContact}</p>
        </div>
      </div>

      {/* Amount highlight */}
      <div
        className="mt-6 rounded-xl p-5 text-white"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accentDark})` }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80">
          La somme de
        </p>
        <p className="mt-1 text-3xl font-black tabular-nums">
          {formatMoney(doc.amountReceived, doc.currency)}
        </p>
        <p className="mt-2 text-sm text-white/90">
          <span className="text-white/70">Montant en lettres : </span>
          {amountToWords(doc.amountReceived, doc.currency)}
        </p>
      </div>

      {/* Details */}
      <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <DetailBlock label="Objet du paiement" value={doc.object} />
        <DetailBlock label="Mode de paiement" value={doc.paymentMode} />
        <DetailBlock label="Référence de transaction" value={doc.transactionRef} />
        <DetailBlock label="Situation du paiement" value={situation} strong />
      </div>

      {/* Place & date */}
      <p className="mt-8 text-sm text-slate-600">
        Fait à <span className="font-medium text-slate-900">{doc.city || "—"}</span>, le{" "}
        <span className="font-medium text-slate-900">{formatDate(doc.issueDate)}</span>.
      </p>

      {/* Signature (prestataire only) */}
      <div className="mt-6 flex justify-end">
        <SignatureMark signature={doc.signature} label="Signature du prestataire" />
      </div>

      <div className="mt-8 rounded-lg bg-slate-50 px-4 py-3 text-center text-[11px] leading-relaxed text-slate-500">
        Ce document atteste de la réception du paiement.
        <br />
        Il ne constitue pas une facture normalisée.
      </div>
    </DocShell>
  );
}

/** Public entry point — picks the right template for the document kind. */
export function EFactPreview({ doc }: { doc: EFactDocument }) {
  return doc.kind === "recu" ? <ReceiptDocument doc={doc} /> : <InvoiceDocument doc={doc} />;
}

/* ─────────────────────────  small building blocks  ───────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{children}</p>
  );
}

function DetailBlock({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p
        className={
          strong
            ? "mt-1 text-sm font-semibold text-slate-900"
            : "mt-1 whitespace-pre-line text-sm text-slate-700"
        }
      >
        {value || "—"}
      </p>
    </div>
  );
}

function WrapLines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium tabular-nums text-slate-800">{value}</span>
    </div>
  );
}

/**
 * Circular green "PAYÉ" rubber stamp.
 *
 * Rendered as an inline-SVG <img> rather than bordered divs: html2canvas fills
 * CSS circular borders as solid discs (a known bug), whereas an <img> — even a
 * data-URI SVG with stroked circles and curved text — rasterises exactly as the
 * browser draws it, keeping the transparent centre.
 */
function buildStampSvg(label: string, date: string): string {
  const ink = "#15803d"; // green-700 — reads like stamp ink on white
  const size = 220;
  const c = size / 2;
  const centerFont = label.length <= 4 ? 46 : label.length <= 6 ? 34 : 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <path id="topArc" d="M ${c - 72} ${c} A 72 72 0 0 1 ${c + 72} ${c}"/>
    <path id="botArc" d="M ${c - 62} ${c + 6} A 62 62 0 0 0 ${c + 62} ${c + 6}"/>
  </defs>
  <g transform="rotate(-14 ${c} ${c})" fill="${ink}" font-family="Arial, Helvetica, sans-serif">
    <circle cx="${c}" cy="${c}" r="98" fill="none" stroke="${ink}" stroke-width="5"/>
    <circle cx="${c}" cy="${c}" r="85" fill="none" stroke="${ink}" stroke-width="2"/>
    <text font-size="15" font-weight="700" letter-spacing="4">
      <textPath href="#topArc" startOffset="50%" text-anchor="middle">PAIEMENT</textPath>
    </text>
    <text x="${c}" y="${c + centerFont * 0.34}" font-size="${centerFont}" font-weight="900" letter-spacing="1" text-anchor="middle">${label}</text>
    <text font-size="13" font-weight="700" letter-spacing="2">
      <textPath href="#botArc" startOffset="50%" text-anchor="middle">${date}</textPath>
    </text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function PaidStamp({ label, date }: { label: string; date: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline SVG data-URI
    <img
      src={buildStampSvg(label, date)}
      alt=""
      aria-hidden
      className="pointer-events-none absolute bottom-24 right-10 z-10 size-32 select-none"
      style={{ opacity: 0.9 }}
    />
  );
}

/** The issuer's signature sitting above a baseline, with its caption. */
function SignatureMark({ signature, label }: { signature: string; label: string }) {
  return (
    <div className="w-52 text-center">
      <div className="flex h-16 items-end justify-center pb-1">
        {signature && (
          // eslint-disable-next-line @next/next/no-img-element -- data-URL, must print
          <img src={signature} alt="Signature" className="max-h-16 w-auto object-contain" />
        )}
      </div>
      <div className="border-b border-slate-300" />
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
