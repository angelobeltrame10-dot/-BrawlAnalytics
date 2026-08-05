import { discoverChannelFormats, expandFormatCoverage } from "./js_api.js";
import { saveCustomFormats, loadCustomFormats } from "./js_storage.js";
import { classifyVideosEffective, getFormatRanking } from "./js_fomats.js";
import { showMessage } from "./js_ui.js";
import { getVideoTitle as extractTitle } from "./js_csv_fields.js";

/*
    Perché questa pipeline scala a canali da 1000+ Shorts:

    1) discoverChannelFormats() riceve solo un CAMPIONE uniforme di
       titoli (vedi FORMAT_DETECTION_SAMPLE_SIZE dentro js_api.js), non
       l'intero canale — quindi il costo/tempo della chiamata AI è
       fisso, sia con 200 sia con 1000 video.

    2) La classificazione VERA di tutti i video (anche 1000) avviene
       SEMPRE in locale con classifyVideosEffective(), non tramite l'AI: è
       istantanea qualunque sia il numero di righe del CSV.
       classifyVideosEffective rispetta sia le assegnazioni manuali
       (format.associatedVideos) che il matching automatico via keyword,
       garantendo coerenza con la dashboard.

    3) Se dopo la prima passata resta "Other" una quota rilevante di
       video, facciamo un SECONDO giro mirato SOLO su un campione dei
       titoli non riconosciuti (expandFormatCoverage) — mai sull'intero
       canale una seconda volta.

    4) Un formato entra in dashboard solo se, alla classificazione reale
       finale, matcha davvero almeno MIN_VIDEOS_PER_FORMAT video. Questo
       è l'unico criterio di verità: elimina alla radice i formati
       "0 videos", perché il filtro usa la STESSA funzione che poi
       mostra i conteggi in dashboard — non l'elenco che l'AI dichiara
       di aver assegnato.
*/

// Se dopo la prima classificazione più di questa frazione di video resta
// "Other", proviamo un secondo giro mirato sui soli titoli non riconosciuti.
const UNMATCHED_REFINEMENT_THRESHOLD = 0.35;

// Sotto questo numero di video totali non vale la pena fare un secondo
// giro di AI: il campione sarebbe troppo piccolo per essere affidabile.
const MIN_VIDEOS_FOR_REFINEMENT = 15;

// Un formato viene mostrato in dashboard solo se, alla classificazione
// REALE contro tutti i video, matcha almeno questo numero di video.
// Impostato a 1 per garantire che anche formati con pochi video (es. 2-7)
// possano essere considerati se hanno performance elevate.
const MIN_VIDEOS_PER_FORMAT = 1;

export async function simulateChannelAnalysis(videoData = []){

    const progress =
    document.getElementById(
        "analysis-progress-bar"
    );

    const text =
    document.getElementById(
        "analysis-progress-text"
    );

    const live =
    document.getElementById(
        "analysis-live"
    );

    // Step 1: Reading CSV
    live.textContent = "Reading CSV...";
    progress.style.width = "20%";
    text.textContent = "20%";
    await new Promise(resolve => setTimeout(resolve, 1500));

    document.getElementById("step-1").classList.add("done");
    document.getElementById("step-1").innerHTML = "Step 1<br>✅ Reading CSV";

    // Step 2: Detecting formats — UNA SOLA chiamata AI su un campione
    // rappresentativo dell'intero canale (non solo i primi N titoli),
    // così il costo/tempo resta lo stesso sia con 200 sia con 1000 video.
    live.textContent = "Detecting formats...";
    progress.style.width = "40%";
    text.textContent = "40%";

    const allTitles = videoData
        .map(extractTitle)
        .filter(title => String(title).trim() !== "");

    let initialFormats = [];

    if (allTitles.length > 0) {
        try {
            initialFormats = await discoverChannelFormats(allTitles);

            if (initialFormats.length === 0) {
                console.warn("discoverChannelFormats ha restituito 0 formati. Controlla i log sopra per la risposta grezza dell'AI.");
            }
        } catch (error) {
            console.error("Error detecting formats:", error);
            showMessage("AI error while detecting formats — check console");
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    document.getElementById("step-2").classList.add("done");
    document.getElementById("step-2").innerHTML = "Step 2<br>✅ Detecting formats";

    // Step 3: Finding best performing format — classificazione LOCALE
    // (nessuna chiamata AI, quindi istantanea anche con 1000+ video) di
    // TUTTI i video: è la stessa funzione che la dashboard userà per
    // contare "X videos" nelle card, quindi il numero che vedrai è
    // sempre coerente con quello reale.
    live.textContent = "Finding your best performing format...";
    progress.style.width = "60%";
    text.textContent = "60%";

    const firstPass = classifyVideosEffective(videoData, initialFormats);

    const unmatchedTitles = firstPass
        .filter(video => !video.format || video.format === "Other")
        .map(extractTitle)
        .filter(title => String(title).trim() !== "");

    await new Promise(resolve => setTimeout(resolve, 800));

    document.getElementById("step-3").classList.add("done");
    document.getElementById("step-3").innerHTML = "Step 3<br>✅ Finding your best performing format";

    // Step 4: Building AI profile — se resta "Other" una quota rilevante
    // di video, un secondo giro MIRATO solo sui titoli non riconosciuti
    // (mai su tutto il canale una seconda volta), poi riclassifichiamo
    // per davvero e teniamo solo i formati che matchano abbastanza video.
    live.textContent = "Building AI profile...";
    progress.style.width = "80%";
    text.textContent = "80%";

    const unmatchedRatio = videoData.length > 0
        ? unmatchedTitles.length / videoData.length
        : 0;

    const shouldRefine =
        unmatchedTitles.length > 0 &&
        videoData.length >= MIN_VIDEOS_FOR_REFINEMENT &&
        (initialFormats.length === 0 || unmatchedRatio > UNMATCHED_REFINEMENT_THRESHOLD);

    let refinedFormats = [];

    if (shouldRefine) {
        try {
            const candidates = await expandFormatCoverage(unmatchedTitles, initialFormats);
            const existingNames = new Set(initialFormats.map(f => f.name.toLowerCase()));
            refinedFormats = candidates.filter(format => format?.name && !existingNames.has(format.name.toLowerCase()));
        } catch (error) {
            console.error("Error expanding format coverage:", error);
        }
    }

    const candidateFormats = [...initialFormats, ...refinedFormats];

    // Classificazione finale REALE contro tutti i video: è l'unico
    // criterio di verità usato per decidere quali formati sopravvivono.
    // Un formato che l'AI ha proposto ma che alla prova dei fatti non
    // matcha nessun video reale non arriva mai in dashboard.
    const finalClassified = classifyVideosEffective(videoData, candidateFormats);
    const finalRanking = getFormatRanking(finalClassified, candidateFormats);

    // NOTA: confrontiamo sempre con il nome TRIMMATO, perché
    // buildFormatRules() in js_fomats.js usa String(name).trim() come
    // chiave delle regole di classificazione — quindi finalRanking è
    // sempre indicizzato per nomi trimmati. Il fix principale è già a
    // monte in js_api.js (parseFormatsResponse trimma il nome appena
    // arriva dall'AI), ma questo trim() qui è una seconda rete di
    // sicurezza a costo zero.
    const formatsWithKeywords = candidateFormats.filter(
        format => (finalRanking[String(format.name).trim()] || 0) >= MIN_VIDEOS_PER_FORMAT
    );

    if (formatsWithKeywords.length === 0) {
        showMessage("AI didn't detect any format — check console for details");

        const sampleRealTitles = videoData
            .slice(0, 8)
            .map(extractTitle)
            .filter(Boolean);

        console.warn(
            "Nessun formato superstite dopo la classificazione reale.\n\n" +
            "FORMATI CANDIDATI PROPOSTI DALL'AI (nome + keyword usate per il match):\n" +
            JSON.stringify(candidateFormats.map(f => ({ name: f.name, keywords: f.keywords })), null, 2) +
            "\n\nCONTEGGIO REALE OTTENUTO (dovrebbe avere >=" + MIN_VIDEOS_PER_FORMAT + " per sopravvivere):\n" +
            JSON.stringify(finalRanking, null, 2) +
            "\n\nESEMPIO DI TITOLI REALI DEL CANALE (primi 8, per confronto con le keyword sopra):\n" +
            JSON.stringify(sampleRealTitles, null, 2)
        );
    }

    // Save formats to storage (merge con quelli già esistenti, senza duplicati)
    if (formatsWithKeywords.length > 0) {
        const existingFormats = await loadCustomFormats();
        const mergedFormats = [...existingFormats];

        for (const newFormat of formatsWithKeywords) {
            const exists = mergedFormats.some(f => f.name.toLowerCase() === newFormat.name.toLowerCase());
            if (!exists) {
                mergedFormats.push(newFormat);
            }
        }

        await saveCustomFormats(mergedFormats);
    }

    await new Promise(resolve => setTimeout(resolve, 1200));

    document.getElementById("step-4").classList.add("done");
    document.getElementById("step-4").innerHTML = "Step 4<br>✅ Building AI profile";

    // Step 5: Ready
    live.textContent = "Ready";
    progress.style.width = "100%";
    text.textContent = "100%";
    await new Promise(resolve => setTimeout(resolve, 1000));

    document.getElementById("step-5").classList.add("done");
    document.getElementById("step-5").innerHTML = "Step 5<br>✅ Ready";

    return formatsWithKeywords;
}