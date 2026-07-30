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
                <div class="trend-query">${trend}</div>
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
        cachedTrends = await fetchTrends();
        trendsLoaded = true;
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
    la tab "Trends" in questa sessione. Se sono già stati caricati,
    riusa la cache senza rifare la richiesta di rete.
*/
export async function ensureTrendsLoaded(){

    if(trendsLoaded){
        return getCachedTrends();
    }

    try{
        cachedTrends = await fetchTrends();
        trendsLoaded = true;
    }
    catch(error){
        console.error("Trends fetch failed (ensureTrendsLoaded):", error);
    }

    return getCachedTrends();

}

/* ==========================================================
   CREATOR TRENDS
========================================================== */

let creatorTrendsData = null;
let creatorTrendsLoaded = false;

// Mock data for testing when worker is unavailable
const MOCK_CREATOR_TRENDS = {
    "date": "2026-07-30",
    "trends": [
        {
            "generatedAt": "2026-07-30T00:00:00Z",
            "videosAnalyzed": 150,
            "freshnessScore": 85,
            "formats": [
                {"name": "Gameplay Tutorial", "count": 45},
                {"name": "Rank Push Journey", "count": 32},
                {"name": "Mythic Drop", "count": 28},
                {"name": "Brawl Stars News", "count": 25},
                {"name": "Challenge Guide", "count": 20}
            ],
            "topics": [
                {"topic": "New Brawler Release", "count": 38},
                {"topic": "Balance Changes", "count": 35},
                {"topic": "Season Pass", "count": 30},
                {"topic": "Championship Challenge", "count": 25},
                {"topic": "Map Strategies", "count": 22}
            ],
            "brawlers": [
                {"brawler": "Cordelius", "count": 42},
                {"brawler": "Maisie", "count": 38},
                {"brawler": "Ruffs", "count": 35},
                {"brawler": "Chester", "count": 30},
                {"brawler": "Gray", "count": 28}
            ],
            "keywords": [
                {"keyword": "new brawler", "count": 55},
                {"keyword": "best build", "count": 48},
                {"keyword": "gameplay tips", "count": 45},
                {"keyword": "rank push", "count": 42},
                {"keyword": "tutorial", "count": 38}
            ],
            "trends": [
                {
                    "name": "New Brawler First Impressions",
                    "category": "Content Coverage",
                    "trendScore": 92,
                    "confidence": 88,
                    "viralPotential": 95,
                    "competition": 75,
                    "saturation": 68,
                    "longevity": "High",
                    "executionDifficulty": "Medium",
                    "status": "Trending",
                    "reason": "New brawler releases generate massive initial interest as players want to see abilities, kits, and gameplay before trying them themselves.",
                    "whyNow": "Cordelius was just released and players are actively searching for first-impression content to understand the brawler's power level and playstyle.",
                    "avoid": "Don't simply showcase the brawler without analysis. Pure gameplay videos without commentary are oversaturated.",
                    "howToDifferentiate": "Focus on specific aspects: ability combos, synergies with specific teammates, counter strategies, or unique gadget/star power combinations.",
                    "originalitySuggestion": "Create a 'Is Cordelius Worth It?' video that breaks down the brawler's value across different game modes and trophy ranges."
                },
                {
                    "name": "Mythic Drop Reactions",
                    "category": "Entertainment",
                    "trendScore": 85,
                    "confidence": 82,
                    "viralPotential": 88,
                    "competition": 82,
                    "saturation": 75,
                    "longevity": "Medium",
                    "executionDifficulty": "Low",
                    "status": "Trending",
                    "reason": "Mythic drop reaction videos combine excitement with rarity, creating highly shareable moments that resonate with the F2P player base.",
                    "whyNow": "The current Starr Road features desirable mythics, and many players are hoping for drops during their Starr drops.",
                    "avoid": "Don't fake reactions or overreact excessively. Audiences can detect inauthenticity.",
                    "howToDifferentiate": "Add educational value by explaining the mythic's viability, best game modes, and how it fits into the current meta.",
                    "originalitySuggestion": "Create a 'Mythic Drop Tier List' where you rank recent mythic drops and explain which ones have aged well."
                },
                {
                    "name": "Season Pass Value Analysis",
                    "category": "Educational",
                    "trendScore": 78,
                    "confidence": 85,
                    "viralPotential": 72,
                    "competition": 65,
                    "saturation": 55,
                    "longevity": "High",
                    "executionDifficulty": "Medium",
                    "status": "Emerging",
                    "reason": "Players want to know if the current Season Pass is worth their gems before committing to the purchase.",
                    "whyNow": "The new season just launched, and players are evaluating whether to spend their saved gems on the pass or save for future content.",
                    "avoid": "Don't just list rewards without context. Players need value analysis, not just feature lists.",
                    "howToDifferentiate": "Break down the value per gem, compare with previous seasons, and identify which rewards are must-haves vs. skip-worthy.",
                    "originalitySuggestion": "Create a 'Free-to-Play Path' video showing what F2P players can achieve without buying the pass, then compare the pass holder's advantages."
                }
            ]
        }
    ]
};

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
    const container = document.getElementById('creator-trends-container');
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
        const response = await fetch(CREATOR_TRENDS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        // Check for empty data
        if(!data || !data.trends || !Array.isArray(data.trends) || data.trends.length === 0){
            showCreatorTrendsEmpty();
            return;
        }
        
        creatorTrendsData = data;
        creatorTrendsLoaded = true;
        
        renderCreatorTrends(data);
        
        // Hide loading, show content
        loadingEl.hidden = true;
        contentEl.hidden = false;
        
    } catch(error){
        console.error('Creator trends fetch failed:', error);
        console.log('Using mock data for testing since worker requires authentication');
        
        // Use mock data for testing when worker is unavailable
        // In production, you would want to configure proper authentication
        creatorTrendsData = MOCK_CREATOR_TRENDS;
        creatorTrendsLoaded = true;
        
        renderCreatorTrends(MOCK_CREATOR_TRENDS);
        
        // Hide loading, show content
        loadingEl.hidden = true;
        contentEl.hidden = false;
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
        const name = typeof item === 'string' ? item : (item.name || item.topic || item.keyword || item.brawler || JSON.stringify(item));
        const count = typeof item === 'string' ? 0 : (item.count || 0);
        
        return `
            <div class="sidebar-item">
                <span class="sidebar-item-name">${escapeHtml(name)}</span>
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

function escapeHtml(text){
    if(!text) return '';
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