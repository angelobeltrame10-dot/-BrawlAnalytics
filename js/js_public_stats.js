import { getSupabaseClient } from "./js_supabase_client.js";

/*
    Formattazione "a soglie" per i numeri pubblici in home page.

    Regole (early-stage friendly):
    - sotto 100  → numero esatto, NIENTE "+" (es. 4, 37, 99)
    - 100–999    → arrotondato per difetto al centinaio, con "+"
                   (es. 160 → "100+", 245 → "200+", 999 → "900+")
    - 1.000–999.999 → arrotondato per difetto al migliaio, formato "K+"
                   (es. 1500 → "1K+", 12345 → "12K+")
    - ≥ 1.000.000 → arrotondato per difetto al milione, formato "M+"
                   (es. 2.400.000 → "2M+")

    Così il numero mostrato non "mente mai per eccesso": un "100+"
    garantisce che ci sono ALMENO 100 unità reali, e sale allo scatto
    successivo (200+, poi 1K+...) solo quando la soglia è davvero
    superata — evita di mostrare "4+" quando i creator sono 4.
*/
function formatStat(value){

    const n = Math.max(0, Math.floor(Number(value) || 0));

    if(n < 100){
        return `${n}`;
    }

    if(n < 1000){
        const rounded = Math.floor(n / 100) * 100;
        return `${rounded}+`;
    }

    if(n < 1000000){
        const rounded = Math.floor(n / 1000) * 1000;
        return `${rounded / 1000}K+`;
    }

    const rounded = Math.floor(n / 1000000) * 1000000;
    return `${rounded / 1000000}M+`;

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

        document.getElementById("stat-creators").textContent = formatStat(data.total_creators);
        document.getElementById("stat-videos").textContent = formatStat(data.total_videos_analyzed);
        document.getElementById("stat-ideas").textContent = formatStat(data.total_ideas_generated);
        document.getElementById("stat-feedback").textContent = `${data.positive_feedback_percentage}%`;

    }
    catch(error){
        console.error("Public stats error:", error);
    }

}