import { createClient } from "@/lib/supabase/server";

// Checks that the server can reach the Supabase database.
// Shows only "connected" / "not connected": no keys, URLs or error details.
async function canReachDatabase(): Promise<boolean> {
  try {
    const supabase = await createClient();
    // We have no tables yet, so ask for one that doesn't exist.
    // PGRST205 ("table not found") means the API answered using the
    // database's schema, so the database is reachable and the key is valid.
    // A network failure or bad key gives a different error.
    const { error } = await supabase
      .from("status_check")
      .select("*")
      .limit(1);
    return !error || error.code === "PGRST205";
  } catch {
    return false;
  }
}

export default async function StatusPage() {
  const connected = await canReachDatabase();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Status</h1>
      <p className="mt-4 text-lg">
        Database: {connected ? "connected" : "not connected"}
      </p>
    </main>
  );
}
