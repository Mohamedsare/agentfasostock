/**
 * Client-side PDF export for E_Fact.
 *
 * Clicking "Télécharger" must drop a real .pdf on the user's device — no print
 * dialog. We rasterise the already-styled #efact-document to a high-resolution
 * canvas and place it into an A4 jsPDF, slicing across pages when the document
 * is taller than one page. `html2canvas-pro` is used (not the original) because
 * it understands the modern `oklch()` colours Tailwind v4 emits.
 *
 * Both libraries are heavy and browser-only, so they're imported dynamically —
 * they never touch the SSR bundle and only load when the user actually exports.
 */
export async function downloadDocumentPdf(filename: string): Promise<void> {
  const el = document.getElementById("efact-document");
  if (!el) throw new Error("Document introuvable");

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(el, {
    scale: Math.min(3, (window.devicePixelRatio || 1) * 2),
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24; // pt — a small, even border around the page

  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL("image/png");

  const usableH = pageH - margin * 2;

  if (imgH <= usableH) {
    pdf.addImage(imgData, "PNG", margin, margin, imgW, imgH);
  } else {
    // Taller than one page: place the full image and shift it up per page.
    let heightLeft = imgH;
    let position = margin;
    pdf.addImage(imgData, "PNG", margin, position, imgW, imgH);
    heightLeft -= usableH;
    while (heightLeft > 0) {
      position = margin - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, imgW, imgH);
      heightLeft -= usableH;
    }
  }

  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
