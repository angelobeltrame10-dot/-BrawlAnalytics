const TRENDS_ENDPOINT = "https://trends.angeskicollab10.workers.dev/trends";

let trendsLoaded = false;
let cachedTrends = [];

async function fetchTrends(){
    const response = await fetch(TRENDS_ENDPOINT);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    // Se è una stringa con punto e virgola, splittala
    if(typeof data?.trends === "string"){
        return data.trends
            .split(";")
            .map(t => t.trim())
            .filter(t => t.length > 0);
    }
    
    // Se è già array
    if(Array.isArray(data?.trends)){
        return data.trends.map(t => {
            if(typeof t === "string") return t.trim();
            return t?.query || t?.title || t?.name || "";
        }).filter(t => t.length > 0);
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

    if(trendsLoaded && !force){
        renderTrends(container, cachedTrends);
        return;
    }

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