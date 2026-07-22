/* ==========================================================
   BRAWL ANALYTICS
   CSV FIELD MAPPING

   Punto UNICO di conoscenza su come si chiamano le colonne
   dell'export "Contenuti" di YouTube Studio, nelle lingue
   supportate.

   PERCHÉ QUESTO MODULO ESISTE:
   Prima di questo file, ogni modulo (js_fomats.js, js_api.js,
   js_dashboard.js, js_channel_analysis.js, js_formats_manager.js,
   js_analytics.js) duplicava a mano la stessa catena di fallback,
   es.:
       video["Titolo video"] || video["Titolo"] || video["Contenuti"] || ...
   Bastava che UNO di questi punti avesse un ordine diverso, o
   mancasse una chiave, perché qualcosa si rompesse in silenzio.
   È esattamente quello che è successo: "Contenuti" è l'ID
   YouTube del video (es. "6jJk7Vx0vlo"), non il titolo — ma
   essendo SEMPRE presente e non vuoto, un `||` messo nell'ordine
   sbagliato lo faceva vincere sempre, alimentando l'intera
   pipeline AI con ID casuali invece che con titoli veri, senza
   che nessun log lo segnalasse come "campo mancante".

   Da qui in avanti: un solo punto da aggiornare se YouTube
   cambia il nome di una colonna, o se serve supportare una
   lingua nuova. Tutti gli altri file importano da qui.

   NOTA SULLA STRATEGIA SCELTA:
   Si è preferita una lista statica multi-lingua invece di un
   riconoscimento automatico via AI delle colonne. Motivo: le
   colonne di un export YouTube Studio sono un insieme piccolo e
   stabile (poche decine di lingue), quindi una lista esplicita è
   deterministica, a costo zero, e non introduce un'altra
   chiamata AI (con relativa latenza/possibilità di fallimento)
   solo per capire quale colonna leggere. Il riconoscimento
   automatico resta un'opzione valida in futuro se dovesse
   arrivare una lingua non coperta qui sotto.
========================================================== */

// "Contenuti" NON è mai in queste liste: in italiano è l'ID del
// video, non il titolo — includerlo qui riprodurrebbe esattamente
// il bug appena risolto.
const TITLE_HEADERS = [

    // Italiano
    "Titolo video",
    "Titolo",

    // Inglese
    "Video title",
    "Title",

    // Spagnolo
    "Título del video",
    "Título del vídeo",
    "Título",

    // Francese
    "Titre de la vidéo",
    "Titre",

    // Tedesco
    "Videotitel",
    "Titel",

    // Portoghese (PT e BR usano la stessa dicitura)
    "Título do vídeo",

    // Chiavi generiche usate per dati non-CSV (es. formati creati
    // manualmente, video passati come oggetti semplici altrove
    // nel progetto)
    "title",
    "name"

];

const VIEWS_HEADERS = [

    // Italiano
    "Visualizzazioni",

    // Inglese
    "Views",

    // Spagnolo
    "Visualizaciones",

    // Francese
    "Vues",

    // Tedesco
    "Aufrufe",

    // Portoghese
    "Visualizações",

    // Chiavi generiche
    "views"

];

const RETENTION_HEADERS = [

    // Italiano
    "Percentuale media visualizzata (%)",
    "Ha continuato a guardare (%)",

    // Inglese
    "Average percentage viewed (%)",
    "Average view percentage (%)",

    // Chiave generica
    "retention"

];

/**
 * Cerca il primo header, tra quelli passati, che esiste sul video
 * con un valore non vuoto. L'ID video ("Contenuti" in italiano) non
 * fa mai parte di queste liste, quindi qui non può mai "vincere per
 * sbaglio" come accadeva prima.
 */
function readField(video, headers, fallback) {

    if (!video) {
        return fallback;
    }

    for (const header of headers) {
        const value = video[header];
        if (value !== undefined && value !== null && String(value).trim() !== "") {
            return value;
        }
    }

    return fallback;

}

/**
 * Titolo leggibile del video, indipendentemente dalla lingua del
 * CSV. Non ricade MAI sulla colonna ID.
 */
export function getVideoTitle(video) {
    return readField(video, TITLE_HEADERS, "Untitled");
}

/**
 * Converte un valore numerico che potrebbe arrivare come stringa
 * con separatori delle migliaia (",", ".") — stesso comportamento
 * difensivo già presente prima in js_analytics.js — oppure già come
 * vero Number (il caso più comune: js_csv-parser.js converte già i
 * campi numerici durante il parsing del CSV).
 */
function toNumber(raw) {

    if (typeof raw === "number") {
        return Number.isNaN(raw) ? 0 : raw;
    }

    const parsed = Number(String(raw ?? "").replace(/,/g, "").replace(/\./g, ""));
    return Number.isNaN(parsed) ? 0 : parsed;

}

/**
 * Visualizzazioni del video, come numero. Ritorna 0 se il campo
 * manca o non è valido.
 */
export function getVideoViews(video) {
    return toNumber(readField(video, VIEWS_HEADERS, 0));
}

/**
 * Percentuale media di retention del video, come numero. Ritorna 0
 * se il campo manca o non è valido.
 */
export function getVideoRetention(video) {
    return toNumber(readField(video, RETENTION_HEADERS, 0));
}