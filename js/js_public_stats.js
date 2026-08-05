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

function animateCounter(element, targetValue, duration = 1500){
    
    const startValue = 0;
    const startTime = performance.now();
    const isPercentage = targetValue.toString().includes('%');
    const numericValue = isPercentage ? parseFloat(targetValue) : parseInt(targetValue.replace(/\D/g, ''));
    
    function update(currentTime){
        
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function for smooth animation
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(easeOutQuart * numericValue);
        
        if(isPercentage){
            element.textContent = `${currentValue}%`;
        } else {
            element.textContent = formatStat(currentValue);
        }
        
        if(progress < 1){
            requestAnimationFrame(update);
        } else {
            element.textContent = targetValue;
        }
        
    }
    
    requestAnimationFrame(update);
    
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

        const creatorsEl = document.getElementById("stat-creators");
        const videosEl = document.getElementById("stat-videos");
        const ideasEl = document.getElementById("stat-ideas");
        const feedbackEl = document.getElementById("stat-feedback");

        const creatorsValue = formatStat(data.total_creators);
        const videosValue = formatStat(data.total_videos_analyzed);
        const ideasValue = formatStat(data.total_ideas_generated);
        const feedbackValue = `${data.positive_feedback_percentage}%`;

        // Set up IntersectionObserver to trigger animation only when section is visible
        const statsBar = document.querySelector('.stats-bar');
        if(!statsBar) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if(entry.isIntersecting){
                    // Animate all stats with slight delays when section becomes visible
                    setTimeout(() => animateCounter(creatorsEl, creatorsValue, 1200), 100);
                    setTimeout(() => animateCounter(videosEl, videosValue, 1400), 200);
                    setTimeout(() => animateCounter(ideasEl, ideasValue, 1600), 300);
                    setTimeout(() => animateCounter(feedbackEl, feedbackValue, 1000), 400);
                    
                    // Stop observing after animation starts
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.3, // Trigger when 30% of the section is visible
            rootMargin: '0px 0px -50px 0px'
        });

        observer.observe(statsBar);

    }
    catch(error){
        console.error("Public stats error:", error);
    }

}