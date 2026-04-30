import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { CallRecord, ActionItem } from "@workspace/db";

const RED = "#dc2626";
const INK = "#0a0a0a";
const MUTED = "#525252";
const RULE = "#e5e5e5";

export function streamCallPdf(
  res: Response,
  call: CallRecord,
  actionItems: ActionItem[],
): void {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: `CallCommand Report — ${call.originalFilename}`,
      Author: "CallCommand AI",
    },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="callcommand-${call.id}.pdf"`,
  );
  doc.pipe(res);

  // Header bar
  doc.rect(0, 0, doc.page.width, 6).fill(RED);
  doc.fillColor(INK);

  doc
    .fillColor(RED)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("CALLCOMMAND AI", 56, 24, { characterSpacing: 1.5 });
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(
      `Generated ${new Date().toLocaleString()}`,
      56,
      24,
      { align: "right" },
    );

  doc.moveDown(2);
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(call.originalFilename || "Call Record");

  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(10)
    .text(
      `Status: ${call.status}   |   Priority: ${call.priority ?? "—"}   |   Sentiment: ${call.sentiment ?? "—"}${call.isDemo === "true" ? "   |   DEMO" : ""}`,
    );

  doc.moveDown(0.6);
  hr(doc);

  metaBlock(doc, [
    ["Customer", call.customerName],
    ["Company", call.companyName],
    ["Phone", call.callerPhone],
    ["Call Type", call.callType],
    ["Intent", call.intent],
    [
      "Duration",
      call.durationSeconds != null
        ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`
        : null,
    ],
  ]);

  section(doc, "Summary");
  doc.font("Helvetica").fontSize(11).fillColor(INK);
  doc.text(call.summary || "No summary available.");

  if (call.keyPoints && call.keyPoints.length > 0) {
    section(doc, "Key Points");
    doc.font("Helvetica").fontSize(11).fillColor(INK);
    for (const kp of call.keyPoints) {
      doc.text(`•  ${kp}`, { indent: 0 });
    }
  }

  if (actionItems.length > 0) {
    section(doc, "Action Items");
    for (const ai of actionItems) {
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(INK)
        .text(`[${ai.status.toUpperCase()}]  ${ai.title}`);
      if (ai.description) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(MUTED)
          .text(ai.description, { indent: 14 });
      }
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor(MUTED)
        .text(
          `priority: ${ai.priority}${ai.dueDate ? `   |   due ${new Date(ai.dueDate).toLocaleString()}` : ""}`,
          { indent: 14 },
        );
      doc.moveDown(0.4);
    }
  }

  if (call.followUpMessage) {
    section(doc, "Suggested Follow-Up Message");
    doc
      .font("Helvetica-Oblique")
      .fontSize(11)
      .fillColor(INK)
      .text(call.followUpMessage);
  }

  if (call.internalNotes) {
    section(doc, "Internal Notes");
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor(INK)
      .text(call.internalNotes);
  }

  if (call.suggestedTags && call.suggestedTags.length > 0) {
    section(doc, "Tags");
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(call.suggestedTags.join("   ·   "));
  }

  if (call.transcriptText) {
    section(doc, "Transcript");
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(INK)
      .text(call.transcriptText, { lineGap: 2 });
  }

  doc.end();
}

function hr(doc: PDFKit.PDFDocument): void {
  const y = doc.y + 4;
  doc
    .save()
    .moveTo(56, y)
    .lineTo(doc.page.width - 56, y)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke()
    .restore();
  doc.moveDown(0.8);
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.8);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(RED)
    .text(title.toUpperCase(), { characterSpacing: 1.2 });
  doc.moveDown(0.3);
}

function metaBlock(
  doc: PDFKit.PDFDocument,
  rows: Array<[string, string | null | undefined]>,
): void {
  doc.moveDown(0.4);
  for (const [k, v] of rows) {
    if (!v) continue;
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(MUTED)
      .text(k.toUpperCase(), { continued: true, characterSpacing: 1 })
      .font("Helvetica")
      .fontSize(11)
      .fillColor(INK)
      .text(`   ${v}`);
  }
}
