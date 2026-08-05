export function initLayout417(){
    const track = document.getElementById('layout417-track');
    if(!track) return;

    // Prevent double initialization on same track
    if(track.dataset.layout417Init === '1') return;
    track.dataset.layout417Init = '1';

    const stack = track.querySelector('.layout-417__stack');
    const cards = Array.from(track.querySelectorAll('.layout-417__card'));
    const dots = Array.from(track.querySelectorAll('.layout-417__dot'));
    const torn = track.querySelector('.layout-417__torn-sticky');
    const totalCards = cards.length;
    if(totalCards === 0 || !stack) return;

    // Configurable: how many viewport-heights per card (default 100vh)
    const viewsPerCard = parseFloat(track.dataset.vhPerCard) || 100;

    // Explicitly set the track height so it's fixed and does not depend on content
    const totalTrackVH = viewsPerCard * totalCards;
    // Set as CSS value including unit to keep it explicit (not 'auto')
    track.style.height = totalTrackVH + 'vh';

    let currentIndex = -1;
    let ticking = false;

    function updateCards(newIndex){
        newIndex = Math.max(0, Math.min(totalCards - 1, newIndex));
        if(newIndex === currentIndex) return;

        cards.forEach((card, idx) => {
            const isActive = idx === newIndex;
            card.classList.toggle('active', isActive);
            // keep in DOM but hide non-active via opacity to allow crossfade
            card.setAttribute('aria-hidden', !isActive);
        });

        dots.forEach((dot, idx) => {
            dot.classList.toggle('active', idx === newIndex);
        });

        currentIndex = newIndex;
    }

    // Calculate progress using only getBoundingClientRect() of the track
    // and the viewport height. This avoids using stack/card heights which
    // can change and cause jitter.
    function calcProgress(){
        const rect = track.getBoundingClientRect();
        const vh = window.innerHeight;
        const scrollable = Math.max(0, rect.height - vh);

        // When the top of the track is above the viewport, -rect.top is how much
        // we've scrolled into the track. Normalize by the total scrollable distance.
        const scrolledInto = Math.min(Math.max(-rect.top, 0), scrollable);
        const progress = scrollable > 0 ? scrolledInto / scrollable : 0;
        return Math.min(1, Math.max(0, progress));
    }

    function onScrollFrame(){
        ticking = false;
        const progress = calcProgress();

        // Map progress [0..1] to card index segments. Each card gets equal segment.
        let idx = Math.floor(progress * totalCards);
        if(idx >= totalCards) idx = totalCards - 1;
        updateCards(idx);

        // Optional debug: enable by adding `data-debug="1"` on the track
        if(track.dataset.debug === '1'){
            console.log('[layout417] progress=', progress.toFixed(3), 'index=', idx);
        }
        // torn divider: show once we start scrolling inside the track
        if(torn){
            torn.classList.toggle('visible', progress > 0);
            
            // Lock torn divider when FAQ section is near
            const faqSection = document.getElementById('faq');
            if(faqSection){
                const trackRect = track.getBoundingClientRect();
                const faqRect = faqSection.getBoundingClientRect();
                
                // Lock when FAQ is entering viewport (within 50px of bottom)
                if(faqRect.top < window.innerHeight + 50 && faqRect.top > 0){
                    torn.classList.add('locked');
                } else {
                    torn.classList.remove('locked');
                }
            }
        }
    }

    function onScroll(){
        if(!ticking){
            ticking = true;
            requestAnimationFrame(onScrollFrame);
        }
    }

    // Attach listeners once
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Dot click behavior: scroll to the center of the segment for that dot
    dots.forEach((dot, idx) => {
        dot.addEventListener('click', () => {
            const rect = track.getBoundingClientRect();
            const vh = window.innerHeight;
            const scrollable = Math.max(0, rect.height - vh);
            const segment = scrollable / totalCards;
            const targetScrolledInto = segment * (idx + 0.5);
            const targetTop = window.scrollY + rect.top + targetScrolledInto;
            window.scrollTo({ top: Math.max(0, Math.round(targetTop)), behavior: 'smooth' });
        });
    });

    // Initialize to the correct card immediately
    onScrollFrame();
}

// Robust auto-init: ensure we only boot once even if module is imported multiple times
function boot(){
    if(window.__layout417_booted) return;
    window.__layout417_booted = true;

    const tryInit = () => {
        const track = document.getElementById('layout417-track');
        if(track) initLayout417();
    };

    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', tryInit);
        window.addEventListener('load', tryInit);
    } else {
        tryInit();
    }
}

boot();