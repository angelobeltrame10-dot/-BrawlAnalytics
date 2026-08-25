const TERMINAL_PHRASES = [
    "score your video's virality",
    "spot the winning format",
    "track what actually performs",
    "turn ideas into ranked scripts",
    "optimize before you publish"
];

export function initTerminalPrompt() {
    const text = document.getElementById("terminal-prompt-text");
    if (!text || text.dataset.terminalReady === "1") return;

    text.dataset.terminalReady = "1";

    let phraseIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let pauseTimer = null;

    const tick = () => {
        const phrase = TERMINAL_PHRASES[phraseIndex];
        text.textContent = phrase.slice(0, characterIndex);

        if (!deleting && characterIndex < phrase.length) {
            characterIndex += 1;
            pauseTimer = window.setTimeout(tick, 52);
            return;
        }

        if (!deleting) {
            deleting = true;
            pauseTimer = window.setTimeout(tick, 1750);
            return;
        }

        if (characterIndex > 0) {
            characterIndex -= 1;
            pauseTimer = window.setTimeout(tick, 28);
            return;
        }

        deleting = false;
        phraseIndex = (phraseIndex + 1) % TERMINAL_PHRASES.length;
        pauseTimer = window.setTimeout(tick, 260);
    };

    tick();

    window.addEventListener("pagehide", () => {
        if (pauseTimer) window.clearTimeout(pauseTimer);
    }, { once: true });
}
