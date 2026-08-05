/* ==========================================================
   BRAWL ANALYTICS — PREMIUM POLISH SCRIPT
   Progressive enhancement only. No functional changes.
========================================================== */

function setupNavbarScrollState(){
    const navbar = document.getElementById("navbar");
    if(!navbar) return;
    let ticking = false;
    window.addEventListener("scroll", ()=>{
        if(ticking) return;
        ticking = true;
        requestAnimationFrame(()=>{
            navbar.classList.toggle("navbar--scrolled", window.scrollY > 8);
            ticking = false;
        });
    }, { passive:true });
}

function setupReveal(){
    if(!("IntersectionObserver" in window)) return;
    const targets = document.querySelectorAll(".stat-chip, .ba-col, .faq-item, .stat-mini");
    if(!targets.length) return;
    const io = new IntersectionObserver(entries=>{
        entries.forEach(entry=>{
            if(entry.isIntersecting){
                entry.target.classList.add("is-visible");
                io.unobserve(entry.target);
            }
        });
    }, { threshold:.15, rootMargin:"0px 0px -40px 0px" });
    targets.forEach((el, i)=>{
        el.classList.add("reveal", `reveal-${(i % 5) + 1}`);
        io.observe(el);
    });
}

function parseStatText(text){
    const match = String(text || "").trim().match(/^([\d.]+)([A-Za-z%+]*)$/);
    if(!match) return null;
    const decimals = (match[1].split(".")[1] || "").length;
    return { num: parseFloat(match[1]), suffix: match[2] || "", decimals };
}

function animateStat(el){
    const target = parseStatText(el.textContent);
    if(!target || el.dataset.animated === "true") return;
    el.dataset.animated = "true";
    const duration = 900;
    const start = performance.now();
    function tick(now){
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target.num * eased;
        el.textContent = (target.decimals ? val.toFixed(target.decimals) : Math.round(val)) + target.suffix;
        if(p < 1) requestAnimationFrame(tick);
        else el.textContent = target.num + target.suffix;
    }
    requestAnimationFrame(tick);
}

function setupStatCounters(){
    ["stat-creators", "stat-videos", "stat-ideas", "stat-feedback"].forEach(id=>{
        const el = document.getElementById(id);
        if(!el) return;
        const observer = new MutationObserver(()=>{
            if(el.dataset.animated === "true") return;
            animateStat(el);
        });
        observer.observe(el, { childList:true, characterData:true, subtree:true });
    });
}


function initPremiumPolish(){
    setupNavbarScrollState();
    setupReveal();
    // setupStatCounters(); // Disabled - stats animation now handled by js_public_stats.js with IntersectionObserver
}

if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initPremiumPolish);
} else {
    initPremiumPolish();
}