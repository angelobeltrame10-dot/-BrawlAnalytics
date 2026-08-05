/* ==========================================================
   BRAWL ANALYTICS
   Hero Chart Line — Scroll-Driven SVG Animation

   A rising chart line that draws itself as the user scrolls
   down while at the top of the homepage. The page stays locked
   until the line reaches its end. Scrolling up reverses it.
========================================================== */

export function initHeroChartLine(){

    const hero = document.querySelector(".hero");
    if(!hero) return;

    /* --------------------------------------------------
       1. BUILD THE SVG
    -------------------------------------------------- */

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "hero-chart-svg");
    svg.setAttribute("viewBox", "0 0 1200 600");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    // A rising path from bottom-left to top-right with organic ups & downs
    const pathData =
        "M 0 520" +
        " C 30 520, 50 510, 80 490" +
        " S 120 430, 160 450" +
        " S 200 480, 240 420" +
        " S 280 350, 320 370" +
        " S 360 400, 400 340" +
        " S 440 280, 480 300" +
        " S 520 340, 560 270" +
        " S 600 220, 640 250" +
        " S 680 280, 720 210" +
        " S 760 160, 800 190" +
        " S 840 210, 880 150" +
        " S 920 110, 960 130" +
        " S 1000 100, 1040 80" +
        " S 1080 60, 1120 50" +
        " S 1160 40, 1200 30";

    // Gradient: Red (start) → Bright Green (end)
    const defs = document.createElementNS(svgNS, "defs");

    const gradient = document.createElementNS(svgNS, "linearGradient");
    gradient.setAttribute("id", "chart-line-gradient");
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("y1", "0%");
    gradient.setAttribute("x2", "100%");
    gradient.setAttribute("y2", "0%");

    const stop1 = document.createElementNS(svgNS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", "#FF3D57"); // Bright Red

    const stop2 = document.createElementNS(svgNS, "stop");
    stop2.setAttribute("offset", "45%");
    stop2.setAttribute("stop-color", "#FFAA00"); // Orange/Gold transition

    const stop3 = document.createElementNS(svgNS, "stop");
    stop3.setAttribute("offset", "100%");
    stop3.setAttribute("stop-color", "#00FF88"); // Bright Neon Green

    gradient.append(stop1, stop2, stop3);

    // Glow filter
    const filter = document.createElementNS(svgNS, "filter");
    filter.setAttribute("id", "chart-glow");
    filter.setAttribute("x", "-20%");
    filter.setAttribute("y", "-20%");
    filter.setAttribute("width", "140%");
    filter.setAttribute("height", "140%");

    const feGaussian = document.createElementNS(svgNS, "feGaussianBlur");
    feGaussian.setAttribute("stdDeviation", "6");
    feGaussian.setAttribute("result", "coloredBlur");

    const feMerge = document.createElementNS(svgNS, "feMerge");
    const feMergeNode1 = document.createElementNS(svgNS, "feMergeNode");
    feMergeNode1.setAttribute("in", "coloredBlur");
    const feMergeNode2 = document.createElementNS(svgNS, "feMergeNode");
    feMergeNode2.setAttribute("in", "SourceGraphic");
    feMerge.append(feMergeNode1, feMergeNode2);
    filter.append(feGaussian, feMerge);

    defs.append(gradient, filter);
    svg.appendChild(defs);

    // Glow line (behind)
    const glowPath = document.createElementNS(svgNS, "path");
    glowPath.setAttribute("d", pathData);
    glowPath.setAttribute("fill", "none");
    glowPath.setAttribute("stroke", "url(#chart-line-gradient)");
    glowPath.setAttribute("stroke-width", "4");
    glowPath.setAttribute("stroke-linecap", "round");
    glowPath.setAttribute("stroke-linejoin", "round");
    glowPath.setAttribute("filter", "url(#chart-glow)");
    glowPath.setAttribute("opacity", "0.6");
    glowPath.setAttribute("class", "hero-chart-glow");

    // Main line
    const mainPath = document.createElementNS(svgNS, "path");
    mainPath.setAttribute("d", pathData);
    mainPath.setAttribute("fill", "none");
    mainPath.setAttribute("stroke", "url(#chart-line-gradient)");
    mainPath.setAttribute("stroke-width", "2.8");
    mainPath.setAttribute("stroke-linecap", "round");
    mainPath.setAttribute("stroke-linejoin", "round");
    mainPath.setAttribute("class", "hero-chart-path");

    svg.append(glowPath, mainPath);
    hero.appendChild(svg);

    /* --------------------------------------------------
       2. MEASURE & SET UP DASH ANIMATION
    -------------------------------------------------- */

    const totalLength = mainPath.getTotalLength();

    mainPath.style.strokeDasharray = totalLength;
    mainPath.style.strokeDashoffset = totalLength;

    glowPath.style.strokeDasharray = totalLength;
    glowPath.style.strokeDashoffset = totalLength;

    /* --------------------------------------------------
       3. SCROLL-DRIVEN PROGRESS CONTROLLER
    -------------------------------------------------- */

    let progress = 0;          // 0 → 1
    let isLocked = true;
    const SENSITIVITY = 0.0012; // how much each wheel tick advances the line
    const TOUCH_SENSITIVITY = 0.003;

    let touchStartY = 0;
    let touchLastY = 0;

    function setProgress(p){
        progress = Math.max(0, Math.min(1, p));

        const offset = totalLength * (1 - progress);
        mainPath.style.strokeDashoffset = offset;
        glowPath.style.strokeDashoffset = offset;

        // Unlock scrolling once the line is fully drawn
        if(progress >= 1){
            isLocked = false;
        }
        // Re-lock if user is back at the very top and line isn't complete
        else if(window.scrollY <= 0){
            isLocked = true;
        }
    }

    function completeLine(){
        svg.classList.add('hero-chart-visible');
        setProgress(1);
    }

    function onWheel(e){
        // Only act when user is at the top of the page
        // (or page is locked by the animation)
        if(!isLocked && window.scrollY > 0) return;

        // Show chart on first scroll interaction
        svg.classList.add('hero-chart-visible');

        // Scroll DOWN → advance line
        if(e.deltaY > 0 && progress < 1){
            e.preventDefault();
            setProgress(progress + Math.abs(e.deltaY) * SENSITIVITY);
        }
        // Scroll UP → reverse line (only when page is at the very top)
        else if(e.deltaY < 0 && window.scrollY <= 0 && progress > 0){
            e.preventDefault();
            setProgress(progress - Math.abs(e.deltaY) * SENSITIVITY);
        }
    }

    function onTouchStart(e){
        touchStartY = e.touches[0].clientY;
        touchLastY = touchStartY;
    }

    function onTouchMove(e){
        const currentY = e.touches[0].clientY;
        const deltaY = touchLastY - currentY; // positive = scroll down
        touchLastY = currentY;

        if(!isLocked && window.scrollY > 0) return;

        // Show chart on first touch interaction
        svg.classList.add('hero-chart-visible');

        if(deltaY > 0 && progress < 1){
            e.preventDefault();
            setProgress(progress + Math.abs(deltaY) * TOUCH_SENSITIVITY);
        }
        else if(deltaY < 0 && window.scrollY <= 0 && progress > 0){
            e.preventDefault();
            setProgress(progress - Math.abs(deltaY) * TOUCH_SENSITIVITY);
        }
    }

    // Add listeners
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    // When navbar links (e.g. #pricing, #faq) are clicked, complete the animation
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener("click", () => {
            completeLine();
        });
    });

    // When page scrolls back to top, re-engage the lock if line isn't full
    window.addEventListener("scroll", () => {
        if(window.scrollY <= 0 && progress < 1){
            isLocked = true;
        }
    });

    // Store global reference if needed
    window.__completeHeroChartLine = completeLine;

    // Initialize
    setProgress(0);
}
