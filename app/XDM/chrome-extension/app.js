"use strict";
import Logger from './logger.js';
import RequestWatcher from './request-watcher.js';
import Connector from './connector.js';
import YoutubeBridge from './youtube.js';

export default class App {
    constructor() {
        this.logger = new Logger();
        this.videoList = [];
        this.blockedHosts = [];
        this.fileExts = [];
        this.requestWatcher = new RequestWatcher(this.onRequestDataReceived.bind(this));
        this.tabsWatcher = [];
        this.userDisabled = false;
        this.appEnabled = false;
        this.onDownloadCreatedCallback = this.onDownloadCreated.bind(this);
        this.onDeterminingFilenameCallback = this.onDeterminingFilename.bind(this);
        this.onTabUpdateCallback = this.onTabUpdate.bind(this);
        this.activeTabId = -1;
        this.disabledTabs = new Set();
        this.tabStateLoaded = false;
        this.connector = new Connector(this.onMessage.bind(this), this.onDisconnect.bind(this));
        this.youtube = new YoutubeBridge();
    }

    start() {
        this.logger.log("starting...");
        this.starAppConnector();
        this.register();
        this.loadTabState();
        this.logger.log("started.");
    }

    starAppConnector() {
        this.connector.connect();
    }

    onMessage(msg) {
        this.logger.log("message from XDM");
        this.logger.log(msg);
        this.appEnabled = msg.enabled === true;
        this.fileExts = msg.fileExts;
        this.blockedHosts = msg.blockedHosts;
        this.tabsWatcher = msg.tabsWatcher;
        this.videoList = msg.videoList;
        this.requestWatcher.updateConfig({
            mediaExts: msg.requestFileExts,
            blockedHosts: msg.blockedHosts,
            matchingHosts: msg.matchingHosts,
            mediaTypes: msg.mediaTypes
        });
        this.updateActionIcon();
    }

    onDisconnect() {
        this.logger.log("Disconnected from native host!");
        this.logger.log("Disconnected...");
        this.updateActionIcon();
    }

    isMonitoringEnabled() {
        this.logger.log(this.appEnabled + " " + this.userDisabled);
        return this.appEnabled === true && this.userDisabled === false && this.connector.isConnected();
    }

    loadTabState() {
        try {
            chrome.storage.local.get({ "xdm.disabledTabs": [] }, (store) => {
                let arr = store["xdm.disabledTabs"] || [];
                this.disabledTabs = new Set(arr.map(String));
                this.tabStateLoaded = true;
                this.updateActionIcon();
            });
        } catch (e) {
            this.tabStateLoaded = true;
        }
    }

    saveTabState() {
        try {
            chrome.storage.local.set({ "xdm.disabledTabs": Array.from(this.disabledTabs) });
        } catch (e) { }
    }

    isTabEnabled(tabId) {
        let id = String((tabId === undefined || tabId === null || tabId === -1) ? this.activeTabId : tabId);
        return !this.disabledTabs.has(id);
    }

    setTabEnabled(tabId, enabled) {
        let id = String((tabId === undefined || tabId === null || tabId === -1) ? this.activeTabId : tabId);
        if (enabled) this.disabledTabs.delete(id);
        else this.disabledTabs.add(id);
        this.saveTabState();
        this.updateActionIcon(tabId);
    }

    getActiveTabId(callback) {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                let id = (tabs && tabs[0]) ? tabs[0].id : null;
                if (id !== null && id !== undefined) this.activeTabId = id;
                callback(id);
            });
        } catch (e) {
            callback(this.activeTabId);
        }
    }

    onRequestDataReceived(data) {
        //Streaming video data received, send to native messaging application
        this.logger.log("onRequestDataReceived");
        if (data && data.tabId !== undefined && data.tabId !== "-1" && !this.isTabEnabled(data.tabId)) {
            this.logger.log("Monitoring disabled for this tab; dropping media request");
            return;
        }
        this.logger.log(data);
        this.isMonitoringEnabled() && this.connector.isConnected() && this.connector.postMessage("/media", data);
    }

    onDeterminingFilename(download, suggest) {
        this.logger.log("onDeterminingFilename");
        if (!this.isMonitoringEnabled()) {
            return;
        }
        this.logger.log(download);
        let url = download.finalUrl || download.url;
        this.logger.log(url);
        if (this.isMonitoringEnabled() && this.shouldTakeOver(url, download.filename)) {
            chrome.downloads.cancel(
                download.id,
                () => chrome.downloads.erase({ id: download.id })
            );
            let referrer = download.referrer;
            if (!referrer && download.finalUrl !== download.url) {
                referrer = download.url;
            }
            this.triggerDownload(url, download.filename,
                referrer, download.fileSize, download.mime);
        }
    }

    onDownloadCreated(download) {
        this.logger.log("onDownloadCreated");
        this.logger.log(download);
    }

    onTabUpdate(tabId, changeInfo, tab) {
        if (!this.isMonitoringEnabled()) {
            return;
        }
        if (changeInfo.title) {
            if (this.tabsWatcher &&
                this.tabsWatcher.find(t => tab.url.indexOf(t) > 0)) {
                this.logger.log("Tab changed: " + changeInfo.title + " => " + tab.url);
                try {
                    this.connector.postMessage("/tab-update", {
                        tabUrl: tab.url,
                        tabTitle: changeInfo.title
                    });
                } catch (ex) {
                    console.log(ex);
                }
            }
        }
    }

    register() {
        chrome.downloads.onCreated.addListener(
            this.onDownloadCreatedCallback
        );
        chrome.downloads.onDeterminingFilename.addListener(
            this.onDeterminingFilenameCallback
        );
        chrome.tabs.onUpdated.addListener(
            this.onTabUpdateCallback
        );
        chrome.runtime.onMessage.addListener(this.onPopupMessage.bind(this));
        this.requestWatcher.register();
        this.attachContextMenu();
        chrome.tabs.onActivated.addListener(this.onTabActivated.bind(this));
    }

    isSupportedProtocol(url) {
        if (!url) return false;
        let u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    }

    shouldTakeOver(url, file) {
        let u = new URL(url);
        if (!this.isSupportedProtocol(url)) {
            return false;
        }
        let hostName = u.host;
        if (this.blockedHosts.find(item => hostName.indexOf(item) >= 0)) {
            return false;
        }
        let path = file || u.pathname;
        let upath = path.toUpperCase();
        if (this.fileExts.find(ext => upath.endsWith(ext))) {
            return true;
        }
        return false;
    }

    updateActionIcon(tabId) {
        let on = this.isMonitoringEnabled() && this.isTabEnabled(tabId);
        chrome.action.setIcon({ path: this.getActionIcon(on) });
        let vc = "";
        if (on) {
            if (this.videoList && this.videoList.length > 0) {
                vc = this.videoList.length + "";
            }
        } else {
            vc = "×";
        }
        chrome.action.setBadgeText({ text: vc });
        if (!this.connector.isConnected()) {
            this.logger.log("Not connected...");
            chrome.action.setPopup({ popup: "./error.html" });
            return;
        }
        if (!this.appEnabled) {
            chrome.action.setPopup({ popup: "./disabled.html" });
            return;
        }
        else {
            chrome.action.setPopup({ popup: "./popup.html" });
            return;
        }
    }

    getActionIconName(icon, on) {
        return on ? icon + ".png" : icon + "-mono.png";
    }

    getActionIcon(on) {
        return {
            "16": this.getActionIconName("icon16", on),
            "48": this.getActionIconName("icon48", on),
            "128": this.getActionIconName("icon128", on)
        }
    }

    triggerDownload(url, file, referer, size, mime) {
        chrome.cookies.getAll({ "url": url }, cookies => {
            let cookieStr = undefined;
            if (cookies) {
                cookieStr = cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ");
            }
            let requestHeaders = { "User-Agent": [navigator.userAgent] };
            if (referer) {
                requestHeaders["Referer"] = [referer];
            }
            let responseHeaders = {};
            if (size) {
                let fz = +size;
                if (fz > 0) {
                    responseHeaders["Content-Length"] = [fz];
                }
            }
            if (mime) {
                responseHeaders["Content-Type"] = [mime];
            }
            let data = {
                url: url,
                cookie: cookieStr,
                requestHeaders: requestHeaders,
                responseHeaders: responseHeaders,
                filename: file,
                fileSize: size,
                mimeType: mime
            };
            this.logger.log(data);
            this.connector.postMessage("/download", data);
        });
    }

    diconnect() {
        this.onDisconnect();
    }

    onPopupMessage(request, sender, sendResponse) {
        this.logger.log(request.type);
        if (request.type === "stat") {
            let resp = {
                enabled: this.isMonitoringEnabled() && this.isTabEnabled(this.activeTabId),
                list: this.videoList
                // list: this.videoList.filter(vid => {
                //     if (!vid.tabId) {
                //         return true;
                //     }
                //     return (vid.tabId == this.activeTabId);
                // })
            };
            sendResponse(resp);
        }
        else if (request.type === "cmd") {
            this.getActiveTabId((tabId) => {
                if (tabId === null || tabId === undefined || tabId === -1) {
                    this.userDisabled = request.enabled === false;
                } else {
                    this.setTabEnabled(tabId, request.enabled === true);
                }
                this.logger.log("request.enabled:" + request.enabled);
                if (request.enabled && !this.connector.isConnected()) {
                    this.connector.launchApp();
                    return;
                }
                this.updateActionIcon(tabId);
            });
        }
        else if (request.type === "vid") {
            let vid = request.itemId;
            this.connector.postMessage("/vid", {
                vid: vid + "",
            });
        }
        else if (request.type === "clear") {
            this.connector.postMessage("/clear", {});
        }
        else if (request.type === "youtube-list") {
            this.youtube.list(request.url || "").then((r) => sendResponse(r));
            return true;
        }
        else if (request.type === "youtube-grab-dl") {
            this.youtube.download(request.url || "", request.res, request.format, request.lang).then((r) => sendResponse(r));
            return true;
        }
        else if (request.type === "youtube-download-list") {
            this.youtube.downloadList(request.url || "").then((r) => sendResponse(r));
            return true;
        }
        else if (request.type === "youtube-download-subs") {
            this.youtube.downloadSubs(request.url || "", request.lang || "", request.ext || "").then((r) => sendResponse(r));
            return true;
        }
    }

    sendLinkToXDM(info, tab) {
        let url = info.linkUrl;
        if (!this.isSupportedProtocol(url)) {
            url = info.srcUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            url = info.pageUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            return;
        }
        this.triggerDownload(url, null, info.pageUrl, null, null);
    }

    sendImageToXDM(info, tab) {
        let url = info.srcUrl;
        if (!this.isSupportedProtocol(url))
            url = info.linkUrl;
        if (!this.isSupportedProtocol(url)) {
            url = info.pageUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            return;
        }
        this.triggerDownload(url, null, info.pageUrl, null, null);
    }

    onMenuClicked(info, tab) {
        if (info.menuItemId == "download-any-link") {
            this.sendLinkToXDM(info, tab);
        }
        if (info.menuItemId == "download-image-link") {
            this.sendImageToXDM(info, tab);
        }
    }

    attachContextMenu() {
        chrome.contextMenus.create({
            id: 'download-any-link',
            title: "Download with XDM",
            contexts: ["link", "video", "audio", "all"]
        });

        chrome.contextMenus.create({
            id: 'download-image-link',
            title: "Download Image with XDM",
            contexts: ["image"]
        });

        chrome.contextMenus.onClicked.addListener(this.onMenuClicked.bind(this));
    }

    onTabActivated(activeInfo) {
        this.activeTabId = activeInfo.tabId + "";
        this.logger.log("Active tab: " + this.activeTabId);
        this.updateActionIcon();
    }
}
