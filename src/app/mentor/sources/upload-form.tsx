"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordUpload } from "./actions";

export type SubjectOption = { id: string; code: string; name: string };

const MAX_BYTES = 50 * 1024 * 1024; // Supabase free plan limit, also set on the bucket
const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-zinc-900";

// Uploads a PDF straight from the browser to the private "sources" bucket
// (Vercel can't accept large files), then asks the server to record it.
export function UploadForm({ subjects }: { subjects: SubjectOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const subject = subjects.find((s) => s.id === data.get("subject_id"));

    if (!(file instanceof File) || file.size === 0)
      return setStatus({ message: "Please choose a PDF.", isError: true });
    if (file.type !== "application/pdf")
      return setStatus({ message: "Only PDF files can be uploaded.", isError: true });
    if (file.size > MAX_BYTES)
      return setStatus({ message: "That PDF is over 50 MB. Split it into parts first.", isError: true });
    if (!subject) return setStatus({ message: "Please choose a subject.", isError: true });

    setBusy(true);
    setStatus({ message: "Uploading… large files can take a minute.", isError: false });

    const storagePath = `${subject.code}/${crypto.randomUUID()}.pdf`;
    const supabase = createClient();
    const { error } = await supabase.storage
      .from("sources")
      .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
    if (error) {
      setBusy(false);
      return setStatus({ message: "Upload failed. Please try again.", isError: true });
    }

    const result = await recordUpload({
      subjectId: subject.id,
      storagePath,
      title: String(data.get("title") ?? ""),
      type: String(data.get("type") ?? ""),
    });
    setBusy(false);
    setStatus(result);
    if (!result.isError) {
      form.reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Subject
          <select name="subject_id" className={inputClass}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Type
          <select name="type" defaultValue="textbook" className={inputClass}>
            <option value="syllabus">Curriculum / study design</option>
            <option value="textbook">Textbook</option>
            <option value="notes">Mentor notes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Title
          <input
            name="title"
            required
            maxLength={200}
            placeholder="e.g. Essential Mathematics 8 (3rd edition)"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          PDF (up to 50 MB)
          <input name="file" type="file" accept="application/pdf" required className={inputClass} />
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>
      {status && (
        <p role="status" className={status.isError ? "text-red-700" : "text-green-700"}>
          {status.message}
        </p>
      )}
    </form>
  );
}
