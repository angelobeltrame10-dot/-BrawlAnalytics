const TRENDS_ENDPOINT = "https://trends.angeskicollab10.workers.dev/trends";

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