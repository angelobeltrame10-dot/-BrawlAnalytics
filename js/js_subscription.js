/* ==========================================================
   BRAWL ANALYTICS
   SUBSCRIPTION MODULE

   Punto UNICO di verità per piano utente e limiti giornalieri
   (Video Analysis / Idea Generator).

   Ogni controllo/consumo passa da una funzione RPC Supabase con
   "security definer": il client non può mai aggirare i limiti
   modificando questo file, perché lo stato qui sotto è solo una
   CACHE per la UI, non la fonte di verità — quella vive nel
   database (vedi sql_subscription_schema.sql). Il reset
   giornaliero è gestito dalla RPC stessa lavorando sempre su
   current_date: non serve nessun cron job.
========================================================== */

import { getSupabaseClient } from "./js_supabase_client.js";
import { showMessage } from "./js_ui.js";

const FREE_VIDEO_LIMIT = 1;
const FREE_IDEA_LIMIT = 3;

// Cache in memoria: popolata da loadUsageStatus() e aggiornata
// dopo ogni consumo riuscito, per evitare una query Supabase ad
// ogni singola domanda "quanti ne restano?" fatta dalla UI.
let state = {

    loaded: false,
    plan: "free",
    videoRemaining: FREE_VIDEO_LIMIT,
    ideaRemaining: FREE_IDEA_LIMIT

};

/*
    Avvia il modulo: recupera piano/utilizzi odierni una sola
    volta, prepara la Upgrade Modal nel DOM e aggiorna subito i
    badge. Va chiamata all'avvio della dashboard (initDashboard).
*/
export async function initSubscription(){

    await loadUsageStatus();
    injectUpgradeModal();
    refreshUsageIndicators();

}

/*
    Recupera lo stato corrente da Supabase (RPC get_usage_status).
*/
async function loadUsageStatus(){

    try{

        const supabase = await getSupabaseClient();

        if(!supabase){

            console.warn("Subscription: client Supabase non disponibile, uso i valori di default.");
            state.loaded = true;
            return;

        }

        const { data: { user } } = await supabase.auth.getUser();

        if(!user){

            console.warn("Subscription: nessun utente autenticato.");
            state.loaded = true;
            return;

        }

        const { data, error } = await supabase.rpc("get_usage_status");

        if(error || !data || !data[0]){

            console.error("Subscription: impossibile leggere gli utilizzi.", error);
            state.loaded = true;
            return;

        }

        applyStatusRow(data[0]);
        state.loaded = true;

    }
    catch(error){

        console.error("Subscription: loadUsageStatus fallita.", error);
        state.loaded = true;

    }

}

function applyStatusRow(row){

    state.plan = row.plan;
    state.videoRemaining = row.video_remaining;
    state.ideaRemaining = row.idea_remaining;

}

export function getCurrentPlan(){

    return state.plan;

}

export function getRemainingVideoAnalyses(){

    return state.plan === "pro" ? Infinity : Math.max(0, state.videoRemaining);

}

export function getRemainingIdeaGenerations(){

    return state.plan === "pro" ? Infinity : Math.max(0, state.ideaRemaining);

}

/*
    Controlli "leggeri" lato client (cache in memoria): utili solo
    per decisioni di UI immediate (es. disabilitare un bottone).
    NON sono la guardia di sicurezza — quella è sempre la RPC
    atomica chiamata da consumeVideoAnalysis()/consumeIdeaGeneration().
*/
export function canAnalyzeVideo(){

    return state.plan === "pro" || state.videoRemaining > 0;

}

export function canGenerateIdea(){

    return state.plan === "pro" || state.ideaRemaining > 0;

}

/*
    Verifica E consuma un utilizzo in un'UNICA chiamata atomica
    lato database (try_consume_usage) — niente "check poi consume"
    separati, che lascerebbero una finestra per aggirare il limite.
    Va chiamata SEMPRE prima di avviare la pipeline AI: se ritorna
    false, nessuna chiamata al Worker deve partire.
*/
async function consumeUsage(kind){

    try{

        const supabase = await getSupabaseClient();

        if(!supabase){
            console.error(`Subscription: client Supabase non disponibile (${kind}).`);
            showMessage("Connection error. Please try again.");
            return false;
        }

        const { data, error } = await supabase.rpc("try_consume_usage", { p_kind: kind });

        if(error || !data || !data[0]){
            console.error(`Subscription: verifica utilizzo (${kind}) fallita.`, error);
            showMessage("Unable to verify usage. Please try again.");
            return false;
        }

        const row = data[0];

        state.plan = row.plan;

        const remaining = row.plan === "pro" ? Infinity : row.remaining;

        if(kind === "video_analysis"){
            state.videoRemaining = remaining;
        }
        else{
            state.ideaRemaining = remaining;
        }

        refreshUsageIndicators();

        // La modal Upgrade compare SOLO quando la RPC dice esplicitamente
        // "non permesso" (quota a 0), MAI per un errore tecnico.
        if(!row.allowed){
            openUpgradeModal();
            return false;
        }

        return true;

    }
    catch(error){

        console.error(`Subscription: consumeUsage(${kind}) fallita.`, error);
        showMessage("Connection error. Please try again.");
        return false;

    }

}

export function consumeVideoAnalysis(){

    return consumeUsage("video_analysis");

}

export function consumeIdeaGeneration(){

    return consumeUsage("idea_generation");

}

/*
    Aggiorna i badge "⚡ N" in UI senza ricaricare la pagina.
    Pro → simbolo infinito, Free → utilizzi rimanenti oggi.
*/
export function refreshUsageIndicators(){

    const videoLabel = state.plan === "pro" ? "∞" : `⚡ ${Math.max(0, state.videoRemaining)}`;
    const ideaLabel = state.plan === "pro" ? "∞" : `⚡ ${Math.max(0, state.ideaRemaining)}`;
    const planLabel = state.plan === "pro" ? "PRO" : "FREE";
    document.querySelectorAll("#nav-plan-badge").forEach(el=>{
        el.textContent = planLabel;
        el.classList.toggle("plan-badge-pro", state.plan === "pro");
    });

    document.querySelectorAll("#video-usage-badge").forEach(el => { el.textContent = videoLabel; });
    document.querySelectorAll("#idea-usage-badge").forEach(el => { el.textContent = ideaLabel; });

}

/* ==========================================================
   UPGRADE MODAL
   Riusa le classi .modal-overlay/.modal già definite in
   css_dashboard.css per restare coerente con il resto dell'app.
========================================================== */

function injectUpgradeModal(){

    if(document.getElementById("upgrade-modal-overlay")){

        return;

    }

    const overlay = document.createElement("div");
    overlay.id = "upgrade-modal-overlay";
    overlay.className = "modal-overlay";

    overlay.innerHTML = `
    <div class="modal upgrade-modal">
        <div class="upgrade-header">
            <h3 class="upgrade-title">🚀 Unlock Brawl Analytics Pro</h3>
            <p class="upgrade-subtitle">Predict viral Shorts before publishing.</p>
        </div>

        <div class="pricing-grid">
            <div class="pricing-card">
                <span class="pricing-label">FREE</span>
                <h4 class="pricing-plan-name">FREE</h4>
                <div class="pricing-price">€0</div>
                <ul class="pricing-features">
                    <li>3 ideas</li>
                    <li>1 analysis</li>
                    <li>Basic stats</li>
                </ul>
                <button class="pricing-btn pricing-btn-current" disabled>Current Plan</button>
            </div>

            <div class="pricing-card pricing-card-pro">
                <span class="pricing-label pricing-label-pro">⭐ MOST POPULAR</span>
                <h4 class="pricing-plan-name">PRO</h4>
                <div class="pricing-price">€6.99<small>/ month</small></div>
                <ul class="pricing-features">
                    <li>Unlimited ideas</li>
                    <li>Unlimited AI</li>
                    <li>Virality Engine</li>
                    <li>Future updates</li>
                </ul>
                <button class="pricing-btn pricing-btn-pro" id="upgrade-modal-cta">Upgrade Now</button>
            </div>
        </div>

        <div class="upgrade-footer"><span>Trusted by Brawl Stars creators</span></div>

        <button class="modal-btn modal-btn-cancel" id="upgrade-modal-later" style="width:100%">Maybe Later</button>
    </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {

        if(event.target === overlay){
            closeUpgradeModal();
        }

    });

    document.getElementById("upgrade-modal-later").addEventListener("click", closeUpgradeModal);
    document.getElementById("upgrade-modal-cta").addEventListener("click", startCheckout);

}

export function openUpgradeModal(){

    document.getElementById("upgrade-modal-overlay")?.classList.add("active");

}

export function closeUpgradeModal(){

    document.getElementById("upgrade-modal-overlay")?.classList.remove("active");

}

/*
    Placeholder pronto per Stripe: nessuna dipendenza da Stripe
    oggi, ma un unico punto da collegare in futuro (es. chiamata
    a un endpoint server che crea una Checkout Session e fa
    redirect). Fino ad allora mostra solo un messaggio.
*/
function startCheckout(){

    console.log("Stripe checkout non ancora configurato.");
    showMessage("Upgrade coming soon");

}