/* ==========================================================
   BRAWL ANALYTICS
   FORMAT DETECTOR
========================================================== */

import { getVideoTitle, getVideoViews } from "./js_csv_fields.js";

const DEFAULT_FORMAT_RULES = {

    Trickshot: ["trickshot", "goal", "skill", "perfect", "insane"],
    Challenge: ["challenge", "only", "can i", "try"],
    FunnyMoment: ["funny", "lol", "fail", "moment", "haha"],
    Gameplay: ["ranked", "battle", "gameplay", "match"],
    Tutorial: ["how", "guide", "tips", "tutorial"]

};

function normalizeText(text) {
    return String(text || "").toLowerCase().trim();
}

/**
 * Tokenizza e normalizza un testo per matching più intelligente.
 * Rimuove punteggiatura, converte in lowercase, split in parole.
 */
function tokenizeText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Sostituisci punteggiatura con spazi
        .replace(/\s+/g, ' ')       // Unisci spazi multipli
        .trim()
        .split(' ')
        .filter(word => word.length > 0);
}

/**
 * Controlla se le keyword matchano il titolo usando matching
 * tokenizzato più intelligente. Supporta:
 * - Multi-word keywords (es. "1 hp" matcha "1 HP comeback")
 * - Case insensitive
 * - Punctuation insensitive
 * - Parole singole o frasi
 */
function matchesKeywords(title, keywords) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
        return false;
    }

    const titleTokens = tokenizeText(title);
    const titleLower = normalizeText(title);

    // Per ogni keyword, verifica se matcha
    return keywords.some(keyword => {
        const keywordLower = String(keyword || "").toLowerCase().trim();
        if (!keywordLower) return false;

        // Se la keyword contiene spazi (multi-word), verifica che tutte
        // le parole siano presenti nel titolo (in qualsiasi ordine)
        if (keywordLower.includes(' ')) {
            const keywordTokens = tokenizeText(keywordLower);
            // Tutte le parole della keyword devono essere presenti nel titolo
            return keywordTokens.every(kwToken => titleTokens.includes(kwToken));
        }

        // Single-word keyword: verifica substring o token esatto
        // Prima prova substring per compatibilità con vecchio comportamento
        if (titleLower.includes(keywordLower)) {
            return true;
        }

        // Poi prova token esatto (più preciso)
        return titleTokens.includes(keywordLower);
    });
}

function normalizeKeywords(keywords) {
    if (Array.isArray(keywords)) {
        return keywords.map(keyword => String(keyword || "").toLowerCase().trim()).filter(Boolean);
    }

    if (typeof keywords === "string") {
        return keywords.split(",").map(keyword => String(keyword || "").toLowerCase().trim()).filter(Boolean);
    }

    return [];
}

function buildFormatRules(customFormats = []) {
    const rules = {};

    // I formati personalizzati (inclusi quelli rilevati dall'AI) vengono
    // inseriti PRIMA di quelli di default. In detectFormat() vince il
    // primo match trovato scorrendo le regole in ordine: se i default
    // restassero in testa, le loro keyword generiche (es. "battle",
    // "ranked", "challenge", "how", "funny") — parole comunissime in
    // qualunque titolo Brawl Stars — intercetterebbero la maggior parte
    // dei video prima ancora che le regole specifiche del creator
    // abbiano la possibilità di essere valutate. I default restano solo
    // come fallback per ciò che nessun formato specifico cattura.
    (customFormats || []).forEach(format => {
        const name = String(format?.name || format?.title || format?.format || "").trim();
        if (!name) {
            return;
        }

        const keywords = normalizeKeywords(format?.keywords || format?.terms || format?.values || []);
        if (keywords.length > 0) {
            rules[name] = keywords;
        }
    });

    Object.entries(DEFAULT_FORMAT_RULES).forEach(([name, keywords]) => {
        // Non sovrascrivere un formato personalizzato che usa già questo nome.
        if (!(name in rules)) {
            rules[name] = [...keywords];
        }
    });

    return rules;
}

function detectFormat(video, customFormats = []) {
    const title = getVideoTitle(video);
    const rules = buildFormatRules(customFormats);

    for (const [format, keywords] of Object.entries(rules)) {
        const normalizedKeywords = normalizeKeywords(keywords);
        if (matchesKeywords(title, normalizedKeywords)) {
            return format;
        }
    }

    return "Other";
}

function classifyVideos(videos, customFormats = []) {
    if (!Array.isArray(videos)) {
        return [];
    }

    return videos.map(video => ({
        ...video,
        format: detectFormat(video, customFormats)
    }));
}

/**
 * Mappa titolo → nome formato per tutte le assegnazioni MANUALI
 * (format.associatedVideos, gestite dal Formats Manager). Se lo
 * stesso titolo è associato a più formati, vince il primo in ordine
 * di customFormats — un video non deve mai contare due volte.
 */
function buildManualAssignmentMap(customFormats = []) {
    const map = new Map();

    (customFormats || []).forEach(format => {
        const name = String(format?.name || "").trim();
        if (!name) return;

        if (Array.isArray(format.associatedVideos) && format.associatedVideos.length > 0) {
            format.associatedVideos.forEach(title => {
                if (title && !map.has(title)) {
                    map.set(title, name);
                }
            });
        }
    });

    return map;
}

/**
 * Come detectFormat(), ma controlla PRIMA le assegnazioni manuali e
 * ricade sul keyword-matching solo per i video non assegnati a mano.
 */
function detectFormatEffective(video, customFormats, manualMap) {
    const title = getVideoTitle(video);

    if (manualMap.has(title)) {
        return manualMap.get(title);
    }

    return detectFormat(video, customFormats);
}

function classifyVideosEffective(videos, customFormats = []) {
    if (!Array.isArray(videos)) {
        return [];
    }

    const manualMap = buildManualAssignmentMap(customFormats);

    return videos.map(video => ({
        ...video,
        format: detectFormatEffective(video, customFormats, manualMap)
    }));
}

function getFormatRanking(videos, customFormats = []) {
    if (!Array.isArray(videos)) {
        return {};
    }

    const manualMap = buildManualAssignmentMap(customFormats);
    const ranking = {};

    videos.forEach(video => {
        const format = video.format || detectFormatEffective(video, customFormats, manualMap);
        if (!ranking[format]) {
            ranking[format] = 0;
        }
        ranking[format]++;
    });

    return ranking;
}

function calculateFormatScores(videos, customFormats = []) {
    if (!Array.isArray(videos)) return {};

    const classified = videos.every(video => video.format)
        ? videos
        : classifyVideosEffective(videos, customFormats);

    const performance = {};

    classified.forEach(video => {
        const format = video.format || "Other";
        const views = getVideoViews(video);

        if (!performance[format]) {
            performance[format] = {
                videoCount: 0,
                totalViews: 0,
                averageViews: 0
            };
        }

        performance[format].videoCount += 1;
        performance[format].totalViews += views;
    });

    Object.values(performance).forEach(formatStat => {
        formatStat.averageViews = formatStat.videoCount > 0
            ? formatStat.totalViews / formatStat.videoCount
            : 0;
    });

    return performance;
}

function getTopFormat(videos, customFormats = []) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return "Unknown";
    }

    const performance = calculateFormatScores(videos, customFormats);
    const entries = Object.entries(performance)
        .filter(([format]) => format !== "Other")
        .sort(([, a], [, b]) => {
            // Ordina per totalViews PRIMA (criterio principale)
            if (b.totalViews !== a.totalViews) return b.totalViews - a.totalViews;
            // Tie-breaker: averageViews
            if (b.averageViews !== a.averageViews) return b.averageViews - a.averageViews;
            // Tie-breaker finale: videoCount
            return b.videoCount - a.videoCount;
        });

    return entries.length > 0 ? entries[0][0] : "Unknown";
}

function getTopFormats(videos, customFormats = [], count = 3) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return [];
    }

    const performance = calculateFormatScores(videos, customFormats);

    return Object.entries(performance)
        .filter(([format]) => format !== "Other")
        .sort(([, a], [, b]) => {
            if (b.averageViews !== a.averageViews) return b.averageViews - a.averageViews;
            if (b.totalViews !== a.totalViews) return b.totalViews - a.totalViews;
            return b.videoCount - a.videoCount;
        })
        .slice(0, count)
        .map(([format]) => format);
}

export {
    DEFAULT_FORMAT_RULES,
    detectFormat,
    classifyVideos,
    getTopFormat,
    getTopFormats,
    getFormatRanking,
    buildFormatRules,
    normalizeKeywords,
    classifyVideosEffective,
    buildManualAssignmentMap,
    detectFormatEffective,
    calculateFormatScores
};