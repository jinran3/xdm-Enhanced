"use strict";

const XDM_YT_URL = "http://127.0.0.1:8597";

export default class YoutubeBridge {
    list(url) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "list", browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
    download(url, res, format, lang) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "download", res: String(res || ""), format: String(format || ""), lang: String(lang || ""), browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
    downloadList(url) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "download-list", browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
    downloadSubs(url, lang, ext) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "download-subs", lang: String(lang || ""), ext: String(ext || ""), browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
    downloadList(url) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "download-list", browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
    downloadSubs(url, lang, ext) {
        return fetch(XDM_YT_URL + "/youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url, action: "download-subs", lang: String(lang || ""), ext: String(ext || ""), browser: "chrome" })
        }).then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false, error: "XDM 未运行" }));
    }
}