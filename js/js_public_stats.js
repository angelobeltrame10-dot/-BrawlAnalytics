import { getSupabaseClient } from "./js_supabase_client.js";

function formatK(n){
    n = Number(n) || 0;
    return n >= 1000 ? `${(n/1000).toFixed(1).replace(".0","")}K+` : `${n}+`;
}

export async function loadPublicStats(){

    const el = document.getElementById("stat-creators");
    if(!el) return; // sezione non presente in questa pagina

    try{
        const supabase = await getSupabaseClient();
        if(!supabase) return;

        const { data, error } = await supabase
            .from("public_stats")
            .select("*")
            .eq("id", 1)
            .maybeSingle();

        if(error || !data) return;

        document.getElementById("stat-creators").textContent = formatK(data.total_creators);
        document.getElementById("stat-videos").textContent = formatK(data.total_videos_analyzed);
        document.getElementById("stat-ideas").textContent = formatK(data.total_ideas_generated);
        document.getElementById("stat-feedback").textContent = `${data.positive_feedback_percentage}%`;

    }
    catch(error){
        console.error("Public stats error:", error);
    }

}