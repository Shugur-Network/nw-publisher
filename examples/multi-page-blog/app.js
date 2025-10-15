// Navigation highlighting
function highlightCurrentNav() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll(".nav-link");

  navLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (href === currentPath || (href === "/" && currentPath === "/")) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

// Smooth scroll for anchor links
function setupSmoothScroll() {
  const anchorLinks = document.querySelectorAll('a[href^="#"]');

  anchorLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.getAttribute("href").slice(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

        // Update URL without scrolling
        if (targetId) {
          window.history.pushState(null, "", `#${targetId}`);
        }
      }
    });
  });
}

// Mark external links
function markExternalLinks() {
  const links = document.querySelectorAll("a[href]");

  links.forEach((link) => {
    const href = link.getAttribute("href");

    // Check if link is external (http/https but not same origin)
    if (href.startsWith("http://") || href.startsWith("https://")) {
      const linkHost = new URL(href).host;
      const currentHost = window.location.host;

      if (linkHost !== currentHost) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");

        // Add visual indicator for external links
        if (!link.querySelector(".external-icon")) {
          const icon = document.createElement("span");
          icon.className = "external-icon";
          icon.style.marginLeft = "0.25rem";
          icon.style.fontSize = "0.875em";
          icon.textContent = "↗";
          link.appendChild(icon);
        }
      }
    }
  });
}

// Copy code blocks
function setupCodeCopyButtons() {
  const copyButtons = document.querySelectorAll(".copy-button");
  console.log("Found copy buttons:", copyButtons.length);

  copyButtons.forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.preventDefault();
      console.log("Copy button clicked");

      const codeBlock = button.closest(".code-block");
      const code = codeBlock?.querySelector("code");

      console.log("Code block found:", !!codeBlock);
      console.log("Code element found:", !!code);

      if (code) {
        try {
          const textToCopy = code.textContent;
          console.log("Attempting to copy:", textToCopy.substring(0, 50));

          await navigator.clipboard.writeText(textToCopy);
          console.log("Copy successful!");

          // Visual feedback - change to checkmark
          const originalHTML = button.innerHTML;
          button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          button.style.backgroundColor = "rgba(76, 175, 80, 0.3)";
          button.style.borderColor = "rgba(76, 175, 80, 0.4)";

          setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
            button.style.borderColor = "rgba(255, 255, 255, 0.2)";
          }, 2000);
        } catch (err) {
          console.error("Failed to copy code:", err);

          // Fallback: try using execCommand
          try {
            const textArea = document.createElement("textarea");
            textArea.value = code.textContent;
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            console.log("Copy successful using fallback method");

            // Visual feedback
            const originalHTML = button.innerHTML;
            button.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
            button.style.backgroundColor = "rgba(76, 175, 80, 0.3)";

            setTimeout(() => {
              button.innerHTML = originalHTML;
              button.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
            }, 2000);
          } catch (fallbackErr) {
            console.error("Fallback copy also failed:", fallbackErr);
          }
        }
      } else {
        console.error("No code element found in code block");
      }
    });
  });
}

// Fade-in animation on scroll
function setupScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("fade-in");
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe cards and content sections
  const animatedElements = document.querySelectorAll(
    ".post-card, .contact-card, .content-section, .info-card"
  );
  animatedElements.forEach((el) => observer.observe(el));
}

// Log navigation for debugging (optional)
function logNavigation() {
  console.log("Current path:", window.location.pathname);
  console.log("Page loaded:", document.title);
}

// Initialize all functionality
function init() {
  highlightCurrentNav();
  setupSmoothScroll();
  markExternalLinks();
  setupCodeCopyButtons();
  setupScrollAnimations();
  logNavigation();
}

// Run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Re-run on navigation (for SPA-like behavior if needed)
window.addEventListener("popstate", () => {
  highlightCurrentNav();
  logNavigation();
});
