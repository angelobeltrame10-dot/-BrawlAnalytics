/* ==========================================================
   BRAWL ANALYTICS
   FORMAT DETECTOR
========================================================== */

import { getVideoTitle } from "./js_csv_fields.js";

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

function getFormatRanking(videos, customFormats = []) {
    if (!Array.isArray(videos)) {
        return {};
    }

    const ranking = {};

    videos.forEach(video => {
        const format = video.format || detectFormat(video, customFormats);
        if (!ranking[format]) {
            ranking[format] = 0;
        }
        ranking[format]++;
    });

    return ranking;
}

function getTopFormat(videos, customFormats = []) {
    if (!Array.isArray(videos) || videos.length === 0) {
        return "Unknown";
    }

    const classified = videos.every(video => video.format)
        ? videos
        : classifyVideos(videos, customFormats);

    const ranking = getFormatRanking(classified, customFormats);
    let best = "Unknown";
    let max = 0;

    Object.keys(ranking).forEach(format => {
        if (ranking[format] > max) {
            max = ranking[format];
            best = format;
        }
    });

    return best;
}

export {
    DEFAULT_FORMAT_RULES,
    detectFormat,
    classifyVideos,
    getTopFormat,
    getFormatRanking,
    buildFormatRules,
    normalizeKeywords
};