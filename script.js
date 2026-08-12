const officialHost = "sgfibra.com.br";

if (window.location.hostname === "gustavoomeloo011-prog.github.io" && window.location.pathname.startsWith("/sgfibra-site")) {
  const cleanPath = window.location.pathname.replace(/^\/sgfibra-site\/?/, "/");
  window.location.replace(`https://${officialHost}${cleanPath}${window.location.search}${window.location.hash}`);
}

const cookieConsentKey = "sgfibra_cookie_consent";

if (!localStorage.getItem(cookieConsentKey)) {
  const cookieBanner = document.createElement("section");
  cookieBanner.className = "cookie-consent";
  cookieBanner.setAttribute("aria-label", "Aviso de cookies");
  cookieBanner.innerHTML = `
    <div>
      <strong>Usamos cookies</strong>
      <span>Utilizamos cookies essenciais para melhorar sua navegação e manter o site funcionando corretamente.</span>
    </div>
    <button type="button">Aceitar</button>
  `;

  cookieBanner.querySelector("button").addEventListener("click", () => {
    localStorage.setItem(cookieConsentKey, "accepted");
    cookieBanner.classList.add("is-hidden");
    window.setTimeout(() => cookieBanner.remove(), 220);
  });

  document.body.appendChild(cookieBanner);
}

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

const hero = document.querySelector(".hero");

if (hero && !prefersReducedMotion) {
  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    hero.style.setProperty("--hero-x", `${x.toFixed(1)}%`);
    hero.style.setProperty("--hero-y", `${y.toFixed(1)}%`);
  });
}

const tiltCards = document.querySelectorAll(".plan-card");

if (!prefersReducedMotion) {
  tiltCards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      card.classList.add("is-tilting");
      card.style.setProperty("--card-tilt-x", `${(x * 4).toFixed(2)}deg`);
      card.style.setProperty("--card-tilt-y", `${(-y * 3).toFixed(2)}deg`);
    });

    card.addEventListener("pointerleave", () => {
      card.classList.remove("is-tilting");
      card.style.removeProperty("--card-tilt-x");
      card.style.removeProperty("--card-tilt-y");
    });
  });
}

const showcasePlans = document.querySelectorAll(".showcase-plan");
const showcaseCaption = document.querySelector("#showcase-caption");

if (showcasePlans.length && showcaseCaption) {
  const activateShowcasePlan = (plan) => {
    showcasePlans.forEach((item) => item.classList.toggle("is-active", item === plan));
    const title = plan.dataset.title || plan.textContent.trim();
    const caption = plan.dataset.caption || "";
    showcaseCaption.textContent = `${title}: ${caption}`;
  };

  showcasePlans.forEach((plan) => {
    plan.addEventListener("pointerenter", () => activateShowcasePlan(plan));
    plan.addEventListener("click", () => activateShowcasePlan(plan));
    plan.addEventListener("focus", () => activateShowcasePlan(plan));
  });
}

const emailSpotlightButton = document.querySelector(".email-spotlight button");

if (emailSpotlightButton) {
  const originalHint = emailSpotlightButton.querySelector("small")?.textContent || "Clique para copiar";

  emailSpotlightButton.addEventListener("click", async () => {
    const email = emailSpotlightButton.dataset.email || "sgfibra.contato@gmail.com";
    const hint = emailSpotlightButton.querySelector("small");

    try {
      await navigator.clipboard.writeText(email);
      emailSpotlightButton.classList.add("is-copied");
      if (hint) hint.textContent = "E-mail copiado";
    } catch {
      window.location.href = `mailto:${email}`;
    }

    window.setTimeout(() => {
      emailSpotlightButton.classList.remove("is-copied");
      if (hint) hint.textContent = originalHint;
    }, 1800);
  });
}

document.querySelectorAll(".compact-plan-card").forEach((card) => {
  card.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      return;
    }

    card.classList.toggle("is-expanded");
  });
});

const carouselTracks = document.querySelectorAll(".combo-grid");

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
      if (index !== currentIndex) {
        card.classList.remove("is-expanded");
      }
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
  ".brand, .hero-content > *, .hero-card img, .trust-strip div, .section-heading, .plan-hover-showcase, .coverage-content > *, .location-photo-card, .plans-page-hero > div > *, .plans-page-hero img, .no-ads-highlight, .tv-programming, .email-spotlight, .addons-grid .addon-card, .app-hero-content > *, .app-phone-card img, .app-feature-grid article, .faq-link-grid a, .faq-question-grid details, .install-copy, .install-steps li, .download-panel, .legal-hero > *, .legal-card"
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
