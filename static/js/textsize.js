(function() {
  var KEY = "hepi_textSize";
  var allowed = { normal: 1, large: 1, xlarge: 1 };

  function currentSize() {
    var s = "";
    try { s = localStorage.getItem(KEY) || "normal"; } catch (e) { s = "normal"; }
    if (!allowed[s]) s = "normal";
    return s;
  }

  function apply(size) {
    if (!allowed[size]) size = "normal";
    if (size === "normal") document.documentElement.removeAttribute("data-text-size");
    else document.documentElement.setAttribute("data-text-size", size);
    try { localStorage.setItem(KEY, size); } catch (e) {}
    var btns = document.querySelectorAll("[data-text-size-btn]");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute("data-text-size-btn") === size) btns[i].classList.add("isActive");
      else btns[i].classList.remove("isActive");
    }
  }

  function init() {
    apply(currentSize());
    var bar = document.querySelector(".textSizeBar");
    if (!bar) return;
    bar.addEventListener("click", function(e) {
      var btn = e.target.closest ? e.target.closest("[data-text-size-btn]") : null;
      if (!btn) return;
      apply(btn.getAttribute("data-text-size-btn"));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
