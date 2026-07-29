/* ==========================================================
   BRAWL ANALYTICS
   Scroll Reveal Animations
========================================================== */

function initScrollReveal(){

    const observerOptions = {

        threshold: 0.1,

        rootMargin: '0px 0px -50px 0px'

    };

    const observer = new IntersectionObserver((entries) => {

        entries.forEach(entry => {

            if(entry.isIntersecting){

                entry.target.classList.add('revealed');

                observer.unobserve(entry.target);

            }

        });

    }, observerOptions);

    document.querySelectorAll('.scroll-reveal').forEach(el => {

        observer.observe(el);

    });

}

export { initScrollReveal };
