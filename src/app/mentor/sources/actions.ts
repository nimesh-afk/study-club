"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
