/* ==========================================================
   BRAWL ANALYTICS
   API SERVICE (Cloudflare Worker Integration)

   L'AI e' integrata automaticamente: nessuna configurazione
   richiesta all'utente. Il Worker Cloudflare tiene la vera
   API key di Groq lato server (environment secret) e la
   inoltra a https://api.groq.com/openai/v1/chat/completions.
   Il browser non deve mai vedere quella chiave.
========================================================== */

import { getVideoTitle, getVideoViews } from "./js_csv_fields.js";

import { getAuthHeaders } from "./js_auth_fetch.js";

const AI_ENDPOINT = "https://brawl-analytics-backend.angeskicollab10.workers.dev";

// Modello Groq di default (OpenAI-compatible). Vedi https://console.groq.com/docs/models
const AI_MODEL = "openai/gpt-oss-120b";

function buildRequestBody(messages, options = {}) {
    return {
        messages,
        // The Worker owns the model choice; this value is intentionally not sent.
        temperature: typeof options.temperature === "number" ? options.temperature : 0.7,
        max_tokens: typeof options.maxTokens === "number" ? options.maxTokens : 2048,
        ...(options.usageKind ? { usage_kind: options.usageKind } : {})
    };
}

async function callWorker(messages, options = {}) {

    const response = await fetch(AI_ENDPOINT, {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(buildRequestBody(messages, options))
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        // The backend returns { code: "usage_limit" } (HTTP 429) when the
        // daily quota is exhausted. Surface that as a distinct, catchable
        // signal instead of a generic message, so callers can open the
        // upgrade modal and stop the pipeline instead of falling back.
        if (data?.code === "usage_limit") {
            const err = new Error(data?.error?.message || "Daily usage limit reached.");
            err.code = "usage_limit";
            throw err;
        }
        const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
        throw new Error(message);
    }

    return data.choices?.[0]?.message?.content || data.result?.response || "";
}

/**
 * Estrae la sottostringa tra la prima "[" e l'ultima "]" del testo, per
 * recuperare l'array JSON anche quando il modello aggiunge testo prima o
 * dopo (es. "Ecco i formati: [...]") nonostante le istruzioni.
 */
function extractJsonArraySlice(text) {
    if (!text) return null;
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end < start) return null;
    return text.slice(start, end + 1);
}

/**
 * Estrae keyword dai titoli rappresentativi tokenizzando e rimuovendo
 * parole comuni. Le keyword sono sempre prese dai titoli reali, mai
 * inventate.
 *
 * Se viene passato `corpusTitles` (il campione più ampio dell'intero
 * canale, non solo i titoli di questo formato), le parole che compaiono
 * in più della metà di QUEI titoli vengono scartate anche se frequenti
 * nel sottoinsieme rappresentativo: sono hashtag/boilerplate onnipresenti
 * (es. "#brawlstars", "#shorts") che non distinguono nulla tra formati
 * diversi, e usarle come keyword causa falsi positivi — un video di un
 * formato completamente diverso che condivide solo l'hashtag finirebbe
 * comunque classificato qui.
 */
function extractKeywordsFromTitles(titles, corpusTitles = []) {
    if (!Array.isArray(titles) || titles.length === 0) {
        return [];
    }

    // Parole comuni da ignorare (stop words linguistiche) + hashtag di
    // PIATTAFORMA universali (non specifici di nessun gioco/canale): la
    // parola "shorts" compare su gran parte di qualunque canale YouTube
    // Shorts esistente, quindi non è mai distintiva tra i formati di UNO
    // stesso canale — va esclusa sempre, non solo quando supera una
    // soglia statistica (che dipende dalla composizione del campione e
    // può non intercettarla per un margine minimo, come osservato sui
    // dati reali di test: "shorts" al 39,6% restava sotto una soglia
    // del 40%). Le parole specifiche del gioco/nicchia (es. "brawlstars")
    // restano invece gestite dal filtro statistico qui sotto, perché non
    // possiamo prevedere a priori il nome di ogni gioco possibile.
    const stopWords = new Set([
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "shall", "can", "to", "of", "in",
        "for", "on", "with", "at", "by", "from", "as", "into", "through",
        "during", "before", "after", "above", "below", "between", "under",
        "again", "further", "then", "once", "here", "there", "when", "where",
        "why", "how", "all", "each", "few", "more", "most", "other", "some",
        "such", "no", "nor", "not", "only", "own", "same", "so", "than",
        "too", "very", "just", "and", "but", "if", "or", "because", "until",
        "while", "this", "that", "these", "those", "i", "you", "he", "she",
        "it", "we", "they", "what", "which", "who", "whom", "this", "that",
        "shorts", "short", "fyp", "viral", "trending", "video", "watch"
    ]);

    const tokenize = text => String(text || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(word => word.length > 1 && !stopWords.has(word));

    const wordFrequency = {};

    titles.forEach(title => {
        tokenize(title).forEach(word => {
            wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        });
    });

    // Se abbiamo un campione più ampio del canale, misuriamo su quanti
    // titoli ciascuna parola farebbe MATCH — usando la stessa logica a
    // substring del vero classificatore (matchesKeywords in js_fomats.js),
    // non un conteggio a token esatto. È una distinzione che conta: una
    // parola come "brawl" può sembrare rara se contata a token esatto,
    // ma via substring matcha comunque dentro "brawlstars" (l'hashtag),
    // coprendo di fatto molti più titoli — e se non lo misuriamo allo
    // stesso modo in cui verrà DAVVERO usata, il filtro lascia passare
    // parole che poi causano gli stessi falsi positivi che dovrebbe
    // prevenire.
    let isTooCommonAcrossChannel = () => false;

    if (Array.isArray(corpusTitles) && corpusTitles.length >= 5) {

        const lowerCorpusTitles = corpusTitles.map(title => String(title || "").toLowerCase());
        const totalCorpusTitles = lowerCorpusTitles.length;

        isTooCommonAcrossChannel = word => {
            const matchingTitles = lowerCorpusTitles.filter(title => title.includes(word)).length;
            return (matchingTitles / totalCorpusTitles) >= 0.4;
        };

    }

    // Ordina per frequenza e prendi le parole più comuni, escludendo
    // quelle troppo comuni nell'intero canale (non discriminano nulla).
    const sortedWords = Object.entries(wordFrequency)
        .filter(([word]) => !isTooCommonAcrossChannel(word))
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);

    // Restituisci fino a 8 keyword più frequenti
    return sortedWords.slice(0, 8);
}

/**
 * Parsing "tollerante" per risposte AI che dovrebbero essere un array
 * JSON. Gestisce: code fence markdown, testo introduttivo/finale, e il
 * caso in cui il modello avvolga l'array in un oggetto (es. {"formats":[...]})
 * invece di restituirlo direttamente come richiesto.
 * In caso di fallimento logga la risposta grezza in console (con un tag
 * per capire da quale funzione arriva) e ritorna null, MAI un errore
 * silenzioso indistinguibile da "l'AI non ha trovato nulla".
 */
function safeParseJsonArray(rawText, context) {

    if (!rawText) {
        console.warn(`[${context}] Risposta AI vuota.`);
        return null;
    }

    const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const candidate = extractJsonArraySlice(cleaned) || cleaned;

    try {

        const parsed = JSON.parse(candidate);

        if (Array.isArray(parsed)) {
            return parsed;
        }

        const firstArrayValue = Object.values(parsed || {}).find(value => Array.isArray(value));
        if (firstArrayValue) {
            return firstArrayValue;
        }

        console.warn(`[${context}] JSON valido ma non è un array:`, parsed);
        return null;

    } catch (error) {
        console.error(`[${context}] L'AI non ha restituito JSON valido. Risposta grezza ricevuta:`, rawText);
        return null;
    }
}

/**
 * Genera 3 idee personalizzate basate sui video migliori e sui formati dominanti.
 * Distribuisce le idee su più formati (primo, secondo, terzo migliore).
 */
export async function generaIdeeConAI(videoTop, topFormats) {

    if (!Array.isArray(videoTop) || videoTop.length === 0) {
        return [];
    }

    if (!Array.isArray(topFormats) || topFormats.length === 0) {
        return [];
    }

    const contestoVideo = videoTop
        .slice(0, 5)
        .map(v => `- Titolo: "${getVideoTitle(v)}", Views: ${getVideoViews(v)}`)
        .join("\n");

    const formatsDescription = topFormats
        .map((format, index) => `${index + 1}. "${format}"`)
        .join("\n");

    const promptText = `
You are an expert YouTube Shorts strategist specializing in Brawl Stars.
The creator has these top-performing formats (ranked by success):
${formatsDescription}

Their recent top-performing Shorts are:
${contestoVideo}

Generate 3 practical, highly viral ideas for upcoming Shorts. Distribute the ideas across the top formats:
- 1 idea for the #1 format
- 1 idea for the #2 format  
- 1 idea for the #3 format

Each idea must be concise (single-line), catchy, and actionable, strictly adhering to its assigned format.
Return the response as a JSON array with this exact structure:
[
  {"text": "idea text here", "format": "format name"},
  {"text": "idea text here", "format": "format name"},
  {"text": "idea text here", "format": "format name"}
]

Do not include any introductory or additional text.
    `;

    try {

        const rispostaTesto = await callWorker([
            { role: "system", content: "You are an expert YouTube Shorts strategist specializing in Brawl Stars. Always respond with valid JSON arrays." },
            { role: "user", content: promptText }
        ], { usageKind: "idea_generation" });

        if (!rispostaTesto) return [];

        const parsed = safeParseJsonArray(rispostaTesto, "generaIdeeConAI");
        
        if (!parsed || !Array.isArray(parsed)) {
            console.warn("generaIdeeConAI: AI response could not be parsed as array, trying fallback split");
            // Fallback: try old format if JSON parsing fails
            return rispostaTesto
                .split("|")
                .map((idea, index) => ({
                    text: idea.trim(),
                    format: topFormats[index % topFormats.length]
                }))
                .filter(idea => idea.text.length > 0);
        }

        // Validate and format the response
        return parsed
            .filter(item => item && item.text && item.text.trim().length > 0)
            .map(item => ({
                text: item.text.trim(),
                format: item.format || topFormats[0]
            }));

    } catch (error) {
        // Quota giornaliera esaurita: non è un fallimento AI — va lasciata
        // propagare come errore tipizzato così la UI apre il modale upgrade
        // e NON mostra un fallback fasullo.
        if (error?.code === "usage_limit") {
            throw error;
        }
        console.error("Errore durante la chiamata API di generazione idee:", error);
        return [];
    }
}

/**
 * Genera 3 idee TUTTE per un formato specifico.
 * Se il formato ha video associati, filtra videoTop su quelli di quel formato;
 * altrimenti usa i top video generali come contesto.
 */
export async function generaIdeeSuFormatSingolo(videoTop, format, creativity = 0.7) {

    if (!Array.isArray(videoTop) || videoTop.length === 0) {
        return [];
    }

    if (!format || typeof format !== 'string') {
        return [];
    }

    const contestoVideo = videoTop
        .slice(0, 5)
        .map(v => `- Titolo: "${getVideoTitle(v)}", Views: ${getVideoViews(v)}`)
        .join("\n");

    const promptText = `
You are an expert YouTube Shorts strategist specializing in Brawl Stars.
The creator wants to generate 3 ideas specifically for this format: "${format}"

Their recent top-performing Shorts are:
${contestoVideo}

Generate 3 practical, highly viral ideas for upcoming Shorts. ALL 3 ideas must be for the "${format}" format.

Each idea must be concise (single-line), catchy, and actionable, strictly adhering to the "${format}" format.
Return the response as a JSON array with this exact structure:
[
  {"text": "idea text here", "format": "${format}"},
  {"text": "idea text here", "format": "${format}"},
  {"text": "idea text here", "format": "${format}"}
]

Do not include any introductory or additional text.
    `;

    try {

        const rispostaTesto = await callWorker([
            { role: "system", content: "You are an expert YouTube Shorts strategist specializing in Brawl Stars. Always respond with valid JSON arrays." },
            { role: "user", content: promptText }
        ], { temperature: creativity, usageKind: "idea_generation" });

        if (!rispostaTesto) return [];

        const parsed = safeParseJsonArray(rispostaTesto, "generaIdeeSuFormatSingolo");
        
        if (!parsed || !Array.isArray(parsed)) {
            console.warn("generaIdeeSuFormatSingolo: AI response could not be parsed as array, trying fallback split");
            // Fallback: try old format if JSON parsing fails
            return rispostaTesto
                .split("|")
                .map((idea) => ({
                    text: idea.trim(),
                    format: format
                }))
                .filter(idea => idea.text.length > 0);
        }

        // Validate and format the response - force all to the requested format
        return parsed
            .filter(item => item && item.text && item.text.trim().length > 0)
            .map(item => ({
                text: item.text.trim(),
                format: format // Always use the requested format
            }));

    } catch (error) {
        // Quota giornaliera esaurita: non è un fallimento AI — va lasciata
        // propagare come errore tipizzato così la UI apre il modale upgrade
        // e NON mostra un fallback fasullo.
        if (error?.code === "usage_limit") {
            throw error;
        }
        console.error("Errore durante la chiamata API di generazione idee (formato singolo):", error);
        return [];
    }
}

// Quanti titoli inviamo al massimo all'AI per il rilevamento iniziale dei
// formati. Con canali piccoli (es. 50 video) usiamo tutti i titoli; con
// canali grandi (200, 1000+) campioniamo in modo UNIFORME lungo l'intera
// lista, non solo i primi N — altrimenti un canale con 1000 Shorts
// mostrerebbe all'AI solo l'ultima manciata caricata nel CSV, perdendo
// tutta la varietà di format del resto della storia del canale.
// Il costo/tempo di questa chiamata resta quindi fisso, sia con 200 sia
// con 1000+ video: è questo che rende la pipeline scalabile.
const FORMAT_DETECTION_SAMPLE_SIZE = 150;

// Quanti titoli "non riconosciuti" inviamo al massimo nella seconda
// passata di recupero copertura (expandFormatCoverage).
const COVERAGE_REFINEMENT_SAMPLE_SIZE = 60;

/**
 * Estrae un campione rappresentativo di `sampleSize` elementi distribuiti
 * uniformemente lungo tutto l'array, invece di prendere solo i primi N.
 * Se l'array è già più corto del campione richiesto, lo restituisce intero.
 */
function sampleEvenly(items, sampleSize) {

    if (!Array.isArray(items) || items.length <= sampleSize) {
        return items || [];
    }

    const step = items.length / sampleSize;
    const sampled = [];

    for (let i = 0; i < sampleSize; i += 1) {
        sampled.push(items[Math.floor(i * step)]);
    }

    return sampled;
}

/**
 * Mantiene solo le keyword che compaiono LETTERALMENTE (substring,
 * case-insensitive) in almeno uno dei titoli che sono stati mostrati
 * all'AI. Il prompt chiede esplicitamente di "grounded" keywords, ma un
 * LLM può comunque restituire parole semanticamente vicine ma mai
 * scritte così nei titoli reali (es. "comeback" invece della parola
 * esatta usata dal creator, o una parafrasi/traduzione) — keyword che
 * poi il matcher a substring di js_fomats.js non troverà MAI in nessun
 * titolo reale, indipendentemente da quanto sia corretto il formato
 * individuato. Questa funzione non si fida delle istruzioni del prompt:
 * verifica il risultato, non l'intenzione.
 *
 * Se non abbiamo titoli di riferimento (es. creazione manuale di un
 * formato senza ancora video assegnati) non c'è nulla contro cui
 * validare: restituiamo le keyword così come sono.
 */
function filterGroundedKeywords(keywords, referenceTitles, context) {

    if (!Array.isArray(referenceTitles) || referenceTitles.length === 0) {
        return keywords;
    }

    const normalizedTitles = referenceTitles.map(title => String(title || "").toLowerCase());

    const grounded = keywords.filter(keyword =>
        normalizedTitles.some(title => title.includes(keyword))
    );

    const discarded = keywords.filter(keyword => !grounded.includes(keyword));

    if (discarded.length > 0) {
        console.warn(`[${context}] Keyword scartate perché non compaiono letteralmente in nessun titolo mostrato all'AI:`, discarded);
    }

    return grounded;
}

function parseFormatsResponse(rispostaTesto, context, referenceTitles = []) {

    const formats = safeParseJsonArray(rispostaTesto, context);

    if (!formats) {
        return [];
    }

    return formats
        .filter(format => format && format.name)
        .map(format => {
            const name = String(format.name).trim();
            const description = (format.description || "").trim();

            // Nuovo schema: representativeTitles invece di keywords
            let keywords = [];
            if (Array.isArray(format.representativeTitles) && format.representativeTitles.length > 0) {
                // Estrai keyword automaticamente dai titoli rappresentativi,
                // scartando quelle troppo comuni nell'intero campione (hashtag boilerplate)
                keywords = extractKeywordsFromTitles(format.representativeTitles, referenceTitles);
            } else if (Array.isArray(format.keywords) && format.keywords.length > 0) {
                // Fallback per compatibilità con vecchio schema
                const rawKeywords = format.keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean);
                keywords = filterGroundedKeywords(rawKeywords, referenceTitles, context);
            }

            return {
                name,
                description,
                keywords
            };

        })
        // Un formato le cui keyword sono vuote non potrà mai matchare
        // un solo video reale: meglio non proporlo affatto.
        .filter(format => format.keywords.length > 0);
}

/**
 * Identifica fino a 4 formati SPECIFICI DI QUESTO CREATOR (non categorie
 * YouTube generiche) a partire da un campione di titoli, generando le
 * keyword DIRETTAMENTE nella stessa chiamata — grounded sui titoli reali
 * che l'AI ha appena visto, senza dover "ricordare" il contesto in una
 * seconda chiamata separata. Una sola chiamata AI, a costo fisso
 * indipendentemente da quanti video ha il canale (vedi sampleEvenly).
 *
 * NOTA per chi legge in futuro: i formati restituiti qui vengono sempre
 * validati contro TUTTI i video reali con classifyVideos() prima di
 * essere mostrati in dashboard (vedi js_channel_analysis.js) — quindi
 * il "conteggio video" che l'utente vede è sempre calcolato dal
 * classificatore locale, mai dichiarato dall'AI.
 */
export async function discoverChannelFormats(titles) {

    if (!Array.isArray(titles) || titles.length === 0) {
        return [];
    }

    const sample = sampleEvenly(titles, FORMAT_DETECTION_SAMPLE_SIZE);

    const promptText = `
You are analyzing a sample of YouTube Shorts titles from a single Brawl Stars creator's channel. This sample is evenly drawn from the creator's whole history and may represent a much larger channel (hundreds of videos).

Study the actual, recurring patterns in THIS creator's own titles — character names, mechanics, situations, recurring slang. Do NOT default to generic YouTube categories (e.g. "Funny Moments", "Gameplay") unless the titles genuinely and repeatedly support them. Prefer specific, creator-native formats, for example: "Edgar Comebacks", "1 HP Clutches", "Ranked Troll Builds", "Solo Carry".

Titles:
${sample.join("\n")}

Identify up to 4 recurring formats. For each one, provide 3-5 EXAMPLE TITLES from the sample above that best represent this format. DO NOT invent keywords - the system will extract keywords automatically from these representative titles.

Return ONLY a JSON array with this exact schema, no additional text, markdown blocks, or comments:
[
  { "name": "Format Name", "description": "Brief description", "representativeTitles": ["exact title 1 from sample", "exact title 2 from sample", "exact title 3 from sample"] }
]
    `;

    try {

        const rispostaTesto = await callWorker([
            { role: "system", content: "You are an expert in this creator's own content patterns, not generic YouTube taxonomy. Return ONLY valid JSON." },
            { role: "user", content: promptText }
        ], { temperature: 0.2, maxTokens: 2048 });

        return parseFormatsResponse(rispostaTesto, "discoverChannelFormats", sample);

    } catch (error) {
        console.error("Errore durante il rilevamento formati AI:", error);
        return [];
    }
}

/**
 * Seconda passata MIRATA: riceve solo i titoli che la classificazione
 * REALE (locale, su tutti i video) non è riuscita ad assegnare a nessun
 * formato di discoverChannelFormats(), e prova a scoprire fino a 2
 * formati aggiuntivi. Non reinvia mai l'intero canale una seconda volta:
 * anche questa chiamata resta a costo fisso, indipendente dalla
 * dimensione del canale.
 */
export async function expandFormatCoverage(unmatchedTitles, existingFormats = []) {

    if (!Array.isArray(unmatchedTitles) || unmatchedTitles.length === 0) {
        return [];
    }

    const sample = sampleEvenly(unmatchedTitles, COVERAGE_REFINEMENT_SAMPLE_SIZE);
    const existingNames = existingFormats.map(f => f?.name).filter(Boolean).join(", ") || "none yet";

    const promptText = `
These YouTube Shorts titles from a Brawl Stars creator did NOT match any already-detected format when checked against the full channel.

Already-detected formats: ${existingNames}

Unmatched titles:
${sample.join("\n")}

Identify up to 2 additional recurring, creator-specific formats among these unmatched titles (do not repeat the already-detected ones). If there is no genuine recurring pattern, return an empty array rather than forcing one. For each format, provide 3-5 EXAMPLE TITLES from the sample above that best represent this format. DO NOT invent keywords - the system will extract keywords automatically from these representative titles.

Return ONLY a JSON array with this exact schema, no additional text, markdown blocks, or comments:
[
  { "name": "Format Name", "description": "Brief description", "representativeTitles": ["exact title 1 from sample", "exact title 2 from sample", "exact title 3 from sample"] }
]
    `;

    try {

        const rispostaTesto = await callWorker([
            { role: "system", content: "You are an expert in this creator's own content patterns, not generic YouTube taxonomy. Return ONLY valid JSON." },
            { role: "user", content: promptText }
        ], { temperature: 0.2, maxTokens: 1024 });

        return parseFormatsResponse(rispostaTesto, "expandFormatCoverage", sample);

    } catch (error) {
        console.error("Errore durante l'espansione della copertura formati:", error);
        return [];
    }
}

/**
 * Genera parole chiave per un formato a partire dai titoli REALI che ne
 * fanno parte (quando disponibili): estrae automaticamente le keyword
 * tokenizzando i titoli rappresentativi, senza usare l'AI per inventare
 * parole. Usata per creazione/rename manuale di un formato da
 * js_formats_manager.js — qui i titoli sono già naturalmente limitati
 * (i video di UN formato), quindi campioniamo comunque in modo uniforme
 * nel caso quel formato conti centinaia di video su un canale molto
 * grande.
 *
 * `channelTitles`, se fornito, è il campione di titoli DELL'INTERO
 * canale (non solo di questo formato): serve a scartare hashtag/parole
 * boilerplate onnipresenti (es. "#brawlstars #shorts"), che altrimenti
 * verrebbero scelti come keyword "frequenti" pur non distinguendo nulla
 * — stesso principio usato in discoverChannelFormats/expandFormatCoverage.
 *
 * Se non ci sono titoli (formato creato da zero, senza ancora video
 * assegnati) ricade sul comportamento precedente come fallback.
 * Ritorna sempre un array (mai null).
 */
export async function generateKeywordsForFormat(name, description = "", memberTitles = [], channelTitles = []) {

    const fallback = String(name || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

    if (!name) {
        return fallback;
    }

    const hasRealTitles = Array.isArray(memberTitles) && memberTitles.length > 0;

    // Se abbiamo titoli reali, estraiamo le keyword automaticamente
    // senza usare l'AI - questo evita che l'AI inventi parole che non
    // esistono nei titoli
    if (hasRealTitles) {
        const sample = sampleEvenly(memberTitles, 20);
        const keywords = extractKeywordsFromTitles(sample, channelTitles);
        return keywords.length > 0 ? keywords : fallback;
    }

    // Fallback: se non abbiamo titoli, usiamo l'AI per generare keyword
    // dal nome e descrizione (comportamento precedente)
    const promptText = `
Generate keywords to automatically identify Brawl Stars YouTube Shorts titles belonging to this format:

Format name: "${name}"
Description: "${description || "No description provided"}"

No example titles are available yet for this format, so infer from the name and description as best you can.

Return ONLY a JSON array of 4–8 short, lowercase keywords, no additional text. Example: ["trickshot","goal","perfect"]
    `;

    try {

        const rispostaTesto = await callWorker([
            { role: "system", content: "You are an expert in extracting real, grounded keywords from actual video titles. Return ONLY valid JSON." },
            { role: "user", content: promptText }
        ], { temperature: 0.2, maxTokens: 512 });

        const keywords = safeParseJsonArray(rispostaTesto, "generateKeywordsForFormat");

        const rawKeywords = Array.isArray(keywords) && keywords.length > 0
            ? keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean)
            : [];

        if (rawKeywords.length === 0) {
            return fallback;
        }

        return rawKeywords;

    } catch (error) {
        console.error("Errore durante la generazione delle keyword AI:", error);
        return fallback;
    }
}
export async function analizzaFormatiSconosciuti(titoliSconosciuti) {

    if (!Array.isArray(titoliSconosciuti) || titoliSconosciuti.length === 0) {
        return null;
    }

    const promptText = `
Analyze these Brawl Stars YouTube Shorts titles and group them into a maximum of 3 consistent, custom formats (e.g., "Gameplay Commentary", "Box Opening", "Brawler Guide").

Titles:
${titoliSconosciuti.slice(0, 15).join("\n")}

Return only a valid JSON file with this exact schema:
[
  { "name": "Format Name 1", "keywords": ["keyword1", "keyword2"] },
  { "name": "Format Name 2", "keywords": ["keyword3", "keyword4"] }
]
Return ONLY the raw JSON, without markdown code blocks (like \`\`\`json) or comments.
    `;

    try {

        const testoRisposta = await callWorker([
            { role: "system", content: "You are an expert in YouTube content taxonomy. Return ONLY valid JSON." },
            { role: "user", content: promptText }
        ]);

        const jsonPulito = testoRisposta.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(jsonPulito);

    } catch (error) {
        console.error("Errore durante l'analisi AI dei formati sconosciuti:", error);
        return null;
    }
}