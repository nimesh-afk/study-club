"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPages, SOURCE_RANK } from "@/lib/extraction/pdf";
import { splitIntoChunks } from "@/lib/extraction/split";

export type RecordState = { message: string; isError: boolean };

const TYPES = ["syllabus", "textbook", "notes"] as const;
type SourceType = (typeof TYPES)[number];
// Must match the path the upload form creates: <SUBJECT CODE>/<random id>.pdf
const PATH_PATTERN =
  /^[A-Z0-9]{2,12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

function fail(message: string): RecordState {
  return { message, isError: true };
}

// Step 2 of an upload: the browser has already put the PDF in the private
// "sources" bucket. Check it's really there, then record it in source_documents.
// Uses the mentor's own session, so RLS applies (CLAUDE.md 6.2).
export async function recordUpload(input: {
  subjectId: string;
  storagePath: string;
  title: string;
  type: string;
}): Promise<RecordState> {
  const profile = await requireRole(["mentor", "admin"]);
  const supabase = await createClient();

  const title = input.title.trim();
  const type = input.type as SourceType;
  if (title.length < 1 || title.length > 200)
    return fail("Title must be 1 to 200 characters.");
  if (!TYPES.includes(type)) return fail("Please choose a document type.");
  if (!PATH_PATTERN.test(input.storagePath)) return fail("Upload path not recognised.");

  const { data: subject } = await supabase
    .from("subjects")
    .select("id, code, current_study_design_version")
    .eq("id", input.subjectId)
    .maybeSingle();
  if (!subject) return fail("Subject not found.");
  if (!input.storagePath.startsWith(`${subject.code}/`))
    return fail("Upload path doesn't match the subject.");

  // Is the file really in the bucket?
  const [folder, fileName] = input.storagePath.split("/");
  const { data: found } = await supabase.storage
    .from("sources")
    .list(folder, { search: fileName, limit: 1 });
  if (!found || found.length === 0) return fail("The uploaded file wasn't found. Please try again.");

  const { error } = await supabase.from("source_documents").insert({
    subject_id: subject.id,
    type,
    title,
    study_design_version: subject.current_study_design_version,
    storage_path: input.storagePath,
    uploaded_by: profile.id,
  });
  if (error) {
    // Don't leave an orphan file behind.
    await supabase.storage.from("sources").remove([input.storagePath]);
    return fail("Couldn't save the document record. Please try again.");
  }

  revalidatePath("/mentor/sources");
  return { message: `Uploaded “${title}”.`, isError: false };
}

export type ExtractState = { message: string; isError: boolean };

// Step 3: read the PDF's text, split it into chunks and save them.
// No AI is used, so this costs nothing. Mentors only. Chunks are written with
// the admin client: ingestion is a server-only job (CLAUDE.md 6.2).
export async function extractDocument(
  _previous: ExtractState,
  formData: FormData,
): Promise<ExtractState> {
  await requireRole(["mentor", "admin"]);
  const documentId = String(formData.get("document_id") ?? "");

  // Read the document through the mentor's own session (RLS applies).
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("source_documents")
    .select("id, type, status, storage_path, study_design_version")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { message: "Document not found.", isError: true };
  if (doc.status === "extracted") return { message: "Already extracted.", isError: false };

  const admin = createAdminClient();
  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from("sources")
      .download(doc.storage_path);
    if (downloadError || !file) throw new Error("download failed");

    const pages = await extractPages(new Uint8Array(await file.arrayBuffer()));
    const chunks = splitIntoChunks(pages);
    if (chunks.length === 0) throw new Error("no text found");

    // A failed earlier attempt may have left some chunks: start clean.
    const { error: clearError } = await admin.from("chunks").delete().eq("document_id", doc.id);
    if (clearError) throw new Error("clear failed");

    const rows = chunks.map((c) => ({
      document_id: doc.id,
      seq: c.seq,
      heading: c.heading,
      page_start: c.pageStart,
      page_end: c.pageEnd,
      text: c.text,
      source_rank: SOURCE_RANK[doc.type] ?? 4,
      study_design_version: doc.study_design_version,
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await admin.from("chunks").insert(rows.slice(i, i + 50));
      if (error) throw new Error("insert failed");
    }

    const { error: updateError } = await admin
      .from("source_documents")
      .update({ status: "extracted", page_count: pages.length })
      .eq("id", doc.id);
    if (updateError) throw new Error("status update failed");

    revalidatePath("/mentor/sources");
    return {
      message: `Done: ${pages.length} pages split into ${chunks.length} sections.`,
      isError: false,
    };
  } catch (error) {
    await admin.from("source_documents").update({ status: "failed" }).eq("id", doc.id);
    revalidatePath("/mentor/sources");
    // Log only the step that failed, never document text (CLAUDE.md 6.1, 5.5).
    console.error("extraction failed", error instanceof Error ? error.message : "unknown");
    return { message: "Extraction failed. You can try again.", isError: true };
  }
}
