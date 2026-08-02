/* ==========================================================
   BRAWL ANALYTICS
   STORAGE MANAGER — Supabase (non più localStorage)
========================================================== */

import { getSupabaseClient } from "./js_supabase_client.js";

let cache = {
    loaded: false,
    videos: [],
    customFormats: [],
    channelProfile: null
};

async function getUserId(supabase) {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
}

async function loadChannelData() {

    if (cache.loaded) {
        return cache;
    }

    try {

        const supabase = await getSupabaseClient();
        if (!supabase) {
            cache.loaded = true;
            return cache;
        }

        const userId = await getUserId(supabase);
        if (!userId) {
            cache.loaded = true;
            return cache;
        }

        const { data, error } = await supabase
            .from("channel_data")
            .select("videos, custom_formats, channel_profile")
            .eq("user_id", userId)
            .maybeSingle();

        if (!error && data) {
            cache.videos = Array.isArray(data.videos) ? data.videos : [];
            cache.customFormats = Array.isArray(data.custom_formats) ? data.custom_formats : [];
            cache.channelProfile = data.channel_profile || null;
        }

    } catch (error) {
        console.error("Storage: loadChannelData failed.", error);
    }

    cache.loaded = true;
    return cache;

}

async function persistChannelData() {

    try {

        const supabase = await getSupabaseClient();
        if (!supabase) return false;

        const userId = await getUserId(supabase);
        if (!userId) return false;

        const { error } = await supabase
            .from("channel_data")
            .upsert({
                user_id: userId,
                videos: cache.videos,
                custom_formats: cache.customFormats,
                channel_profile: cache.channelProfile,
                updated_at: new Date().toISOString()
            });

        if (error) {
            console.error("Storage: persistChannelData failed.", error);
            return false;
        }

        return true;

    } catch (error) {
        console.error("Storage: persistChannelData failed.", error);
        return false;
    }

}

/* ---------- Dashboard data (video CSV) ---------- */

export async function saveDashboardData(data) {
    await loadChannelData();
    cache.videos = data == null ? cache.videos : (Array.isArray(data) ? data : []);
    return persistChannelData();
}

export async function loadDashboardData() {
    const data = await loadChannelData();
    return [...data.videos];
}

export async function clearDashboardData() {
    await loadChannelData();
    cache.videos = [];
    return persistChannelData();
}

/* ---------- Custom formats ---------- */

export async function saveCustomFormats(formats) {
    await loadChannelData();
    cache.customFormats = Array.isArray(formats) ? formats : [];
    return persistChannelData();
}

export async function loadCustomFormats() {
    const data = await loadChannelData();
    return [...data.customFormats];
}

export async function clearCustomFormats() {
    await loadChannelData();
    cache.customFormats = [];
    return persistChannelData();
}

/* ---------- Channel profile ---------- */

export async function saveChannelProfile(profile) {
    await loadChannelData();
    cache.channelProfile = profile;
    return persistChannelData();
}

export async function loadChannelProfile() {
    const data = await loadChannelData();
    return data.channelProfile || null;
}

export async function clearChannelProfile() {
    await loadChannelData();
    cache.channelProfile = null;
    return persistChannelData();
}

/* ---------- Generated ideas (per-day cache, NON rigenerate al refresh) ---------- */

export async function saveGeneratedIdeas(ideas, topFormat) {

    try {

        const supabase = await getSupabaseClient();
        if (!supabase) return false;

        const userId = await getUserId(supabase);
        if (!userId) return false;

        const today = new Date().toISOString().slice(0, 10);

        const { error } = await supabase
            .from("generated_ideas")
            .upsert({
                user_id: userId,
                idea_date: today,
                ideas,
                top_format: topFormat,
                updated_at: new Date().toISOString()
            });

        if (error) {
            console.error("Storage: saveGeneratedIdeas failed.", error);
            return false;
        }

        return true;

    } catch (error) {
        console.error("Storage: saveGeneratedIdeas failed.", error);
        return false;
    }

}

export async function loadGeneratedIdeas() {

    try {

        const supabase = await getSupabaseClient();
        if (!supabase) return null;

        const userId = await getUserId(supabase);
        if (!userId) return null;

        const today = new Date().toISOString().slice(0, 10);

        const { data, error } = await supabase
            .from("generated_ideas")
            .select("ideas, top_format")
            .eq("user_id", userId)
            .eq("idea_date", today)
            .maybeSingle();

        if (error || !data) return null;

        // Handle both old format (array of strings) and new format (array of objects with text/format)
        const ideas = data.ideas || [];
        const normalizedIdeas = ideas.map(idea => {
            if (typeof idea === 'string') {
                return { text: idea, format: data.top_format || null };
            }
            return idea;
        });

        return { ideas: normalizedIdeas, topFormat: data.top_format || null };

    } catch (error) {
        console.error("Storage: loadGeneratedIdeas failed.", error);
        return null;
    }

}

/*
    Va chiamata al logout: la cache in memoria non deve
    sopravvivere al cambio utente nella stessa tab.
*/
export function resetStorageCache() {
    cache = { loaded: false, videos: [], customFormats: [], channelProfile: null };
}