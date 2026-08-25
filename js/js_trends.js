const TRENDS_ENDPOINT = "https://trends.angeskicollab10.workers.dev/trends";
const CREATOR_TRENDS_ENDPOINT = "https://creator-trends-worker.angeskicollab10.workers.dev/";

let trendsLoaded = false;
let cachedTrends = [];

/*
    Splitta una stringa che può contenere più trend uniti da ";"
    in un array di trend singoli, puliti da spazi vuoti.
*/
function splitTrendString(value){
    return String(value || "")
        .split(";")
        .map(part => part.trim())
        .filter(Boolean);
}

async function fetchTrends(){
    const response = await fetch(TRENDS_ENDPOINT);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    // Caso 1: data.trends è direttamente una stringa unica con ";"
    if(typeof data?.trends === "string"){
        return splitTrendString(data.trends);
    }

    // Caso 2: data.trends è un array. Ogni elemento può essere:
    // - una stringa semplice (eventualmente con ";" dentro)
    // - un oggetto { query/title/name } il cui valore può A SUA VOLTA
    //   contenere più trend uniti da ";" (questo è il caso che prima
    //   non veniva gestito: veniva preso il valore intero come UN
    //   solo trend invece di splittarlo).
    if(Array.isArray(data?.trends)){
        return data.trends.flatMap(t => {

            if(typeof t === "string"){
                return splitTrendString(t);
            }

            const value = t?.query || t?.title || t?.name || "";
            return splitTrendString(value);

        });
    }

    return [];
}

function renderTrends(container, trends){
    if(!trends.length){
        container.innerHTML = `<div class="trends-empty">No trends available right now.</div>`;
        return;
    }
    
    container.innerHTML = trends.map((trend, index)=>{
        return `
            <div class="trend-card">
                <span class="trend-rank">#${index + 1}</span>
                <div class="trend-query">${escapeHtml(trend)}</div>
                <span class="trend-fire">🔥</span>
            </div>`;
    }).join("");
}

export async function initTrends(force = false){
    const container = document.getElementById("trends-list");
    if(!container) return;

    // if(trendsLoaded && !force){
    //     renderTrends(container, cachedTrends);
    //     return;
    // }

    container.innerHTML = `<div class="trends-loading">Loading trends...</div>`;

    try{
        const fetched = await fetchTrends();
        cachedTrends = fetched;

        // FIX: se il fetch ritorna un array vuoto (es. nessun trend
        // disponibile in quel momento), NON marchiamo trendsLoaded = true.
        //
        // trendsLoaded è una variabile di MODULO condivisa con
        // ensureTrendsLoaded() (usata dalla Video Analysis, vedi sotto).
        // Prima di questo fix: se l'utente apriva il tab "Trends" quando
        // il worker non aveva ancora dati, questo blocco impostava
        // trendsLoaded = true anche con cachedTrends = []. Da quel
        // momento in poi, per TUTTA la sessione (finché non si ricarica
        // la pagina), ensureTrendsLoaded() vedeva trendsLoaded === true
        // e restituiva sempre quella cache vuota SENZA MAI riprovare a
        // scaricare i trend — anche dopo aver inserito nuovi dati lato
        // backend. Risultato osservato: Video Analysis riceveva sempre
        // "No trend data available", l'AI rispondeva trendAlignment:
        // "none" e semanticTrendSimilarity: 0, quindi il Trend score
        // restava bloccato a 0 anche con trend reali disponibili.
        if(fetched.length > 0){
            trendsLoaded = true;
        }

        renderTrends(container, cachedTrends);
    }
    catch(error){
        console.error("Trends fetch failed:", error);
        container.innerHTML = `<div class="trends-empty">Unable to load trends right now.</div>`;
    }
}

export function setupTrendsRefresh(){
    const button = document.getElementById("refresh-trends-btn");
    if(!button || button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", ()=> initTrends(true));
}

/*
    Restituisce l'ultimo set di trend caricato in cache (es. dalla tab
    "Trends" o da una chiamata precedente). NON esegue un fetch: se
    nessun trend è mai stato caricato in questa sessione, ritorna [].

    Usata dal Virality Engine (js_video_analysis.js) per confrontare
    titolo/descrizione del video proposto con i trend reali di Brawl
    Stars, invece di analizzare sempre con trendsAnalysis = null.
*/
export function getCachedTrends(){
    return [...cachedTrends];
}

/*
    Garantisce che i trend siano disponibili prima di un'analisi che ne
    ha bisogno (es. Video Analysis), anche se l'utente non ha mai aperto
    la tab "Trends" in questa sessione. Se sono già stati caricati CON
    successo (dati non vuoti), riusa la cache senza rifare la richiesta
    di rete. Se invece la cache è vuota (mai caricata, oppure caricata
    ma senza trend disponibili al momento), riprova sempre a scaricare
    dati freschi: un array vuoto non deve mai essere considerato uno
    stato "definitivo" per la sessione.
*/
export async function ensureTrendsLoaded(){

    if(trendsLoaded && cachedTrends.length > 0){
        return getCachedTrends();
    }

    try{
        const fetched = await fetchTrends();
        cachedTrends = fetched;

        if(fetched.length > 0){
            trendsLoaded = true;
        }
    }
    catch(error){
        console.error("Trends fetch failed (ensureTrendsLoaded):", error);
    }

    return getCachedTrends();

}

/* ==========================================================
   CREATOR TRENDS

   Dati reali salvati settimanalmente nel KV del worker da uno
   scenario Make (endpoint POST, protetto da Bearer token). La
   dashboard legge quegli stessi dati con una richiesta GET
   pubblica e senza credenziali (vedi worker: la rotta GET è
   read-only e non richiede MAKE_SECRET, che non deve MAI
   finire nel browser).

   NIENTE dati fittizi/mock: se il fetch fallisce o non c'è
   ancora nessun dato in KV, viene mostrato uno stato onesto
   (empty/error), mai un fallback che spaccia dati vecchi o
   inventati per trend reali.
========================================================== */

let creatorTrendsData = null;
let creatorTrendsLoaded = false;

export function setupTrendsTabNavigation(){
    const tabs = document.querySelectorAll('.trends-tab');
    const tabContents = document.querySelectorAll('.trends-tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.trendsTab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show/hide content
            tabContents.forEach(content => {
                if(content.id === `${targetTab}-tab`){
                    content.hidden = false;
                } else {
                    content.hidden = true;
                }
            });
            
            // Load creator trends if switching to that tab
            if(targetTab === 'creator-trends' && !creatorTrendsLoaded){
                loadCreatorTrends();
            }
        });
    });
}

async function loadCreatorTrends(){
    const loadingEl = document.getElementById('creator-trends-loading');
    const emptyEl = document.getElementById('creator-trends-empty');
    const errorEl = document.getElementById('creator-trends-error');
    const contentEl = document.getElementById('creator-trends-content');
    
    // Show loading state
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
    contentEl.hidden = true;
    
    try{
        const response = await fetch(CREATOR_TRENDS_ENDPOINT, { method: 'GET' });

        // Nessun dato ancora salvato in KV (es. prima esecuzione dello
        // scenario Make non ancora avvenuta): stato vuoto, non errore.
        if(response.status === 404){
            showCreatorTrendsEmpty();
            return;
        }

        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if(!data || !data.trends || !Array.isArray(data.trends) || data.trends.length === 0){
            showCreatorTrendsEmpty();
            return;
        }
        
        creatorTrendsData = data;
        creatorTrendsLoaded = true;
        
        renderCreatorTrends(data);
        
        loadingEl.hidden = true;
        contentEl.hidden = false;
        
    } catch(error){
        console.error('Creator trends fetch failed:', error);
        showCreatorTrendsError();
    }
}

function showCreatorTrendsEmpty(){
    const loadingEl = document.getElementById('creator-trends-loading');
    const emptyEl = document.getElementById('creator-trends-empty');
    const errorEl = document.getElementById('creator-trends-error');
    const contentEl = document.getElementById('creator-trends-content');
    
    loadingEl.hidden = true;
    emptyEl.hidden = false;
    errorEl.hidden = true;
    contentEl.hidden = true;
}

function showCreatorTrendsError(message){
    const loadingEl = document.getElementById('creator-trends-loading');
    const emptyEl = document.getElementById('creator-trends-empty');
    const errorEl = document.getElementById('creator-trends-error');
    const contentEl = document.getElementById('creator-trends-content');
    const errorMessage = document.getElementById('creator-trends-error-message');
    
    errorMessage.textContent = message || 'Unable to load creator trends. Please try again later.';
    
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    errorEl.hidden = false;
    contentEl.hidden = true;
}

function renderCreatorTrends(data){
    const trendsData = data.trends[0]; // Get the first (and should be only) trend analysis
    
    // Controlla se trendsData è effettivamente vuoto (videosAnalyzed === 0 E tutti gli array vuoti)
    // Se sì, mostra lo stato onesto invece di procedere con il rendering
    const isEmpty = trendsData && (
        (trendsData.videosAnalyzed === 0 || !trendsData.videosAnalyzed) &&
        (!Array.isArray(trendsData.formats) || trendsData.formats.length === 0) &&
        (!Array.isArray(trendsData.topics) || trendsData.topics.length === 0) &&
        (!Array.isArray(trendsData.brawlers) || trendsData.brawlers.length === 0) &&
        (!Array.isArray(trendsData.keywords) || trendsData.keywords.length === 0) &&
        (!Array.isArray(trendsData.trends) || trendsData.trends.length === 0)
    );
    
    if (isEmpty) {
        console.warn('Creator trends data is empty, showing empty state');
        showCreatorTrendsEmpty();
        return;
    }
    
    // Update header metrics
    document.getElementById('creator-videos-analyzed').textContent = trendsData.videosAnalyzed || '-';
    document.getElementById('creator-freshness-score').textContent = trendsData.freshnessScore ? `${trendsData.freshnessScore}%` : '-';
    document.getElementById('creator-last-update').textContent = trendsData.generatedAt ? 
        new Date(trendsData.generatedAt).toLocaleDateString() : '-';
    
    // Render trend cards
    renderTrendCards(trendsData.trends);
    
    // Render sidebar panels
    renderSidebarPanel('top-formats', trendsData.formats);
    renderSidebarPanel('top-topics', trendsData.topics);
    renderSidebarPanel('top-brawlers', trendsData.brawlers);
    renderSidebarPanel('top-keywords', trendsData.keywords);
}

function renderTrendCards(trends){
    const container = document.getElementById('creator-trends-cards');
    
    if(!trends || trends.length === 0){
        container.innerHTML = '<p class="text-muted">No trends available.</p>';
        return;
    }
    
    container.innerHTML = trends.map(trend => `
        <div class="creator-trend-card">
            <div class="trend-card-header">
                <div class="trend-card-title">
                    <div class="trend-name">${escapeHtml(trend.name)}</div>
                    <div class="trend-category">${escapeHtml(trend.category)}</div>
                </div>
                <span class="trend-status ${getStatusClass(trend.status)}">${escapeHtml(trend.status)}</span>
            </div>
            
            <div class="trend-metrics">
                <div class="trend-metric">
                    <span class="trend-metric-label">Trend Score</span>
                    <span class="trend-metric-value">${trend.trendScore}</span>
                    <div class="trend-metric-bar">
                        <div class="trend-metric-bar-fill" style="width: ${trend.trendScore}%"></div>
                    </div>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Confidence</span>
                    <span class="trend-metric-value">${trend.confidence}%</span>
                    <div class="trend-metric-bar">
                        <div class="trend-metric-bar-fill" style="width: ${trend.confidence}%"></div>
                    </div>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Viral Potential</span>
                    <span class="trend-metric-value">${trend.viralPotential}%</span>
                    <div class="trend-metric-bar">
                        <div class="trend-metric-bar-fill" style="width: ${trend.viralPotential}%"></div>
                    </div>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Competition</span>
                    <span class="trend-metric-value">${trend.competition}%</span>
                    <div class="trend-metric-bar">
                        <div class="trend-metric-bar-fill" style="width: ${trend.competition}%"></div>
                    </div>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Saturation</span>
                    <span class="trend-metric-value">${trend.saturation}%</span>
                    <div class="trend-metric-bar">
                        <div class="trend-metric-bar-fill" style="width: ${trend.saturation}%"></div>
                    </div>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Longevity</span>
                    <span class="trend-metric-value">${escapeHtml(trend.longevity)}</span>
                </div>
                <div class="trend-metric">
                    <span class="trend-metric-label">Execution</span>
                    <span class="trend-metric-value">${escapeHtml(trend.executionDifficulty)}</span>
                </div>
            </div>
            
            <div class="trend-sections">
                ${trend.reason ? `
                <div class="trend-section">
                    <div class="trend-section-title">Why it's trending</div>
                    <div class="trend-section-content">${escapeHtml(trend.reason)}</div>
                </div>
                ` : ''}
                
                ${trend.whyNow ? `
                <div class="trend-section">
                    <div class="trend-section-title">Why now</div>
                    <div class="trend-section-content">${escapeHtml(trend.whyNow)}</div>
                </div>
                ` : ''}
                
                ${trend.avoid ? `
                <div class="trend-section">
                    <div class="trend-section-title">Avoid</div>
                    <div class="trend-section-content">${escapeHtml(trend.avoid)}</div>
                </div>
                ` : ''}
                
                ${trend.howToDifferentiate ? `
                <div class="trend-section">
                    <div class="trend-section-title">How to differentiate</div>
                    <div class="trend-section-content">${escapeHtml(trend.howToDifferentiate)}</div>
                </div>
                ` : ''}
                
                ${trend.originalitySuggestion ? `
                <div class="trend-section">
                    <div class="trend-section-title">Originality suggestion</div>
                    <div class="trend-section-content">${escapeHtml(trend.originalitySuggestion)}</div>
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function renderSidebarPanel(containerId, items){
    const container = document.getElementById(containerId);
    
    if(!items || items.length === 0){
        container.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No data available</p>';
        return;
    }
    
    container.innerHTML = items.slice(0, 10).map(item => {
        // "word" copre le keyword ({"word":"...","count":...}) restituite
        // dallo scenario Make: senza questo fallback il nome finiva
        // per collassare su JSON.stringify(item) e mostrare JSON grezzo.
        const rawName = typeof item === 'string'
            ? item
            : (item.name || item.topic || item.keyword || item.brawler || item.word || JSON.stringify(item));
        const count = typeof item === 'string' ? 0 : (item.count || 0);
        const name = escapeHtml(rawName);
        
        return `
            <div class="sidebar-item">
                <span class="sidebar-item-name">${name}</span>
                ${count > 0 ? `<span class="sidebar-item-count">${count}</span>` : ''}
            </div>
        `;
    }).join('');
}

function getStatusClass(status){
    if(!status) return 'emerging';
    
    const statusLower = status.toLowerCase();
    if(statusLower.includes('emerging') || statusLower.includes('new')) return 'emerging';
    if(statusLower.includes('trending') || statusLower.includes('hot') || statusLower.includes('viral')) return 'trending';
    if(statusLower.includes('declining') || statusLower.includes('dying')) return 'declining';
    
    return 'emerging';
}

export function escapeHtml(text){
    if(text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function setupCreatorTrendsRetry(){
    const retryBtn = document.getElementById('retry-creator-trends-btn');
    if(!retryBtn || retryBtn.dataset.bound) return;
    
    retryBtn.dataset.bound = 'true';
    retryBtn.addEventListener('click', () => {
        loadCreatorTrends();
    });
}
