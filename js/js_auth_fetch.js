import { getSupabaseClient } from "./js_supabase_client.js";

export async function getAuthHeaders(extra = {}) {
    const supabase = await getSupabaseClient();
    if (!supabase) return extra;

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}