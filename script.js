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
  let dragStartX = 0;
  let dragDeltaX = 0;
  let isDragging = false;

  track.classList.add("is-carousel");

  const normalizeIndex = (index) => (index + cards.length) % cards.length;

  const updateCarouselHeight = () => {
    const maxHeight = Math.max(...cards.map((card) => card.offsetHeight));
    track.style.setProperty("--carousel-height", `${maxHeight + 72}px`);
  };

  const setActiveCard = (nextIndex) => {
    currentIndex = (nextIndex + cards.length) % cards.length;
    const previousIndex = normalizeIndex(currentIndex - 1);
    const nextCardIndex = normalizeIndex(currentIndex + 1);

    cards.forEach((card, index) => {
      card.classList.remove("is-active", "is-prev", "is-next", "is-hidden");
      card.classList.toggle("is-active", index === currentIndex);

      if (index === previousIndex) {
        card.classList.add("is-prev");
      } else if (index === nextCardIndex) {
        card.classList.add("is-next");
      } else if (index !== currentIndex) {
        card.classList.add("is-hidden");
      }
    });

    updateCarouselHeight();
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

  const handleDragEnd = () => {
    if (!isDragging) {
      return;
    }

    track.classList.remove("is-dragging");
    isDragging = false;

    if (Math.abs(dragDeltaX) > 48) {
      setActiveCard(currentIndex + (dragDeltaX < 0 ? 1 : -1));
    }

    dragDeltaX = 0;
    startCarousel();
  };

  setActiveCard(0);
  startCarousel();

  track.addEventListener("mouseenter", stopCarousel);
  track.addEventListener("mouseleave", startCarousel);
  track.addEventListener("focusin", stopCarousel);
  track.addEventListener("focusout", startCarousel);

  track.addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      return;
    }

    stopCarousel();
    isDragging = true;
    dragStartX = event.clientX;
    dragDeltaX = 0;
    track.classList.add("is-dragging");
    track.setPointerCapture(event.pointerId);
  });

  track.addEventListener("pointermove", (event) => {
    if (!isDragging) {
      return;
    }

    dragDeltaX = event.clientX - dragStartX;
  });

  track.addEventListener("pointerup", handleDragEnd);
  track.addEventListener("pointercancel", handleDragEnd);

  window.addEventListener("resize", () => {
    updateCarouselHeight();
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
