"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MAX_NOTES_PHOTOS } from "@/lib/notes/decide";
import { submitNotes } from "./actions";

const MAX_SIDE = 1600; // pixels: plenty for reading handwriting, small to upload

// Shrinks a photo to at most 1600 px on its longest side and re-saves it as
// JPEG. Also drops the photo's hidden details (location, camera).
async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))), "image/jpeg", 0.85),
  );
}

export function NotesUpload({ studentId, objectiveId }: { studentId: string; objectiveId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) return setStatus({ message: "Add at least one photo.", isError: true });
    if (files.length > MAX_NOTES_PHOTOS)
      return setStatus({ message: `At most ${MAX_NOTES_PHOTOS} photos.`, isError: true });

    setBusy(true);
    setStatus({ message: "Uploading your photos…", isError: false });
    const supabase = createClient();
    const paths: string[] = [];
    try {
      for (const file of files) {
        const blob = await shrinkPhoto(file);
        const path = `${studentId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage
          .from("notes")
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error("upload failed");
        paths.push(path);
      }
    } catch {
      setBusy(false);
      return setStatus({ message: "A photo didn't upload. Please try again.", isError: true });
    }

    setStatus({ message: "The AI is reading your notes… (up to a minute)", isError: false });
    const result = await submitNotes({ objectiveId, photoPaths: paths });
    setBusy(false);
    setStatus(result);
    if (!result.isError) {
      setFiles([]);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Photos of your handwritten notes (up to {MAX_NOTES_PHOTOS})
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="rounded-lg border border-zinc-300 px-3 py-2.5 text-base"
        />
      </label>
      <p className="text-sm text-zinc-600">
        Photograph only your notes: no faces, names or anything personal. Photos are private to you
        and your mentors and are deleted after 30 days.
      </p>
      {files.length > 0 && <p className="text-sm">{files.length} photo{files.length > 1 ? "s" : ""} chosen</p>}
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Working…" : "Send my notes"}
      </button>
      {status && (
        <p role="status" className={status.isError ? "text-red-700" : "text-green-700"}>
          {status.message}
        </p>
      )}
    </form>
  );
}
