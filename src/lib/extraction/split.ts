// Splits a PDF's page texts into chunks (CLAUDE.md 5.3). Pure functions, no I/O.
//
// Textbooks: one chunk per textbook section (e.g. "3C Operations with negative
// fractions"), plus chapter openers (with their curriculum codes), chapter
// reviews, progress quizzes and so on. Answers are kept (useful for marking
// later); front matter and the index are dropped.
// Anything else (e.g. the curriculum): chunks of a few pages each.
//
// Long chunks are split at page boundaries so the AI only ever gets a
// small, relevant piece (never a whole document).

export type Chunk = {
  seq: number; // 1, 2, 3 ... in document order
  heading: string; // e.g. "3C Operations with negative fractions (part 2)"
  pageStart: number; // PDF page numbers, 1-based
  pageEnd: number;
  text: string;
};

const MAX_CHUNK_CHARS = 12_000; // about 3,000 tokens
const PAGES_PER_PLAIN_CHUNK = 3;

// Section code like "3C" or "10F", followed by its title.
const SECTION_LINE = /^(\d{1,2}[A-Z])\s+(.{3,})$/;
const CURRICULUM_CODE = /VC2M\d+[A-Z]{1,2}\d{2}/g;

// Headings of textbook pages that aren't a lettered section.
const BLOCK_NAMES = [
  "Chapter review",
  "Chapter checklist",
  "Chapter summary",
  "Progress quiz",
  "Applications and problem-solving",
  "Technology and computational thinking",
  "Modelling",
  "Investigation",
  "Problems and challenges",
  "Semester review 1",
  "Semester review 2",
];

// Undo PDF quirks: ligatures (ﬁ, ﬂ) and the gaps they leave ("Refl ection").
export function cleanText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/(fi|fl) (?=[a-z])/g, "$1")
    .replace(/[ \t]+\n/g, "\n");
}

// Remove long lines that repeat on many pages (copyright footers, running titles).
// Short lines ("a", "1", "FLUENCY") are kept: they're part of the exercises.
export function stripBoilerplate(pages: string[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const line of new Set(page.split("\n").map((l) => l.trim()))) {
      if (line.length >= 30) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, pages.length * 0.3);
  return pages.map((page) =>
    page
      .split("\n")
      .filter((line) => (counts.get(line.trim()) ?? 0) < threshold)
      .join("\n")
      .trim(),
  );
}

// The printed page number is usually PDF page minus a fixed offset (front matter).
function findPageOffset(pages: string[]): number | null {
  const offsets = new Map<number, number>();
  pages.forEach((page, i) => {
    const first = page.split("\n", 1)[0].trim();
    const match = first.match(/^(\d{1,4})/) ?? first.match(/(\d{1,4})$/);
    if (match) {
      const offset = i + 1 - Number(match[1]);
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
  });
  let best: number | null = null;
  let bestCount = 0;
  for (const [offset, count] of offsets) {
    if (count > bestCount) [best, bestCount] = [offset, count];
  }
  // Trust it only if most pages agree.
  return bestCount > pages.length * 0.5 ? best : null;
}

// The page's own heading: its first line without the printed page number.
function pageHeading(page: string, printedPage: number | null): string {
  let first = page.split("\n", 1)[0].trim();
  if (printedPage !== null) {
    const n = String(printedPage);
    if (first.startsWith(n)) first = first.slice(n.length).trim();
    else if (first.endsWith(n)) first = first.slice(0, -n.length).trim();
  }
  return first;
}

function isSectionHeading(line: string, known: Map<string, string>): string | null {
  const match = line.match(SECTION_LINE);
  return match && known.has(match[1]) ? match[1] : null;
}

// Section codes and titles, from the "Chapter contents" pages.
function knownSections(pages: string[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const page of pages) {
    if (!page.startsWith("Chapter contents")) continue;
    const lines = page.split("\n").slice(1).map((l) => l.trim());
    lines.forEach((line, i) => {
      const match = line.match(SECTION_LINE);
      if (!match || known.has(match[1])) return;
      let title = match[2];
      // Titles can wrap onto the next line ("... recurring decimals" / "and rounding").
      const next = lines[i + 1] ?? "";
      if (/^[a-z(]/.test(next)) title += " " + next;
      known.set(match[1], title.replace(/\s*\(?(CONSOLIDATING|EXTENDING)\)?/g, "").trim());
    });
  }
  return known;
}

type Labelled = { label: string | null; page: number; text: string };

function labelTextbookPages(pages: string[], known: Map<string, string>): Labelled[] {
  const offset = findPageOffset(pages);
  let label: string | null = null; // null = skip (front matter, index)
  let chapter = 0;

  return pages.map((text, i) => {
    const printed = offset === null ? null : i + 1 - offset;
    const heading = pageHeading(text, printed);
    const firstLines = text.split("\n").slice(0, 4).map((l) => l.trim());

    if (text.startsWith("Chapter contents")) {
      const firstSection = text.split("\n").map((l) => l.trim().match(SECTION_LINE)).find(Boolean);
      chapter = firstSection ? parseInt(firstSection[1], 10) : chapter + 1;
      label = `Chapter ${chapter} opener`;
    } else if (/^Answers\b/.test(heading) || /^Answers\b/.test(text)) {
      label = "Answers";
    } else if (/^Index\b/.test(heading)) {
      label = null;
    } else {
      const section =
        isSectionHeading(heading, known) ??
        firstLines.map((l) => isSectionHeading(l, known)).find(Boolean) ??
        null;
      const block = BLOCK_NAMES.find(
        (name) => heading.startsWith(name) || firstLines.some((l) => l === name),
      );
      if (chapter === 0) label = null; // front matter: guides, contents
      else if (section) label = `${section} ${known.get(section)}`;
      else if (block) {
        label = block.startsWith("Semester")
          ? block
          : `Chapter ${chapter} ${block.replace(/^Chapter /, "").toLowerCase()}`;
      }
    }
    return { label, page: i + 1, text };
  });
}

function groupIntoChunks(labelled: Labelled[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: { heading: string; pages: Labelled[] } | null = null;

  const flush = () => {
    if (!current) return;
    // Split long groups at page boundaries.
    const parts: Labelled[][] = [];
    let part: Labelled[] = [];
    let size = 0;
    for (const page of current.pages) {
      if (part.length > 0 && size + page.text.length > MAX_CHUNK_CHARS) {
        parts.push(part);
        part = [];
        size = 0;
      }
      part.push(page);
      size += page.text.length;
    }
    if (part.length) parts.push(part);
    parts.forEach((p, n) => {
      const text = p.map((x) => x.text).join("\n\n").trim();
      if (!text) return;
      chunks.push({
        seq: chunks.length + 1,
        heading: parts.length > 1 ? `${current!.heading} (part ${n + 1})` : current!.heading,
        pageStart: p[0].page,
        pageEnd: p[p.length - 1].page,
        text,
      });
    });
    current = null;
  };

  for (const page of labelled) {
    if (page.label === null) {
      flush();
      continue;
    }
    if (!current || current.heading !== page.label) {
      flush();
      current = { heading: page.label, pages: [] };
    }
    current.pages.push(page);
  }
  flush();
  return chunks;
}

// Main entry point: page texts in, chunks out.
export function splitIntoChunks(rawPages: string[]): Chunk[] {
  const pages = stripBoilerplate(rawPages.map(cleanText));
  const known = knownSections(pages);

  if (known.size >= 5) {
    return groupIntoChunks(labelTextbookPages(pages, known));
  }

  // Not a textbook we recognise: a few pages per chunk.
  const labelled: Labelled[] = pages.map((text, i) => ({
    label: `Pages ${i - (i % PAGES_PER_PLAIN_CHUNK) + 1}–${Math.min(
      i - (i % PAGES_PER_PLAIN_CHUNK) + PAGES_PER_PLAIN_CHUNK,
      pages.length,
    )}`,
    page: i + 1,
    text,
  }));
  return groupIntoChunks(labelled);
}

// Curriculum codes mentioned in a chunk (e.g. on chapter openers).
export function curriculumCodes(text: string): string[] {
  return [...new Set(text.match(CURRICULUM_CODE) ?? [])].sort();
}
