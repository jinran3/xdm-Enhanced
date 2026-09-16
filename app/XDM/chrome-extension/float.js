"use strict";
(() => {
  if (window.__xdmYtFloat) return;
  window.__xdmYtFloat = true;
  if (!/^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(location.href)) return;

  var LEVELS = { hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720, large: 480, medium: 360, small: 240, tiny: 144 };
  var CODEC_LABEL = { av01: "AV1", vp9: "VP9", avc1: "H.264", hevc: "H.265", vp8: "VP8" };
  var CODEC_ORDER = ["avc1", "vp9", "av01", "hevc", "vp8"];
  var POS_KEY = "xdm.panel.pos";
  var formats = null;
  var subtitles = null;
  var audioTracks = [];
  var panelUrl = null;
  var panelPlaylist = null;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function currentUrl() {
    var u = location.href;
    if (/\/watch\?/.test(u)) return u;
    var flexy = document.querySelector("ytd-watch-flexy");
    var id = flexy && flexy.getAttribute("video-id");
    if (id) return "https://www.youtube.com/watch?v=" + id;
    return u;
  }

  function getPlayerLevels() {
    var hs = [];
    try {
      var p = document.querySelector("#movie_player");
      if (p && p.getAvailableQualityLevels) hs = p.getAvailableQualityLevels().map(function (k) { return LEVELS[k]; }).filter(Boolean);
    } catch (e) {}
    if (!hs.length) hs = [2160, 1440, 1080, 720, 480, 360];
    return Array.from(new Set(hs)).sort(function (a, b) { return b - a; });
  }

  var css =
    ".xdm-float{position:fixed;top:100px;left:auto;right:auto;z-index:2147483000;font:13px/1 'Segoe UI',system-ui,sans-serif;--xdm-accent:#3d8bff;--xdm-accent-hover:#5b9bff}" +
    ".xdm-float .xf-btn{display:flex;align-items:center;gap:6px;padding:9px 14px;border-radius:999px;border:0;cursor:pointer;color:#fff;background:var(--xdm-accent);box-shadow:0 4px 14px rgba(0,0,0,.35);touch-action:none;user-select:none;-webkit-user-select:none}" +
    ".xdm-float .xf-btn:hover{background:var(--xdm-accent-hover)}" +
    ".xdm-float .xf-panel{position:absolute;left:0;top:calc(100% + 8px);min-width:172px;background:#0f1420;border:1px solid #2a3654;border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4)}" +
    ".xdm-float .xf-tip{padding:8px 12px;color:#8b96ad;font-size:11px;border-bottom:1px solid #202b44;display:flex;align-items:center}" +
    ".xdm-float .xf-tip-sub{padding:7px 12px;color:#5c6a86;font-size:11px;border-bottom:1px solid #202b44}" +
    ".xdm-float .xf-back{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;border:1px solid #2a3654;background:#19233c;color:#cfe0ff;font-size:11px;cursor:pointer}" +
    ".xdm-float .xf-back:hover{background:#2a3b5e}" +
    ".xdm-float .xf-item{display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 12px;border:0;background:none;color:#e8edf7;cursor:pointer;text-align:left}" +
    ".xdm-float .xf-item:hover{background:#1f2940}" +
    ".xdm-float .xf-badge{color:var(--xdm-accent);font-size:11px}" +
    ".xdm-float .xf-scroll{max-height:min(56vh,380px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}" +
    ".xdm-float .xf-err{padding:10px 12px;color:#f2604f;font-size:12px}" +
    ".xdm-float .xf-prog{padding:12px 14px;min-width:212px}" +
    ".xdm-float .xf-prog-name{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e8edf7;font-size:12px}" +
    ".xdm-float .xf-prog-sub{color:#8b96ad;font-size:11px;margin-top:6px}";

  var style = document.createElement("style");
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var hostRef = null;
  function applyTheme(mode) {
    if (!hostRef) return;
    var accent = mode === 1 ? "#E60000" : "#3d8bff" /* 0=Standard */;
    var hover  = mode === 1 ? "#CC0000" : "#5b9bff";
    hostRef.style.setProperty("--xdm-accent", accent);
    hostRef.style.setProperty("--xdm-accent-hover", hover);
  }

  hostRef = document.createElement("div");
  var host = hostRef;
  host.className = "xdm-float";
  var btn = document.createElement("button");
  btn.className = "xf-btn";
  btn.textContent = "下载视频";
  var panel = document.createElement("div");
  panel.className = "xf-panel";
  panel.style.display = "none";
  host.appendChild(btn);
  host.appendChild(panel);

  // ��ǿ��������ͻ��ˣ�0 = ��׼���� - YouTube�죩
  var THEME_COLORS = {
    0: { accent: "#3d8bff", hover: "#5b9bff" },
    1: { accent: "#FF0000", hover: "#E60000" }
  };
  function applyTheme(mode) {
    if (typeof mode !== "number" || !THEME_COLORS[mode]) return;
    var c = THEME_COLORS[mode];
    host.style.setProperty("--xdm-accent", c.accent);
    host.style.setProperty("--xdm-accent-hover", c.hover);
  }

  (document.body || document.documentElement).appendChild(host);

  var dragState = null;

  function placeFloat() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch (e) {}
    if (saved && !isNaN(saved.x) && !isNaN(saved.y)) {
      host.style.left = clamp(saved.x, 0, window.innerWidth - 60) + "px";
      host.style.top = clamp(saved.y, 0, window.innerHeight - 30) + "px";
      return;
    }
    var el = document.querySelector("#movie_player") || document.querySelector("#player-container") || document.querySelector("#player");
    if (el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        host.style.left = clamp(r.right - 56, 8, window.innerWidth - 60) + "px";
        host.style.top = clamp(r.top + 8, 8, window.innerHeight - 30) + "px";
        return;
      }
    }
    host.style.left = clamp(window.innerWidth - 180, 8, window.innerWidth - 60) + "px";
    host.style.top = "100px";
  }

  btn.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var rect = host.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top, started: false };
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  btn.addEventListener("pointermove", function (e) {
    if (!dragState) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    if (!dragState.started && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) dragState.started = true;
    if (dragState.started) {
      host.style.left = clamp(dragState.baseX + dx, 0, window.innerWidth - 60) + "px";
      host.style.top = clamp(dragState.baseY + dy, 0, window.innerHeight - 30) + "px";
    }
  });
  function endDrag(e) {
    if (!dragState) return;
    var wasDrag = dragState.started;
    var nx = parseInt(host.style.left, 10);
    var ny = parseInt(host.style.top, 10);
    dragState = null;
    if (!wasDrag) { togglePanel(); return; }
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: nx, y: ny })); } catch (err) {}
  }
  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("click", function (e) { e.stopPropagation(); });
  panel.addEventListener("wheel", function (e) {
    var t = e.target;
    var sc = t && t.closest ? t.closest(".xf-scroll") : null;
    if (sc && sc.scrollHeight > sc.clientHeight) {
      var cur = sc.scrollTop, cap = sc.scrollHeight - sc.clientHeight;
      if ((e.deltaY > 0 && cur >= cap - 1) || (e.deltaY < 0 && cur <= 1)) e.preventDefault();
    } else {
      e.preventDefault();
    }
  }, { passive: false });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }
  function statusHtml(success, text) {
    return '<div class="xf-prog"><div style="color:' + (success ? "#2ec58a" : "#f2604f") + ';font-size:12px">' + text + "</div></div>";
  }
  function showError(msg, title) {
    var m = String(msg || "");
    var nicer = m;
    if (/copyright|protected|private|member.?only|sign.?in/i.test(m)) {
      nicer = "视频受版权保护或不可下载（" + m + "）";
    } else if (/timed.?out|ETIMEDOUT|network|refused/i.test(m)) {
      nicer = "网络或后端解析错误：" + m;
    }
    panel.innerHTML = '<div class="xf-tip">' + escapeHtml(title || "下载失败") + "</div>" +
      '<div class="xf-err">' + escapeHtml(nicer) + "</div>";
  }

  function maxFormatText() {
    var maxH = 0;
    (formats || []).forEach(function (f) { if (f.h > maxH) maxH = f.h; });
    return "分辨率最高 <b style=\"color:#e8edf7\">" + (maxH || "?") + "p</b>，选择后交给 XDM";
  }

  function renderCodecs() {
    var map = {};
    (formats || []).forEach(function (f) { if (!f.video) return; (map[f.video] = map[f.video] || []).push(f); });
    var codes = Object.keys(map).sort(function (a, b) {
      var ia = CODEC_ORDER.indexOf(a), ib = CODEC_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var html = '<div class="xf-tip">' + maxFormatText() + "</div>" +
      '<div class="xf-tip-sub">选择编码格式</div>';
    html += '<div class="xf-scroll">';
    codes.forEach(function (c) {
      var items = map[c].slice().sort(function (a, b) { return b.h - a.h; });
      var maxH = items[0].h;
      var cname = CODEC_LABEL[c] || String(c).toUpperCase();
      html += '<button class="xf-item" data-v="' + escapeAttr(c) + '">' +
        "<span>" + escapeHtml(cname) + "</span><span class=\"xf-badge\">" + maxH + "p</span></button>";
    });
    html += '</div>';
    html += subsEntryHtml();
    panel.innerHTML = html;
    panel.querySelectorAll(".xf-item[data-v]").forEach(function (it) {
      it.addEventListener("click", function (e) { e.stopPropagation(); renderHeights(it.getAttribute("data-v")); });
    });
    bindSubsEntry();
    if (!codes.length) showError("该视频暂无可用编码格式", null);
  }

  function renderHeights(codec) {
    var items = (formats || []).filter(function (f) { return f.video === codec; }).sort(function (a, b) { return b.h - a.h; });
    var cname = CODEC_LABEL[codec] || String(codec).toUpperCase();
    var html = '<div class="xf-tip"><button class="xf-back" data-back>← 格式</button>' +
      '<span style="margin-left:6px">' + escapeHtml(cname) + "</span></div>" +
      '<div class="xf-tip-sub">选择清晰度</div>';
    html += '<div class="xf-scroll">';
    items.forEach(function (f) {
      var fcname = CODEC_LABEL[f.video] || String(f.video).toUpperCase();
      html += '<button class="xf-item" data-v="' + escapeAttr(f.video) + '" data-h="' + f.h + '">' +
        "<span>" + f.h + "p · " + escapeHtml(fcname) + "</span>" +
        '<span class="xf-badge">' + escapeHtml(f.ext || "mp4") + "</span></button>";
    });
    html += '</div>';
    panel.innerHTML = html;
    panel.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); renderCodecs(); }); });
    panel.querySelectorAll(".xf-item[data-h]").forEach(function (it) {
      it.addEventListener("click", function (e) {
        e.stopPropagation();
        var v = it.getAttribute("data-v");
        var h = parseInt(it.getAttribute("data-h"), 10);
        if (audioTracks && audioTracks.length > 1) {
          startAudioPick(v, h);
        } else {
          startDownload(v, h, "");
        }
      });
    });
  }

  function renderLegacy(levels) {
    var max = levels[0];
    var html = '<div class="xf-tip">当前视频最高支持 <b style="color:#e8edf7">' + (max || "?") + "p</b>，选择后交给 XDM 下载</div>";
    html += '<div class="xf-scroll">' + levels.map(function (h) {
      var badge = h === max ? '<span class="xf-badge">最高</span>' : "";
      return '<button class="xf-item" data-h="' + h + '"><span>' + h + "p</span>" + badge + "</button>";
    }).join("") + '</div>';
    html += subsEntryHtml();
    panel.innerHTML = html;
    panel.querySelectorAll(".xf-item[data-h]").forEach(function (it) {
      it.addEventListener("click", function (e) { e.stopPropagation(); startDownload(null, parseInt(it.getAttribute("data-h"), 10), ""); });
    });
    bindSubsEntry();
  }

  function startDownload(format, h, lang) {
    var url = currentUrl();
    panel.querySelectorAll(".xf-item").forEach(function (x) { x.disabled = true; x.style.opacity = ".6"; });
    panel.innerHTML = statusHtml(false, "正在唤起 XDM，开始 " + h + "p 下载…");
    chrome.runtime.sendMessage({ type: "youtube-grab-dl", url: url, res: h, format: format || "", lang: lang || "" }, function (r2) {
      if (!r2 || !r2.ok) {
        showError((r2 && r2.error) || (r2 && r2.msg) || "未知错误");
      } else {
        panel.innerHTML = statusHtml(true, "XDM 已开始下载：" + escapeHtml(r2.title || (h + "p")));
      }
      setTimeout(function () { panel.style.display = "none"; }, 3200);
    });
  }

  function startAudioPick(codec, h) {
    var tracks = audioTracks || [];
    var cname = (codec && CODEC_LABEL[codec]) || String(codec || "").toUpperCase() || "";
    var html = '<div class="xf-tip"><button class="xf-back" data-back="1">← 清晰度</button>' +
      '<span style="margin-left:6px">' + h + "p" + (cname ? " · " + cname : "") + "</span></div>" +
      '<div class="xf-tip-sub">选择音轨</div>';
    html += '<div class="xf-scroll">';
    tracks.forEach(function (t) {
      html += '<button class="xf-item" data-av="' + escapeAttr(codec || "") + '" data-ah="' + h + '" data-alang="' + escapeAttr(t.lang) + '">' +
        "🔊 " + escapeHtml(t.name || t.lang) + "</button>";
    });
    html += '</div>';
    panel.innerHTML = html;
    panel.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); renderHeights(codec); }); });
    panel.querySelectorAll(".xf-item[data-alang]").forEach(function (it) {
      it.addEventListener("click", function (e) {
        e.stopPropagation();
        startDownload(it.getAttribute("data-av"), parseInt(it.getAttribute("data-ah"), 10), it.getAttribute("data-alang"));
      });
    });
  }

  function togglePanel() {
    if (panel.style.display === "block") { panel.style.display = "none"; return; }
    openPanel();
  }

  function subsEntryHtml() {
    if (!subtitles || !subtitles.length) return "";
    return '<button class="xf-item xf-subs" data-sub="1"><span>下载字幕</span><span class="xf-badge">' + subtitles.length + '</span></button>';
  }
  function bindSubsEntry() {
    panel.querySelectorAll("[data-sub]").forEach(function (it) {
      it.addEventListener("click", function (e) { e.stopPropagation(); renderSubtitleLangs(); });
    });
  }
  function renderPlaylist(r) {
    var n = parseInt(r.count, 10) || 0;
    var html = '<div class="xf-tip">播放列表 · <b style="color:#e8edf7">' + n + '</b> 个视频</div>' +
      '<div class="xf-tip-sub">通过 XDM 逐一下载全部视频</div>' +
      subsEntryHtml();
    html += '<div class="xf-scroll">' +
      '<button class="xf-item xf-dlall" data-dlall="1"><span>下载全部 (' + n + ')</span><span class="xf-badge">XDM</span></button></div>';
    panel.innerHTML = html;
    bindSubsEntry();
    var dlall = panel.querySelector("[data-dlall]");
    if (dlall) dlall.addEventListener("click", function (e) { e.stopPropagation(); startListDownload(); });
  }
  function startListDownload() {
    var url = panelUrl || currentUrl();
    panel.innerHTML = statusHtml(false, "正在添加播放列表到 XDM…");
    chrome.runtime.sendMessage({ type: "youtube-download-list", url: url }, function (r2) {
      if (!r2 || !r2.ok) {
        showError((r2 && r2.error) || (r2 && r2.msg) || "下载列表失败");
      } else {
        panel.innerHTML = statusHtml(true, "XDM 已开始下载播放列表，共 " + ((r2 && r2.count) || "?") + " 个视频");
      }
      setTimeout(function () { panel.style.display = "none"; }, 3200);
    });
  }
  function backToMain() {
    if (formats && formats.length) { renderCodecs(); return; }
    if (panelPlaylist) { renderPlaylist(panelPlaylist); return; }
    var levels = getPlayerLevels();
    if (levels.length) { renderLegacy(levels); return; }
    showError("未获取到清晰度，请确认 XDM 已运行", null);
  }
  function renderSubtitleLangs() {
    var subs = subtitles || [];
    if (!subs.length) { showError("暂无可用字幕", null); return; }
    var html = '<div class="xf-tip"><button class="xf-back" data-back="1">← 返回</button>' +
      '<span style="margin-left:6px">下载字幕</span></div>' +
      '<div class="xf-tip-sub">选择字幕语言</div>';
    html += '<div class="xf-scroll">';
    subs.forEach(function (lg) {
      html += '<button class="xf-item" data-sublang="' + escapeAttr(lg) + '"><span>' + escapeHtml(lg) + '</span><span class="xf-badge">字幕</span></button>';
    });
    html += '</div>';
    panel.innerHTML = html;
    panel.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); backToMain(); }); });
    panel.querySelectorAll("[data-sublang]").forEach(function (it) {
      it.addEventListener("click", function (e) { e.stopPropagation(); renderSubtitleExts(it.getAttribute("data-sublang")); });
    });
  }
  function renderSubtitleExts(lang) {
    var html = '<div class="xf-tip"><button class="xf-back" data-back="1">← 返回</button>' +
      '<span style="margin-left:6px">' + escapeHtml(lang) + '</span></div>' +
      '<div class="xf-tip-sub">选择字幕格式</div>' +
      '<button class="xf-item" data-subsext="srt"><span>SRT</span><span class="xf-badge">.srt</span></button>' +
      '<button class="xf-item" data-subsext="vtt"><span>VTT</span><span class="xf-badge">.vtt</span></button>';
    panel.innerHTML = html;
    panel.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); renderSubtitleLangs(); }); });
    panel.querySelectorAll("[data-subsext]").forEach(function (it) {
      it.addEventListener("click", function (e) { e.stopPropagation(); startSubsDownload(lang, it.getAttribute("data-subsext")); });
    });
  }
  function startSubsDownload(lang, ext) {
    var url = panelUrl || currentUrl();
    panel.innerHTML = statusHtml(false, "正在下载字幕 " + escapeHtml(lang) + " ." + escapeHtml(ext) + "…");
    chrome.runtime.sendMessage({ type: "youtube-download-subs", url: url, lang: lang, ext: ext }, function (r2) {
      if (!r2 || !r2.ok) {
        showError((r2 && r2.error) || (r2 && r2.msg) || "下载字幕失败");
      } else {
        panel.innerHTML = statusHtml(true, "字幕已交给 XDM 下载");
      }
      setTimeout(function () { panel.style.display = "none"; }, 3200);
    });
  }

  function renderImmediate() {
    var levels = getPlayerLevels();
    if (levels && levels.length) { renderLegacy(levels); return true; }
    return false;
  }

  function openPanel() {
    var url = currentUrl();
    panelUrl = url;
    audioTracks = [];
    panel.style.display = "block";
    // Render player levels instantly so the button feels as responsive as IDM,
    // then swap in the authoritative codec/formats list when the backend replies.
    if (!renderImmediate()) panel.innerHTML = '<div class="xf-tip">正在获取视频信息…</div>';
    chrome.runtime.sendMessage({ type: "youtube-list", url: url }, function (r) {
      if (!r || r.ok === false) {
        if (!panel.querySelector(".xf-item[data-h]")) showError((r && r.error) || (r && r.msg) || "解析失败，请确认 XDM 已运行");
        return;
      }
      if (typeof r.theme_mode === "number") applyTheme(r.theme_mode);
      subtitles = (Array.isArray(r.subtitles) ? r.subtitles : []) || [];
      audioTracks = (Array.isArray(r.audio_tracks) ? r.audio_tracks : []) || [];
      if (typeof r.theme_mode === "number") applyTheme(r.theme_mode);
      if (r.is_playlist && parseInt(r.count, 10) > 1) {
        panelPlaylist = r;
        renderPlaylist(r);
        return;
      }
      if (Array.isArray(r.formats) && r.formats.length) {
        formats = r.formats;
        renderCodecs();
      } else if (Array.isArray(r.qualities) && r.qualities.length) {
        formats = null;
        renderLegacy(r.qualities.slice().sort(function (a, b) { return b - a; }));
      } else {
        formats = null;
      }
    });
  }

  function warmCache() {
    try { chrome.runtime.sendMessage({ type: "youtube-list", url: currentUrl() }, function () {}); } catch (e) {}
  }
  var warmTimer = null;
  function scheduleWarm() {
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = setTimeout(warmCache, 400);
  }

  document.addEventListener("click", function (e) { if (!host.contains(e.target)) panel.style.display = "none"; });
  window.addEventListener("scroll", function () { placeFloat(); }, { passive: true });
  window.addEventListener("resize", function () { placeFloat(); });

  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (/^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(lastHref)) { placeFloat(); scheduleWarm(); }
    }
  }, 700);

  placeFloat();
  scheduleWarm();
})();