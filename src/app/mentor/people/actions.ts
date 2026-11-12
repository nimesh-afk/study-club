"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteState = {
  message: string;
  isError: boolean;
};

const ROLES = ["student", "parent", "mentor", "admin"] as const;
type InviteRole = (typeof ROLES)[number];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): InviteState {
  return { message, isError: true };
}

// Adds a person: creates their login, their profile, and any links.
// Admin only. Nothing is emailed; they log in at the site with their email.
export async function inviteMember(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  // 1. Only admins. Checked on the server every time.
  await requireRole(["admin"]);

  // 2. Read and check every field. Never trust the form.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as InviteRole;
  const yearLevelRaw = String(formData.get("year_level") ?? "");
  const consent = formData.get("guardian_consent") === "yes";
  const linkIds = formData
    .getAll("link_ids")
    .map(String)
    .filter((id) => UUID_PATTERN.test(id));

  if (!EMAIL_PATTERN.test(email) || email.length > 254)
    return fail("Please enter a valid email address.");
  if (displayName.length < 1 || displayName.length > 60)
    return fail("Name must be 1 to 60 characters. A first name is enough.");
  if (!ROLES.includes(role)) return fail("Please choose a role.");

  let yearLevel: number | null = null;
  if (role === "student") {
    yearLevel = Number(yearLevelRaw);
    if (!Number.isInteger(yearLevel) || yearLevel < 7 || yearLevel > 12)
      return fail("Please choose the student's year level.");
    if (!consent)
      return fail(
        "A parent or guardian must agree before a student can be added.",
      );
  }

  const admin = createAdminClient();

  // 3. Check the people we're linking to exist and have the right role.
  //    Students link to parents/mentors; parents/mentors link to students.
  let links: { student_id: string; linked_user_id: string; relationship: "parent" | "mentor" }[] = [];
  if (linkIds.length > 0) {
    if (role === "admin") return fail("Admins aren't linked to students.");
    const wantRoles = role === "student" ? ["parent", "mentor"] : ["student"];
    const { data: targets, error } = await admin
      .from("profiles")
      .select("id, role")
      .in("id", linkIds);
    if (error) return fail("Couldn't check the people to link. Please try again.");
    if (!targets || targets.length !== linkIds.length || targets.some((t) => !wantRoles.includes(t.role)))
      return fail("One of the selected people can't be linked like that.");
    // Filled in below once we know the new person's id.
    links = targets.map((t) => ({
      student_id: t.id,
      linked_user_id: t.id,
      relationship: (role === "student" ? t.role : role) as "parent" | "mentor",
    }));
  }

  // 4. Create the login (no email is sent; they're already "confirmed").
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const taken = createError?.message?.toLowerCase().includes("already");
    return fail(
      taken
        ? "Someone with that email is already a member."
        : "Couldn't create the login. Please try again.",
    );
  }
  const newId = created.user.id;

  // 5. Create the profile. If anything fails, remove the login again so we
  //    never leave a half-made account behind.
  const { error: profileError } = await admin.from("profiles").insert({
    id: newId,
    role,
    display_name: displayName,
    year_level: yearLevel,
    guardian_consent_at: role === "student" ? new Date().toISOString() : null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(newId);
    return fail("Couldn't save their details. Nothing was created; please try again.");
  }

  // 6. Create the links.
  if (links.length > 0) {
    const rows = links.map((l) =>
      role === "student"
        ? { student_id: newId, linked_user_id: l.linked_user_id, relationship: l.relationship }
        : { student_id: l.student_id, linked_user_id: newId, relationship: l.relationship },
    );
    const { error: linkError } = await admin.from("student_links").insert(rows);
    if (linkError) {
      await admin.auth.admin.deleteUser(newId); // profile is removed with it
      return fail("Couldn't link them. Nothing was created; please try again.");
    }
  }

  revalidatePath("/mentor/people");
  return {
    message: `${displayName} has been added. They can now log in at the Study Club website with ${email}.`,
    isError: false,
  };
}
