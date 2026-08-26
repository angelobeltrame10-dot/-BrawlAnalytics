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
const BILLING_ENDPOINT = "https://billing.angeskicollab10.workers.dev/checkout";

// Cache in memoria: popolata da loadUsageStatus() e aggiornata
// dopo ogni consumo riuscito, per evitare una query Supabase ad
// ogni singola domanda "quanti ne restano?" fatta dalla UI.
let state = {

    loaded: false,
    plan: "free",
    currentPeriodEnd: null,
    proStartedAt: null,
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

        // getSession() legge la sessione da localStorage senza chiamate di
        // rete (getUser() fallirebbe offline con ERR_INTERNET_DISCONNECTED).
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user || null;

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

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("plan, current_period_end, pro_started_at")
            .eq("id", user.id)
            .maybeSingle();

        if (!profileError && profile) {
            // The RPC already downgrades expired plans to free; never let a
            // stale stored plan from the profile row re-upgrade the UI.
            const expired = profile.current_period_end && new Date(profile.current_period_end) <= new Date();
            state.plan = expired ? "free" : (profile.plan || state.plan);
            state.currentPeriodEnd = profile.current_period_end || null;
            state.proStartedAt = profile.pro_started_at || null;
        }

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

/*
    Forza un ricaricamento fresco dello stato (piano/utilizzi) dal DB.
    Chiamata all'apertura del profilo: così il piano mostrato riflette
    sempre Supabase, anche se il profilo viene aperto prima che la
    dashboard inizializzi lo stato, o dopo modifiche fatte sul DB.
*/
export async function refreshUsageStatus(){

    await loadUsageStatus();

}

export function getCurrentPlan(){

    return state.plan;

}

/*
    True for any paid plan. Accepts both the new Supabase values
    (pro_m / pro_a) and the legacy "pro" for backward compatibility.
*/
export function isProPlan(plan){

    return plan === "pro" || plan === "pro_m" || plan === "pro_a";

}

export function getSubscriptionStatus(){

    return {
        plan: state.plan,
        currentPeriodEnd: state.currentPeriodEnd,
        proStartedAt: state.proStartedAt
    };

}

export function getRemainingVideoAnalyses(){

    return isProPlan(state.plan) ? Infinity : Math.max(0, state.videoRemaining);

}

export function getRemainingIdeaGenerations(){

    return isProPlan(state.plan) ? Infinity : Math.max(0, state.ideaRemaining);

}

/*
    Controlli "leggeri" lato client (cache in memoria): utili solo
    per decisioni di UI immediate (es. disabilitare un bottone).
    NON sono la guardia di sicurezza — quella è sempre la RPC
    atomica chiamata da consumeVideoAnalysis()/consumeIdeaGeneration().
*/
export function canAnalyzeVideo(){

    return isProPlan(state.plan) || state.videoRemaining > 0;

}

export function canGenerateIdea(){

    return isProPlan(state.plan) || state.ideaRemaining > 0;

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

        const remaining = isProPlan(row.plan) ? Infinity : row.remaining;

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

// Derived expiry when Stripe has not synced a period end yet (e.g. legacy /
// manually-granted Pro). Returns an ISO string or null if it cannot be derived.
function derivePeriodEnd(periodEnd, proStartedAt, plan){
    if(periodEnd) return periodEnd;
    if(!proStartedAt || !isProPlan(plan)) return null;
    const days = plan === "pro_a" ? 365 : 30;
    return new Date(new Date(proStartedAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function formatExpiryDate(dateISO){
    return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(dateISO));
}

/*
    Aggiorna i badge "⚡ N" in UI senza ricaricare la pagina.
    Pro → simbolo infinito, Free → utilizzi rimanenti oggi.
*/
export function refreshUsageIndicators(){

    const isPro = isProPlan(state.plan);
    const videoLabel = isPro ? "∞" : `⚡ ${Math.max(0, state.videoRemaining)}`;
    const ideaLabel = isPro ? "∞" : `⚡ ${Math.max(0, state.ideaRemaining)}`;
    const planLabel = isPro ? "PRO" : "FREE";
    document.querySelectorAll("#nav-plan-badge").forEach(el=>{
        el.textContent = planLabel;
        el.classList.toggle("plan-badge-pro", isPro);
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
            <h3 class="upgrade-title">brawl analytics pro</h3>
            <div class="upgrade-current-status" id="upgrade-current-status"></div>
        </div>

        <div class="pricing-grid">
            <div class="pricing-card">
                <span class="pricing-label">FREE</span>
                <h4 class="pricing-plan-name">FREE</h4>
                <div class="pricing-price">€0</div>
                <ul class="pricing-features">
                    <li>3 ideas</li>
                    <li>1 video analysis</li>
                    <li>Trend Explorer</li>
                </ul>
                <button class="pricing-btn pricing-btn-current" disabled>Current Plan</button>
            </div>

            <div class="pricing-card pricing-card-pro">
                <span class="pricing-label pricing-label-pro">⭐ MOST POPULAR</span>
                <h4 class="pricing-plan-name">PRO</h4>
                <div class="pricing-price">€6.99<small>/ month</small></div>
                <ul class="pricing-features">
                    <li>Unlimited ideas</li>
                    <li>Unlimited video analyses</li>
                    <li>Trend Explorer</li>
                    <li>Hook Analyzer</li>
                    <li>AI Coach</li>
                    <li>Title Optimizer</li>
                    <li>Future updates</li>
                </ul>
                <button class="pricing-btn pricing-btn-pro" id="upgrade-modal-cta">choose monthly</button>
            </div>

            <div class="pricing-card pricing-card-pro">
                <span class="pricing-label pricing-label-pro">💎 BEST VALUE</span>
                <h4 class="pricing-plan-name">PRO ANNUAL</h4>
                <div class="pricing-price">€75<small>/ year</small></div>
                <ul class="pricing-features">
                    <li><strong>Everything in pro monthly</strong></li>
                    <li><strong>Save 11%</strong> compared to monthly</li>
                    <li>priority support</li>
                    <li>faster response times</li>
                </ul>
                <button class="pricing-btn pricing-btn-pro" id="upgrade-modal-cta-annual">choose annual</button>
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
    document.getElementById("upgrade-modal-cta").addEventListener("click", () => startCheckout("monthly"));
    document.getElementById("upgrade-modal-cta-annual").addEventListener("click", () => startCheckout("annual"));

}

export async function openUpgradeModal(){

    if(!state.loaded){
        await loadUsageStatus();
    }

    if(!document.getElementById("upgrade-modal-overlay")){
        injectUpgradeModal();
    }

    const status = document.getElementById("upgrade-current-status");
    if(status){
        const isPro = isProPlan(state.plan);
        // Period end = real Stripe date when available, otherwise derived as
        // pro_started_at + 30 days (monthly) / 365 days (annual). A Pro account
        // always has a meaningful expiry to display; keep it nullable only in
        // the unlikely case that neither Stripe nor a start date exists.
        const expiryDate = derivePeriodEnd(state.currentPeriodEnd, state.proStartedAt, state.plan);
        const expiry = expiryDate ? formatExpiryDate(expiryDate) : "not available yet";
        status.textContent = isPro
            ? `current plan: pro · renews/expires: ${expiry}`
            : "current plan: free · no active pro subscription";
        status.classList.toggle("is-pro", isPro);
    }

    document.getElementById("upgrade-modal-overlay")?.classList.add("active");

}

export function closeUpgradeModal(){

    document.getElementById("upgrade-modal-overlay")?.classList.remove("active");

}

/*
    Stripe is called only through the server-side billing Worker. The browser
    never receives STRIPE_SECRET_KEY and never decides the price ID.
*/
async function startCheckout(interval = "monthly") {
    try {
        const supabase = await getSupabaseClient();
        const { data: { session } } = await supabase?.auth.getSession() || { data: {} };
        if (!session?.access_token) {
            showMessage("Please log in before choosing a plan");
            return;
        }

        const response = await fetch(BILLING_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ interval: interval === "annual" ? "annual" : "monthly" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.url) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        window.location.assign(data.url);
    } catch (error) {
        console.error("Billing checkout failed:", error);
        showMessage("Unable to start checkout. Please try again later.");
    }
}