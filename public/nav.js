/* Number-key link navigation, text-browser style (w3m / Lynx).
   - Every [data-nav] link gets a visible [n] badge.
   - Press a digit to "arm" link n; it follows immediately when the number
     is unambiguous, or after a short pause if more digits could follow
     (e.g. you have 12 links and press "1", it waits to see if "2" comes).
   - Esc clears. g = top, G = bottom. Typing is ignored in form fields. */
(function () {
  "use strict";

  var links = Array.prototype.slice.call(document.querySelectorAll("a[data-nav]"));
  if (!links.length) return;

  // assign 1-based numbers + inject the [n] badge
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

  function clearArmed() {
    if (armed) armed.classList.remove("is-armed");
    armed = null;
    buffer = "";
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function follow(a) {
    clearArmed();
    // same behavior as a click: respect target, in-page anchors, mailto, etc.
    if (a.getAttribute("href").charAt(0) === "#") {
      var el = document.querySelector(a.getAttribute("href"));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
      history.replaceState(null, "", a.getAttribute("href"));
    } else {
      window.location.href = a.href;
    }
  }

  function arm(n) {
    var a = links[n - 1];
    if (!a) return;
    if (armed && armed !== a) armed.classList.remove("is-armed");
    armed = a;
    a.classList.add("is-armed");
    a.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function onDigit(d) {
    buffer += d;
    var n = parseInt(buffer, 10);
    if (timer) { clearTimeout(timer); timer = null; }

    if (n < 1 || n > max) { clearArmed(); return; }
    arm(n);

    // If no longer number could be valid (n*10 > max), commit now.
    if (n * 10 > max) {
      follow(links[n - 1]);
      return;
    }
    // otherwise wait briefly for another digit, then commit
    timer = setTimeout(function () {
      if (armed) follow(armed);
    }, COMMIT_MS);
  }

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    if (e.key >= "0" && e.key <= "9") { e.preventDefault(); onDigit(e.key); return; }
    if (e.key === "Enter" && armed) { e.preventDefault(); follow(armed); return; }
    if (e.key === "Escape") { clearArmed(); return; }
    if (e.key === "g") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (e.key === "G") { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); return; }
  });
})();
