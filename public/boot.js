// Prerendered pages with a hero image: the page is already complete HTML, so the app's code waits
// until that image has arrived (it's what the visitor is looking at) and then takes over.
(function () {
  var me = document.currentScript;
  var entry = me && me.getAttribute("data-entry");
  if (!entry) return;
  var started = false;
  function load() {
    var s = document.createElement("script");
    s.type = "module";
    s.crossOrigin = "";
    s.src = entry;
    document.head.appendChild(s);
  }
  // After the next frame is on screen, so running the app's code never delays that first picture.
  function start() {
    if (started) return;
    started = true;
    var raf = window.requestAnimationFrame;
    if (!raf || document.hidden) return load();
    raf(function () {
      setTimeout(load, 0);
    });
  }
  var hero = document.querySelector('img[fetchpriority="high"]');
  if (!hero || hero.complete) return start();
  hero.addEventListener("load", start, { once: true });
  hero.addEventListener("error", start, { once: true });
  // Never wait long: a slow image must not hold the page's buttons back.
  setTimeout(start, 2500);
})();
