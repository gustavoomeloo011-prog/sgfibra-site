const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const navFolders = document.querySelectorAll(".nav-folder");

if (menuToggle && mainNav) {
  const closeMenu = () => {
    mainNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Abrir menu");
    navFolders.forEach((folder) => {
      folder.removeAttribute("open");
    });
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");
  });

  mainNav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      closeMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!mainNav.contains(event.target) && !menuToggle.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const carouselTracks = document.querySelectorAll(".plans-grid");

carouselTracks.forEach((track) => {
  const cards = Array.from(track.querySelectorAll(".plan-card"));

  if (cards.length < 2) {
    return;
  }

  let currentIndex = 0;
  let carouselTimer = null;

  track.classList.add("is-carousel");

  const setActiveCard = (nextIndex, behavior = "smooth") => {
    currentIndex = (nextIndex + cards.length) % cards.length;

    cards.forEach((card, index) => {
      card.classList.toggle("is-active", index === currentIndex);
    });

    const activeCard = cards[currentIndex];
    const targetLeft = activeCard.offsetLeft - ((track.clientWidth - activeCard.clientWidth) / 2);

    track.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: prefersReducedMotion ? "auto" : behavior
    });
  };

  const stopCarousel = () => {
    if (carouselTimer) {
      window.clearInterval(carouselTimer);
    }
  };

  const startCarousel = () => {
    stopCarousel();

    if (prefersReducedMotion) {
      return;
    }

    carouselTimer = window.setInterval(() => {
      setActiveCard(currentIndex + 1);
    }, 3600);
  };

  setActiveCard(0, "auto");
  startCarousel();

  track.addEventListener("mouseenter", stopCarousel);
  track.addEventListener("mouseleave", startCarousel);
  track.addEventListener("focusin", stopCarousel);
  track.addEventListener("focusout", startCarousel);
  track.addEventListener("touchstart", stopCarousel, { passive:true });
  track.addEventListener("touchend", startCarousel);

  window.addEventListener("resize", () => {
    setActiveCard(currentIndex, "auto");
  });
});

const revealItems = document.querySelectorAll(
  ".brand, .hero-content > *, .hero-card > img, .trust-strip div, .section-heading, .coverage-content > *, .app-content > *, .app-download-card, .location-photo-card, .plans-page-hero > div > *, .plans-page-hero img, .no-ads-highlight, .tv-programming, .addons-grid .addon-card, .app-hero-content > *, .app-phone-card img, .app-feature-grid article, .faq-link-grid a, .install-copy, .install-steps li, .download-panel, .legal-hero > *, .legal-card"
);

revealItems.forEach((item, index) => {
  item.classList.add("reveal-item");

  if (index % 2) {
    item.classList.add("reveal-from-right");
  }

  item.style.transitionDelay = `${Math.min(index * 35, 220)}ms`;
});

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => {
    item.classList.add("is-visible");
  });
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold:0.14
  });

  revealItems.forEach((item) => {
    revealObserver.observe(item);
  });
}
