/* Number-key link navigation + Emacs-style document scrolling.
   - Every [data-nav] link gets a visible [n] badge.
   - Press a digit to follow link n. Multi-digit links are supported.
   - Esc clears. Enter follows an armed link.
   - C-p/C-n scroll one terminal line up/down.
   - [/] page up/down. </> top/bottom.
   - Native arrows, Home/End, PageUp/PageDown still work normally.
   - Custom keys are ignored in form fields. */
(function () {
  "use strict";

  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-nav]"));
  if (!links.length) return;

  links.forEach(function (a, i) {
    var n = i + 1;
    a.dataset.navnum = String(n);
    var badge = document.createElement("span");
    badge.className = "lnk__num";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "[" + n + "]";
    a.insertBefore(badge, a.firstChild);
  });

  var max = links.length;
  var buffer = "";
  var armed = null;
  var timer = null;
  var COMMIT_MS = 600;
  var LINE = 32;

  function clearArmed() {
    if (armed) armed.classList.remove("is-armed");
    armed = null;
    buffer = "";
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function sameDocument(url) {
    return url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search;
  }

  function follow(a) {
    clearArmed();

    var url = new URL(a.href, window.location.href);
    if (sameDocument(url)) {
      if (url.hash) {
        var el = document.querySelector(url.hash);
        if (el) el.scrollIntoView({ block: "start" });
        history.replaceState(null, "", url.hash);
      } else {
        window.scrollTo({ top: 0 });
        history.replaceState(null, "", url.pathname + url.search);
      }
      return;
    }

    window.location.href = a.href;
  }

  function arm(n) {
    var a = links[n - 1];
    if (!a) return;
    if (armed && armed !== a) armed.classList.remove("is-armed");
    armed = a;
    a.classList.add("is-armed");
    a.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function onDigit(d) {
    buffer += d;
    var n = parseInt(buffer, 10);
    if (timer) { clearTimeout(timer); timer = null; }

    if (n < 1 || n > max) { clearArmed(); return; }
    arm(n);

    if (n * 10 > max) {
      follow(links[n - 1]);
      return;
    }

    timer = setTimeout(function () {
      if (armed) follow(armed);
    }, COMMIT_MS);
  }

  function typingTarget(t) {
    return t && (
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable
    );
  }

  function scrollByAmount(amount) {
    window.scrollBy({ top: amount });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0 });
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }

  document.addEventListener("keydown", function (e) {
    if (e.metaKey) return;
    if (typingTarget(e.target)) return;

    if (!e.ctrlKey && !e.altKey && e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      onDigit(e.key);
      return;
    }

    if (!e.ctrlKey && !e.altKey && e.key === "Enter" && armed) {
      e.preventDefault();
      follow(armed);
      return;
    }

    if (!e.ctrlKey && !e.altKey && e.key === "Escape") {
      clearArmed();
      return;
    }

    if (!e.ctrlKey && !e.altKey) {
      if (e.key === "PageUp") { e.preventDefault(); scrollByAmount(-window.innerHeight * 0.88); return; }
      if (e.key === "PageDown") { e.preventDefault(); scrollByAmount(window.innerHeight * 0.88); return; }
      if (e.key === "Home") { e.preventDefault(); scrollToTop(); return; }
      if (e.key === "End") { e.preventDefault(); scrollToBottom(); return; }
    }

    if (e.ctrlKey && !e.altKey) {
      var ctrlKey = e.key.toLowerCase();
      if (ctrlKey === "p") { e.preventDefault(); scrollByAmount(-LINE); return; }
      if (ctrlKey === "n") { e.preventDefault(); scrollByAmount(LINE); return; }
      if (ctrlKey === "v") { e.preventDefault(); scrollByAmount(window.innerHeight * 0.88); return; }
    }

    if (!e.ctrlKey && !e.altKey) {
      if (e.key === "[") { e.preventDefault(); scrollByAmount(-window.innerHeight * 0.88); return; }
      if (e.key === "]") { e.preventDefault(); scrollByAmount(window.innerHeight * 0.88); return; }
      if (e.key === "<") { e.preventDefault(); scrollToTop(); return; }
      if (e.key === ">") { e.preventDefault(); scrollToBottom(); return; }
    }
  });
})();
