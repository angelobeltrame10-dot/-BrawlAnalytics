(() => {
    const $ = selector => document.querySelector(selector);
    const uploadStage = $("#upload-stage");
    const wizardStage = $("#wizard-stage");
    const analysisStage = $("#analysis-stage");
    const resultsStage = $("#results-stage");
    const videoInput = $("#video-input");
    const uploadZone = $("#upload-zone");
    const questions = [
        { title: "How original is your video?", copy: "Give us a quick sense of the footage and edit.", type: "buttons", options: ["Completely original", "Mostly original", "Mostly reused"] },
        { title: "How original is the idea?", copy: "This helps frame your creative angle.", type: "buttons", options: ["Completely original", "Inspired by another creator", "Copy of another creator"] },
        { title: "Which format best describes this video?", copy: "Choose the one closest to the viewer experience.", type: "formats", options: ["Trickshot", "Challenge", "Funny Moments", "Ranked", "Guide", "Story", "Meme", "Other"] },
        { title: "Write a short description of your video.", copy: "A sentence or two is enough for this demo.", type: "description" }
    ];
    const analysisSteps = ["Reading video", "Detecting hook", "Detecting on-screen text", "Comparing with previous Shorts", "Reading current trends", "Estimating virality"];
    const breakdown = [["Hook",96],["Trend",91],["Originality",87],["Format",93],["Duration",84],["Editing",89],["Text",78]];
    const tips = ["Trending topics usually perform best within 48 hours.", "Schedule your Shorts instead of publishing immediately.", "Avoid long static endings: give viewers a reason to loop.", "A clear visual change in the first second earns attention."];
    let questionIndex = 0;
    let tipIndex = 0;

    function show(el) { el.hidden = false; requestAnimationFrame(() => el.classList.add("active")); }
    function hide(el) { el.hidden = true; el.classList.remove("active"); }
    function beginUpload(file) {
        $("#file-name").textContent = file?.name || "brawl-stars-short.mp4";
        $("#upload-progress").hidden = false;
        uploadZone.hidden = true;
        let progress = 0;
        const timer = setInterval(() => {
            progress = Math.min(progress + 9 + Math.random() * 13, 100);
            $("#upload-bar").style.width = `${progress}%`;
            $("#upload-percent").textContent = `${Math.round(progress)}%`;
            $("#upload-copy").textContent = progress < 70 ? "Encrypting upload and preparing workspace…" : "Video ready — opening context wizard…";
            if (progress >= 100) {
                clearInterval(timer);
                setTimeout(startWizard, 550);
            }
        }, 210);
    }
    function startWizard() {
        hide(uploadStage); show(wizardStage); renderQuestion();
        wizardStage.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function renderQuestion() {
        const question = questions[questionIndex];
        $("#wizard-step").textContent = `02 — Context · ${questionIndex + 1} of ${questions.length}`;
        $("#dot-progress").innerHTML = questions.map((_, i) => `<i class="${i <= questionIndex ? "active" : ""}"></i>`).join("");
        const panel = $("#question-panel");
        let input = "";
        if (question.type === "buttons") input = `<div class="answer-list">${question.options.map(option => `<button class="answer-button" type="button">${option}<span>→</span></button>`).join("")}</div>`;
        if (question.type === "formats") input = `<div class="format-list">${question.options.map(option => `<button class="format-option" type="button">${option}</button>`).join("")}</div>`;
        if (question.type === "description") input = `<textarea class="description-box" placeholder="Example: A fast-paced Colt trickshot in Brawl Ball with a surprising finish."></textarea><div class="wizard-actions"><button class="primary-button" id="continue-description" type="button">Create my report <span>→</span></button></div>`;
        panel.innerHTML = `<h2>${question.title}</h2><p>${question.copy}</p>${input}`;
        panel.style.animation = "none";
        requestAnimationFrame(() => { panel.style.animation = "fadeUp .35s both"; });
        panel.querySelectorAll(".answer-button, .format-option").forEach(button => button.addEventListener("click", () => {
            panel.querySelectorAll(".format-option").forEach(item => item.classList.remove("selected"));
            button.classList.add("selected");
            setTimeout(nextQuestion, 280);
        }));
        $("#continue-description")?.addEventListener("click", startAnalysis);
    }
    function nextQuestion() { questionIndex += 1; questionIndex < questions.length ? renderQuestion() : startAnalysis(); }
    function startAnalysis() {
        hide(wizardStage); show(analysisStage);
        const list = $("#analysis-list");
        list.innerHTML = analysisSteps.map(step => `<div>${step}</div>`).join("");
        analysisStage.scrollIntoView({ behavior: "smooth", block: "center" });
        let index = 0;
        const interval = setInterval(() => {
            const nodes = list.querySelectorAll("div");
            nodes[index].classList.add("done");
            index += 1;
            $("#analysis-bar").style.width = `${Math.round(index / analysisSteps.length * 100)}%`;
            $("#analysis-caption").textContent = index < analysisSteps.length ? analysisSteps[index] : "Report complete";
            if (index === analysisSteps.length) { clearInterval(interval); setTimeout(showResults, 650); }
        }, 570);
    }
    function showResults() {
        hide(analysisStage); show(resultsStage); renderBreakdown();
        resultsStage.scrollIntoView({ behavior: "smooth", block: "start" });
        countScore();
    }
    function renderBreakdown() {
        $("#breakdown-grid").innerHTML = breakdown.map(([name, value]) => `<div class="breakdown-row"><div><span>${name}</span><strong>${value}</strong></div><div class="progress-track"><i style="width:${value}%"></i></div></div>`).join("");
    }
    function countScore() {
        const target = 92; const counter = $("#score-counter"); let current = 0;
        const timer = setInterval(() => { current = Math.min(current + 2, target); counter.textContent = current; if (current === target) clearInterval(timer); }, 25);
    }
    function reset() {
        questionIndex = 0; hide(wizardStage); hide(analysisStage); hide(resultsStage); show(uploadStage);
        uploadZone.hidden = false; $("#upload-progress").hidden = true; $("#upload-bar").style.width = "0"; videoInput.value = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    videoInput.addEventListener("change", event => beginUpload(event.target.files[0]));
    ["dragenter", "dragover"].forEach(eventName => uploadZone.addEventListener(eventName, event => { event.preventDefault(); uploadZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(eventName => uploadZone.addEventListener(eventName, event => { event.preventDefault(); uploadZone.classList.remove("dragging"); }));
    uploadZone.addEventListener("drop", event => beginUpload(event.dataTransfer.files[0]));
    $("#restart-button").addEventListener("click", reset);
    $("#new-analysis").addEventListener("click", reset);
    $("#next-tip").addEventListener("click", () => { tipIndex = (tipIndex + 1) % tips.length; $("#tip-text").textContent = tips[tipIndex]; });
})();
