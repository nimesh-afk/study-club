// Reads the text of every page of a PDF. No AI involved (costs nothing).
// Server code only. A 955-page textbook takes about 10 seconds.
import { extractText, getDocumentProxy } from "unpdf";

export async function extractPages(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

// Higher authority = lower number (CLAUDE.md 5.1). Stored on each chunk so
// retrieval can order sources without looking up the document.
export const SOURCE_RANK: Record<string, number> = {
  syllabus: 1, // Victorian Curriculum / VCE study design
  examiner_report: 2,
  textbook: 2, // Year 8 has no examiner reports, so the textbook comes next
  past_exam: 3,
  notes: 4,
};
