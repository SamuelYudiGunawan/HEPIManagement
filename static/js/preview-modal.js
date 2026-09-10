// Shared preview modal used by formlisting.html, formlistingreview.html,
// revisilisting.html and revisireview.html — each page keeps its own
// #previewModal/#previewBody/#previewToolbar markup, this file just drives
// it. Centralized here (instead of duplicated per page, as it used to be)
// so a fix like image zoom or PDF download only has to happen once.
(function () {
  function $(id) { return document.getElementById(id); }

  var zoomState = null;
  var galleryItems = null;
  var galleryIndex = 0;
  var preservingGalleryState = false;

  function escAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function resetGalleryState() {
    if (preservingGalleryState) return;
    galleryItems = null;
    galleryIndex = 0;
  }

  function teardownZoom() {
    if (zoomState && zoomState.cleanup) zoomState.cleanup();
    zoomState = null;
  }

  function setZoomPct(pct) {
    var el = $("previewZoomPct");
    if (el) el.textContent = Math.round(pct) + "%";
  }

  // Zoom works by growing the <img> beyond the modal's fitted size instead
  // of a CSS transform, so the container's native `overflow: auto` handles
  // panning for free — no custom drag/pan logic needed.
  function initImageZoom(img, container, body) {
    var scale = 1;
    var baseWidth = 0;
    var MIN = 1, MAX = 4;

    function captureBase() {
      img.style.width = "";
      baseWidth = img.getBoundingClientRect().width;
    }
    if (img.complete) captureBase();
    else img.addEventListener("load", captureBase, { once: true });

    function applyScale() {
      if (scale <= 1.01) {
        img.style.width = "";
        img.style.maxWidth = "";
        img.style.maxHeight = "";
        if (body) body.classList.remove("zoomed");
      } else {
        if (!baseWidth) captureBase();
        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.width = Math.round(baseWidth * scale) + "px";
        if (body) body.classList.add("zoomed");
      }
      setZoomPct(scale * 100);
    }

    function setScale(next) {
      scale = Math.min(MAX, Math.max(MIN, next));
      applyScale();
    }

    function onWheel(e) {
      // Only zoom on ctrl/cmd+wheel (also how Chrome/Firefox report a
      // trackpad pinch gesture) — a plain wheel/two-finger scroll is left
      // alone so it pans the zoomed image via the container's native
      // overflow:auto scroll instead of being swallowed for zoom.
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale(scale + (e.deltaY < 0 ? 0.25 : -0.25));
    }
    function onDblClick() {
      setScale(scale > 1 ? 1 : 2.5);
    }
    var pinchStartDist = 0, pinchStartScale = 1;
    function onTouchStart(e) {
      if (e.touches.length === 2) {
        pinchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStartScale = scale;
      }
    }
    function onTouchMove(e) {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        var dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        setScale(pinchStartScale * (dist / pinchStartDist));
      }
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    img.addEventListener("dblclick", onDblClick);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });

    setZoomPct(100);

    return {
      zoomIn: function () { setScale(scale + 0.5); },
      zoomOut: function () { setScale(scale - 0.5); },
      reset: function () { setScale(1); },
      cleanup: function () {
        container.removeEventListener("wheel", onWheel);
        img.removeEventListener("dblclick", onDblClick);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
      }
    };
  }

  // Low-level entry point: opts = { kind: 'image'|'pdf', src, downloadHref?, downloadName? }
  window.previewShowMedia = function (opts) {
    resetGalleryState();
    teardownZoom();
    var body = $("previewBody");
    var toolbar = $("previewToolbar");
    if (!body) return;

    if (opts.kind === "pdf") {
      if (toolbar) toolbar.style.display = "none";
      var dl = "";
      if (opts.downloadHref) {
        var attrs = opts.downloadName
          ? ' download="' + opts.downloadName + '"'
          : ' target="_blank" rel="noopener"';
        dl = '<a class="previewDownloadBtn" href="' + opts.downloadHref + '"' + attrs + '">⬇️ Download PDF</a>';
      }
      body.innerHTML = '<div class="previewPdfWrap">' + dl + '<iframe src="' + opts.src + '"></iframe></div>';
      body.classList.remove("zoomed");
      // The PDF wrap (button + tall iframe) can be taller than previewBody's
      // own height — with the default centered flex layout that clips the
      // top of the content instead of scrolling to it, so top-align instead.
      body.classList.add("pdfMode");
    } else {
      if (toolbar) toolbar.style.display = "flex";
      body.classList.remove("pdfMode");
      var container = document.createElement("div");
      container.className = "previewImgWrap";
      var img = document.createElement("img");
      img.src = opts.src;
      img.alt = "preview";
      container.appendChild(img);
      body.innerHTML = "";
      body.appendChild(container);
      zoomState = initImageZoom(img, container, body);
    }
    $("previewModal").style.display = "block";
  };

  // Non-media preview (e.g. plain narasi text) — resets zoom/toolbar state
  // the same way so leftover zoom controls never linger from a prior image.
  window.previewShowHtml = function (html) {
    resetGalleryState();
    teardownZoom();
    var toolbar = $("previewToolbar");
    if (toolbar) toolbar.style.display = "none";
    var body = $("previewBody");
    if (body) {
      body.classList.remove("zoomed", "pdfMode");
      body.innerHTML = html;
    }
    $("previewModal").style.display = "block";
  };

  window.openPreview = function (fileId, kind) {
    if (kind === "pdf") {
      previewShowMedia({
        kind: "pdf",
        src: "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/preview",
        downloadHref: "/api/file-download/" + encodeURIComponent(fileId)
      });
    } else {
      previewShowMedia({
        kind: "image",
        src: "https://lh3.googleusercontent.com/d/" + encodeURIComponent(fileId) + "=w1600"
      });
    }
  };

  window.closePreview = function () {
    teardownZoom();
    galleryItems = null;
    galleryIndex = 0;
    var modal = $("previewModal");
    var body = $("previewBody");
    var toolbar = $("previewToolbar");
    if (modal) modal.style.display = "none";
    if (body) { body.innerHTML = ""; body.classList.remove("zoomed", "pdfMode"); }
    if (toolbar) toolbar.style.display = "none";
  };

  window.previewZoomIn = function () { if (zoomState) zoomState.zoomIn(); };
  window.previewZoomOut = function () { if (zoomState) zoomState.zoomOut(); };
  window.previewZoomReset = function () { if (zoomState) zoomState.reset(); };

  // Gallery: an array of { fileId } (Drive image) or { src } (e.g. a local
  // blob: URL for a not-yet-submitted photo) — a single item renders with no
  // nav arrows, more than one gets the left/right nav + counter overlay.
  function galleryItemSrc(item) {
    return item.src || ("https://lh3.googleusercontent.com/d/" + encodeURIComponent(item.fileId) + "=w1600");
  }

  function renderGalleryFrame() {
    if (!galleryItems || !galleryItems.length) return;
    preservingGalleryState = true;
    previewShowMedia({ kind: "image", src: galleryItemSrc(galleryItems[galleryIndex]) });
    preservingGalleryState = false;

    if (galleryItems.length > 1) {
      var body = $("previewBody");
      if (body) {
        var nav = document.createElement("div");
        nav.className = "previewGalleryNav";
        nav.innerHTML =
          '<button type="button" class="previewNavBtn previewNavLeft" onclick="previewGalleryPrev()">‹</button>'
          + '<button type="button" class="previewNavBtn previewNavRight" onclick="previewGalleryNext()">›</button>'
          + '<span class="previewGalleryCounter">' + (galleryIndex + 1) + ' / ' + galleryItems.length + '</span>';
        body.appendChild(nav);
      }
    }
  }

  window.previewShowGallery = function (items) {
    galleryItems = Array.isArray(items) ? items.slice() : [];
    galleryIndex = 0;
    if (!galleryItems.length) {
      previewShowHtml('<div class="narasiPreviewText">Tidak ada foto.</div>');
      return;
    }
    renderGalleryFrame();
  };

  window.previewGalleryPrev = function () {
    if (!galleryItems || galleryItems.length < 2) return;
    galleryIndex = (galleryIndex - 1 + galleryItems.length) % galleryItems.length;
    renderGalleryFrame();
  };

  window.previewGalleryNext = function () {
    if (!galleryItems || galleryItems.length < 2) return;
    galleryIndex = (galleryIndex + 1) % galleryItems.length;
    renderGalleryFrame();
  };

  // Fetches the actual photo list for a Form Listing property_file_id (which
  // may be a single legacy file or a folder of up to 5 photos — the server
  // resolves either shape into the same array) and opens it as a gallery.
  window.previewOpenPropertyGallery = function (propertyFileId) {
    previewShowHtml('<div class="narasiPreviewText">Memuat...</div>');
    hepiApi("/api/form-listing/property-photos/" + encodeURIComponent(propertyFileId))
      .then(function (res) {
        previewShowGallery((res && res.photos) || []);
      })
      .catch(function (err) {
        previewShowHtml('<div class="narasiPreviewText">Gagal memuat foto: ' + escAttr(err && err.message ? err.message : String(err)) + '</div>');
      });
  };
})();
