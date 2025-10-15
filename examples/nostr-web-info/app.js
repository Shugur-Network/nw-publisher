/**
 * Nostr Web Info Site - Interactive Features
 * Inspired by capsules.shugur.com design patterns
 */

// ===== Mobile Navigation Toggle =====
document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navLinks.classList.toggle("active");

      // Animate hamburger icon
      const spans = navToggle.querySelectorAll("span");
      spans[0].style.transform = navLinks.classList.contains("active")
        ? "rotate(45deg) translateY(6px)"
        : "none";
      spans[1].style.opacity = navLinks.classList.contains("active")
        ? "0"
        : "1";
      spans[2].style.transform = navLinks.classList.contains("active")
        ? "rotate(-45deg) translateY(-6px)"
        : "none";
    });

    // Close menu when clicking a link
    const navLinkItems = navLinks.querySelectorAll(".nav-link");
    navLinkItems.forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        const spans = navToggle.querySelectorAll("span");
        spans[0].style.transform = "none";
        spans[1].style.opacity = "1";
        spans[2].style.transform = "none";
      });
    });
  }
});

// ===== Smooth Scrolling for Anchor Links =====
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    const href = this.getAttribute("href");
    if (href === "#") return;

    e.preventDefault();
    const target = document.querySelector(href);

    if (target) {
      const headerOffset = 80;
      const elementPosition = target.getBoundingClientRect().top;
      const offsetPosition =
        elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
  });
});

// ===== Intersection Observer for Fade-in Animations =====
const observerOptions = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px",
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = "1";
      entry.target.style.transform = "translateY(0)";
    }
  });
}, observerOptions);

// Observe all fade-in elements
document.querySelectorAll(".fade-in-up").forEach((el) => {
  // Set initial state
  el.style.opacity = "0";
  el.style.transform = "translateY(30px)";
  el.style.transition = "opacity 0.8s ease, transform 0.8s ease";
  observer.observe(el);
});

// ===== Active Navigation Highlight on Scroll =====
const sections = document.querySelectorAll("section[id]");
const navLinkItems = document.querySelectorAll(".nav-link");

function highlightNav() {
  const scrollY = window.pageYOffset;

  sections.forEach((section) => {
    const sectionHeight = section.offsetHeight;
    const sectionTop = section.offsetTop - 100;
    const sectionId = section.getAttribute("id");

    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
      navLinkItems.forEach((link) => {
        link.classList.remove("active");
        if (link.getAttribute("href") === `#${sectionId}`) {
          link.classList.add("active");
        }
      });
    }
  });
}

if (sections.length > 0) {
  window.addEventListener("scroll", highlightNav);
}

// ===== Code Block Copy Functionality =====
document.querySelectorAll(".code-block").forEach((codeBlock) => {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  codeBlock.parentNode.insertBefore(wrapper, codeBlock);
  wrapper.appendChild(codeBlock);

  const copyButton = document.createElement("button");
  copyButton.textContent = "Copy";
  copyButton.style.cssText = `
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms ease;
    color: #0a0a0a;
  `;

  copyButton.addEventListener("mouseenter", () => {
    copyButton.style.background = "#ffffff";
    copyButton.style.borderColor = "#0a0a0a";
  });

  copyButton.addEventListener("mouseleave", () => {
    copyButton.style.background = "rgba(255, 255, 255, 0.9)";
    copyButton.style.borderColor = "#e0e0e0";
  });

  copyButton.addEventListener("click", async () => {
    const code =
      codeBlock.querySelector("code")?.textContent || codeBlock.textContent;

    try {
      await navigator.clipboard.writeText(code.trim());
      copyButton.textContent = "✓ Copied!";
      copyButton.style.background = "#0a0a0a";
      copyButton.style.color = "#ffffff";

      setTimeout(() => {
        copyButton.textContent = "Copy";
        copyButton.style.background = "rgba(255, 255, 255, 0.9)";
        copyButton.style.color = "#0a0a0a";
        copyButton.style.borderColor = "#e0e0e0";
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      copyButton.textContent = "Failed";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 2000);
    }
  });

  wrapper.appendChild(copyButton);
});

// ===== Stat Counter Animation =====
const statNumbers = document.querySelectorAll(".stat-number");

function animateValue(element, start, end, duration, suffix = "") {
  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if (
      (increment > 0 && current >= end) ||
      (increment < 0 && current <= end)
    ) {
      current = end;
      clearInterval(timer);
    }

    if (suffix === "%") {
      element.textContent = Math.floor(current) + suffix;
    } else if (suffix === "∞") {
      element.textContent = suffix;
    } else {
      element.textContent = Math.floor(current) + suffix;
    }
  }, 16);
}

const statObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (
        entry.isIntersecting &&
        !entry.target.classList.contains("animated")
      ) {
        entry.target.classList.add("animated");
        const text = entry.target.textContent;

        if (text.includes("%")) {
          const value = parseInt(text);
          animateValue(entry.target, 0, value, 1500, "%");
        } else if (text === "∞") {
          // Keep infinity symbol
          entry.target.textContent = "∞";
        } else {
          const value = parseInt(text) || 0;
          animateValue(entry.target, 0, value, 1500);
        }
      }
    });
  },
  { threshold: 0.5 }
);

statNumbers.forEach((stat) => statObserver.observe(stat));

// ===== External Link Icons =====
document.querySelectorAll('a[target="_blank"]').forEach((link) => {
  if (!link.querySelector("svg")) {
    const icon = document.createElement("span");
    icon.innerHTML = " ↗";
    icon.style.cssText = "font-size: 0.875em; opacity: 0.6;";
    link.appendChild(icon);
  }
});

// ===== Keyboard Navigation Enhancement =====
document.addEventListener("keydown", (e) => {
  // Navigate with arrow keys when focus is on nav links
  if (e.target.classList.contains("nav-link")) {
    const links = Array.from(document.querySelectorAll(".nav-link"));
    const currentIndex = links.indexOf(e.target);

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % links.length;
      links[nextIndex].focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + links.length) % links.length;
      links[prevIndex].focus();
    }
  }
});

// ===== Scroll Progress Indicator (Optional) =====
const createScrollProgress = () => {
  const progressBar = document.createElement("div");
  progressBar.style.cssText = `
    position: fixed;
    top: 64px;
    left: 0;
    width: 0%;
    height: 2px;
    background: #0a0a0a;
    z-index: 9999;
    transition: width 100ms ease;
  `;
  document.body.appendChild(progressBar);

  window.addEventListener("scroll", () => {
    const scrollTop = window.pageYOffset;
    const docHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const progress = (scrollTop / docHeight) * 100;
    progressBar.style.width = progress + "%";
  });
};

// Uncomment to enable scroll progress indicator
// createScrollProgress();

// ===== Performance: Lazy Load Images =====
if ("loading" in HTMLImageElement.prototype) {
  // Browser supports native lazy loading
  document.querySelectorAll("img").forEach((img) => {
    img.loading = "lazy";
  });
} else {
  // Fallback for older browsers
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          imageObserver.unobserve(img);
        }
      }
    });
  });

  document.querySelectorAll("img[data-src]").forEach((img) => {
    imageObserver.observe(img);
  });
}
