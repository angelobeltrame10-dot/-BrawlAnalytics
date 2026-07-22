/* ==========================================================
   BRAWL ANALYTICS
   FORMAT DETECTOR

   Responsabilità:
   - Riconoscere formato video
   - Raggruppare Shorts
   - Preparare ranking formati
   - Supportare formati personalizzati

   Futuro:
   - AI classification
   - Analisi descrizioni
   - Analisi hashtag
========================================================== */

const DEFAULT_FORMAT_RULES = {

    Trickshot: ["trickshot", "goal", "skill", "perfect", "insane"],
    Challenge: ["challenge", "only", "can i", "try"],
    FunnyMoment: ["funny", "lol", "fail", "moment", "haha"],
    Gameplay: ["ranked", "battle", "gameplay", "match"],
    Tutorial: ["how", "guide", "tips", "tutorial"]

};

function normalizeText(text){
    return String(text || "").toLowerCase().trim();
}

function normalizeKeywords(keywords){
    if(Array.isArray(keywords)){
        return keywords.map(keyword => String(keyword || "").toLowerCase().trim()).filter(Boolean);
    }

    if(typeof keywords === "string"){
        return keywords.split(",").map(keyword => String(keyword || "").toLowerCase().trim()).filter(Boolean);
    }

    return [];
}

function buildFormatRules(customFormats = []){
    const rules = {};
    Object.entries(DEFAULT_FORMAT_RULES).forEach(([name, keywords]) => {
        rules[name] = [...keywords];
    });

    (customFormats || []).forEach(format => {
        const name = String(format?.name || format?.title || format?.format || "").trim();
        if(!name){
            return;
        }

        const keywords = normalizeKeywords(format?.keywords || format?.terms || format?.values || []);
        if(keywords.length > 0){
            rules[name] = keywords;
        }
    });

    return rules;
}

function detectFormat(video, customFormats = []){
    const title = normalizeText(video?.title || video?.Title || video?.name);
    const rules = buildFormatRules(customFormats);

    for(const [format, keywords] of Object.entries(rules)){
        const matches = normalizeKeywords(keywords).some(keyword => title.includes(keyword));
        if(matches){
            return format;
        }
    }

    return "Other";
}

function classifyVideos(videos, customFormats = []){
    if(!Array.isArray(videos)){
        return [];
    }

    return videos.map(video => ({
        ...video,
        format: detectFormat(video, customFormats)
    }));
}

function getFormatRanking(videos, customFormats = []){
    if(!Array.isArray(videos)){
        return {};
    }

    const ranking = {};
    videos.forEach(video => {
        const format = video.format || detectFormat(video, customFormats);
        if(!ranking[format]){
            ranking[format] = 0;
        }
        ranking[format]++;
    });

    return ranking;
}

function getTopFormat(videos, customFormats = []){
    if(!Array.isArray(videos) || videos.length === 0){
        return "Unknown";
    }

    const ranking = getFormatRanking(videos, customFormats);
    let best = "Unknown";
    let max = 0;

    Object.keys(ranking).forEach(format => {
        if(ranking[format] > max){
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
