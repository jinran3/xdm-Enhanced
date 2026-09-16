using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using TraceLog;
using YDLWrapper;
using XDM.Core.Downloader;
using XDM.Core.Downloader.Adaptive.Dash;
using XDM.Core.Downloader.Adaptive.Hls;
using XDM.Core.Downloader.Progressive.DualHttp;
using XDM.Core.Downloader.Progressive.SingleHttp;
using XDM.Core.Util;

namespace XDM.Core
{
    public sealed class YouTubeDownloadService
    {
        private readonly object cacheLock = new object();
        private readonly Dictionary<string, List<YDLVideoEntry>> cache = new Dictionary<string, List<YDLVideoEntry>>();
        private readonly object inflightLock = new object();
        private readonly Dictionary<string, object> inflight = new Dictionary<string, object>();

        private static readonly Dictionary<string, string> LanguageMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "en", "英语" }, { "zh", "中文" }, { "ja", "日语" }, { "ko", "韩语" },
            { "fr", "法语" }, { "de", "德语" }, { "es", "西班牙语" }, { "hi", "印地语" },
            { "it", "意大利语" }, { "pt", "葡萄牙语" }, { "ru", "俄语" }, { "tr", "土耳其语" },
            { "ar", "阿拉伯语" }, { "th", "泰语" }, { "id", "印尼语" }, { "vi", "越南语" },
            { "nl", "荷兰语" }, { "pl", "波兰语" }, { "sv", "瑞典语" }, { "da", "丹麦语" },
            { "fi", "芬兰语" }, { "no", "挪威语" }, { "cs", "捷克语" }, { "hu", "匈牙利语" },
            { "ro", "罗马尼亚语" }, { "uk", "乌克兰语" }, { "ms", "马来语" }, { "tl", "菲律宾语" }
        };

        public sealed class Result
        {
            [JsonProperty("ok")]
            public bool Ok { get; set; }

            [JsonProperty("error")]
            public string? Error { get; set; }

            [JsonProperty("title")]
            public string? Title { get; set; }

            [JsonProperty("qualities")]
            public List<int>? Qualities { get; set; }

            [JsonProperty("formats")]
            public List<FormatInfo>? Formats { get; set; }

            [JsonProperty("is_playlist")]
            public bool IsPlaylist { get; set; }

            [JsonProperty("count")]
            public int Count { get; set; }

            [JsonProperty("subtitles")]
            public List<string>? Subtitles { get; set; }

            [JsonProperty("audio_tracks")]
            public List<AudioTrackInfo>? AudioTracks { get; set; }

            [JsonProperty("theme_mode")]
            public int ThemeMode { get; set; }
        }

        public sealed class Request
        {
            public string? Url { get; set; }
            public string? Action { get; set; }
            public string? Res { get; set; }
            public string? Browser { get; set; }
            public string? Format { get; set; }
            public string? Lang { get; set; }
            public string? Ext { get; set; }
        }

        public sealed class FormatInfo
        {
            [JsonProperty("h")]
            public int H { get; set; }

            [JsonProperty("video")]
            public string? VideoCodec { get; set; }

            [JsonProperty("audio")]
            public string? AudioCodec { get; set; }

            [JsonProperty("ext")]
            public string? Ext { get; set; }
        }

        public sealed class AudioTrackInfo
        {
            [JsonProperty("lang")]
            public string Lang { get; set; } = "";

            [JsonProperty("name")]
            public string Name { get; set; } = "";
        }

        public Result List(string url, string? browser)
        {
            try
            {
                var entries = Fetch(url, browser);
                if (entries == null || entries.Count == 0)
                {
                    return new Result { Ok = false, Error = "Unable to parse this video. Check the URL and your network." };
                }

                var heights = new HashSet<int>();
                foreach (var entry in entries)
                {
                    if (entry.Formats != null)
                    {
                        foreach (var format in entry.Formats)
                        {
                            if (!string.IsNullOrEmpty(format.Height) &&
                                int.TryParse(format.Height, out var height) && height > 0)
                            {
                                heights.Add(height);
                            }
                        }
                    }
                }

                var list = heights.OrderByDescending(h => h).ToList();
                var allFormats = entries.SelectMany(e => e.Formats ?? new List<YDLVideoFormatEntry>()).ToList();
                if (list.Count == 0 && allFormats.Count == 0)
                {
                    return new Result { Ok = false, Error = "No resolvable quality found for this video." };
                }

                return new Result
                {
                    Ok = true,
                    Title = entries[0].Title,
                    Qualities = list,
                    Formats = BuildFormats(allFormats),
                    IsPlaylist = entries.Count > 1,
                    Count = entries.Count,
                    Subtitles = BuildSubtitleLangs(entries),
                    AudioTracks = BuildAudioTracks(allFormats),
                    ThemeMode = Config.Instance.ThemeMode
                };
            }
            catch (FileNotFoundException)
            {
                return new Result { Ok = false, Error = "yt-dlp was not found. Put yt-dlp_x86.exe in the XDM folder and try again." };
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Error listing youtube video");
                return new Result { Ok = false, Error = "Failed to list qualities: " + ex.Message };
            }
        }

        public Result Download(string url, int height, string? browser) => Download(url, height, browser, null, null);

        public Result Download(string url, int height, string? browser, string? format) => Download(url, height, browser, format, null);

        public Result Download(string url, int height, string? browser, string? format, string? lang)
        {
            try
            {
                var entries = Fetch(url, browser);
                if (entries == null || entries.Count == 0)
                {
                    return new Result { Ok = false, Error = "Unable to parse this video. Check the URL and your network." };
                }

                var allFormats = entries.SelectMany(e => e.Formats ?? new List<YDLVideoFormatEntry>()).ToList();
                var selected = FindMatchingFormat(allFormats, height, format, out var found);
                if (!found)
                {
                    return new Result { Ok = false, Error = "No " + height + "p stream found." };
                }
                selected = SelectAudioTrack(allFormats, selected, lang);

                var info = BuildRequestData(selected);
                if (info == null)
                {
                    return new Result { Ok = false, Error = "Could not build a download stream for this quality." };
                }

                var title = string.IsNullOrEmpty(selected.Title) ? "YouTube Video" : selected.Title;
                var fileName = title + "." + (string.IsNullOrEmpty(selected.FileExt) ? "mp4" : selected.FileExt);
                var folder = GetDownloadFolder();
                var id = ApplicationContext.CoreService!.StartDownload(
                    info,
                    fileName,
                    FileNameFetchMode.None,
                    folder,
                    true,
                    null,
                    Config.Instance.Proxy,
                    null,
                    false);

                if (string.IsNullOrEmpty(id))
                {
                    return new Result { Ok = false, Error = "XDM could not start the download task." };
                }

                return new Result { Ok = true, Title = title };
            }
            catch (FileNotFoundException)
            {
                return new Result { Ok = false, Error = "yt-dlp was not found. Put yt-dlp_x86.exe in the XDM folder and try again." };
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Error downloading youtube video");
                return new Result { Ok = false, Error = "Download failed: " + ex.Message };
            }
        }

        private static string GetDownloadFolder()
        {
            var envOverride = Environment.GetEnvironmentVariable("XDM_YT_DOWNLOAD_DIR");
            if (!string.IsNullOrEmpty(envOverride))
            {
                return envOverride!;
            }
            return Helpers.GetVideoDownloadFolder();
        }

        private static List<string>? BuildSubtitleLangs(List<YDLVideoEntry> entries)
        {
            var set = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var e in entries)
            {
                if (e.Subtitles != null)
                {
                    foreach (var k in e.Subtitles.Keys) set.Add(k);
                }
                if (e.AutomaticCaptions != null)
                {
                    foreach (var k in e.AutomaticCaptions.Keys) set.Add(k);
                }
            }
            return set.Count == 0 ? null : set.ToList();
        }

        private static int MaxHeight(List<YDLVideoFormatEntry> formats)
        {
            var max = 0;
            foreach (var f in formats)
            {
                if (int.TryParse(f.Height, out var h) && h > max) max = h;
            }
            return max > 0 ? max : 2160;
        }

        /// <summary>Queue a download for every video in a playlist/channel.</summary>
        public Result DownloadList(string url, string? browser, string? format)
        {
            try
            {
                var entries = Fetch(url, browser);
                if (entries == null || entries.Count == 0)
                {
                    return new Result { Ok = false, Error = "Unable to parse this playlist. Check the URL and your network." };
                }

                var folder = GetDownloadFolder();
                var started = 0;
                var errors = new List<string>();
                for (var i = 0; i < entries.Count; i++)
                {
                    var entry = entries[i];
                    var entryFormats = entry.Formats ?? new List<YDLVideoFormatEntry>();
                    if (entryFormats.Count == 0)
                    {
                        continue;
                    }
                    var selected = FindMatchingFormat(entryFormats, MaxHeight(entryFormats), format, out var found);
                    if (!found)
                    {
                        errors.Add("#" + (i + 1) + " " + entry.Title + ": no stream");
                        continue;
                    }
                    var info = BuildRequestData(selected);
                    if (info == null)
                    {
                        errors.Add("#" + (i + 1) + " " + entry.Title + ": cannot build stream");
                        continue;
                    }
                    var title = string.IsNullOrEmpty(selected.Title) ? "YouTube Video" : selected.Title;
                    var fileName = title + "." + (string.IsNullOrEmpty(selected.FileExt) ? "mp4" : selected.FileExt);
                    try
                    {
                        var id = ApplicationContext.CoreService!.StartDownload(
                            info, fileName, FileNameFetchMode.None, folder, true, null, Config.Instance.Proxy, null, false);
                        if (!string.IsNullOrEmpty(id))
                        {
                            started++;
                        }
                        else
                        {
                            errors.Add("#" + (i + 1) + " " + entry.Title + ": start failed");
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.Debug(ex, "Error queuing playlist entry " + (i + 1));
                        errors.Add("#" + (i + 1) + " " + entry.Title + ": " + ex.Message);
                    }
                }

                if (started == 0)
                {
                    return new Result { Ok = false, Error = "No video in the playlist could be queued. " + string.Join("; ", errors) };
                }
                return new Result
                {
                    Ok = true,
                    Title = entries[0].Title,
                    IsPlaylist = true,
                    Count = entries.Count,
                    Error = errors.Count == 0 ? null : string.Join("; ", errors)
                };
            }
            catch (FileNotFoundException)
            {
                return new Result { Ok = false, Error = "yt-dlp was not found. Put yt-dlp_x86.exe in the XDM folder and try again." };
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Error queuing playlist");
                return new Result { Ok = false, Error = "Failed to queue playlist: " + ex.Message };
            }
        }

        /// <summary>Download a single subtitle track (SRT/VTT) via yt-dlp into the download folder.</summary>
        public Result DownloadSubs(string url, string? browser, string? lang, string? ext)
        {
            try
            {
                if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(lang))
                {
                    return new Result { Ok = false, Error = "Missing video URL or subtitle language." };
                }

                var entries = Fetch(url, browser);
                if (entries == null || entries.Count == 0)
                {
                    return new Result { Ok = false, Error = "Unable to parse this video. Check the URL and your network." };
                }

                var subsExt = string.IsNullOrEmpty(ext) ? "vtt" : ext.ToLowerInvariant();
                var track = FindSubtitleTrack(entries, lang, subsExt);
                if (string.IsNullOrEmpty(track.Url))
                {
                    return new Result { Ok = false, Error = "No subtitle found for language: " + lang };
                }

                var title = string.IsNullOrEmpty(entries[0].Title) ? "YouTube Video" : entries[0].Title;
                var fileName = title + "." + lang + "." + subsExt;
                var folder = GetDownloadFolder();
                var info = new SingleSourceHTTPDownloadInfo { Uri = track.Url };
                var id = ApplicationContext.CoreService!.StartDownload(
                    info,
                    fileName,
                    FileNameFetchMode.None,
                    folder,
                    true,
                    null,
                    Config.Instance.Proxy,
                    null,
                    false);

                if (string.IsNullOrEmpty(id))
                {
                    return new Result { Ok = false, Error = "XDM could not start the subtitle download task." };
                }

                return new Result { Ok = true, Title = title, Count = 1 };
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Error downloading subtitle");
                return new Result { Ok = false, Error = "Subtitle download failed: " + ex.Message };
            }
        }

        private static (string Url, string Ext) FindSubtitleTrack(List<YDLVideoEntry> entries, string lang, string preferredExt)
        {
            foreach (var e in entries)
            {
                var candidates = GetSubtitleCandidates(e.Subtitles, lang);
                if (candidates.Count == 0)
                {
                    candidates = GetSubtitleCandidates(e.AutomaticCaptions, lang);
                }
                if (candidates.Count == 0)
                {
                    continue;
                }
                var preferred = candidates.FirstOrDefault(s => !string.IsNullOrEmpty(s.Url) && string.Equals(s.Ext, preferredExt, StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrEmpty(preferred.Url))
                {
                    return (preferred.Url, string.IsNullOrEmpty(preferred.Ext) ? preferredExt : preferred.Ext);
                }
                var vtt = candidates.FirstOrDefault(s => string.Equals(s.Ext, "vtt", StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrEmpty(vtt.Url))
                {
                    return (vtt.Url, "vtt");
                }
                var any = candidates.FirstOrDefault(s => !string.IsNullOrEmpty(s.Url));
                if (!string.IsNullOrEmpty(any.Url))
                {
                    return (any.Url, string.IsNullOrEmpty(any.Ext) ? preferredExt : any.Ext);
                }
            }
            return (null, null);
        }

        private static List<YDLSubtitle> GetSubtitleCandidates(Dictionary<string, List<YDLSubtitle>>? map, string lang)
        {
            if (map != null)
            {
                foreach (var kv in map)
                {
                    if (string.Equals(kv.Key, lang, StringComparison.OrdinalIgnoreCase))
                    {
                        return kv.Value ?? new List<YDLSubtitle>();
                    }
                }
            }
            return new List<YDLSubtitle>();
        }

        private static List<FormatInfo> BuildFormats(List<YDLVideoFormatEntry> formats)
        {
            var seen = new HashSet<string>();
            var list = new List<FormatInfo>();
            foreach (var f in formats)
            {
                if (!int.TryParse(f.Height, out var h) || h <= 0)
                {
                    continue;
                }
                var video = NormalizeCodec(f.VideoCodec);
                if (string.IsNullOrEmpty(video) || "none".Equals(video))
                {
                    continue;
                }
                var audio = NormalizeCodec(f.AudioCodec);
                var ext = string.IsNullOrEmpty(f.FileExt) ? "mp4" : f.FileExt.ToLowerInvariant();
                if ("none".Equals(audio) || string.IsNullOrEmpty(audio))
                {
                    audio = null;
                }
                if ("mhtml".Equals(ext) || "jpg".Equals(ext) || "html".Equals(ext))
                {
                    continue;
                }
                var key = h + "|" + video + "|" + ext;
                if (!seen.Add(key))
                {
                    continue;
                }
                list.Add(new FormatInfo
                {
                    H = h,
                    VideoCodec = video,
                    AudioCodec = audio,
                    Ext = ext
                });
            }
            list.Sort((a, b) => b.H.CompareTo(a.H));
            return list;
        }

        private static string? NormalizeCodec(string? codec)
        {
            if (string.IsNullOrEmpty(codec))
            {
                return null;
            }
            var lower = codec.ToLowerInvariant();
            if (lower.Contains("av01")) return "av01";
            if (lower.Contains("avc")) return "avc1";
            if (lower.Contains("vp9")) return "vp9";
            if (lower.Contains("hevc")) return "hevc";
            if (lower.Contains("vp8")) return "vp8";
            return lower;
        }

        private List<YDLVideoEntry>? Fetch(string? url, string? browser)
        {
            if (string.IsNullOrEmpty(url) || !Helpers.IsUriValid(url))
            {
                return null;
            }

            // Keep one in-flight parse per URL: if the user clicks download before the
            // cache-warm list finishes, the download reuses the ongoing yt-dlp run
            // instead of launching a second slow parse for the same video. The gate is
            // taken outside inflightLock so different videos can still be parsed in
            // parallel.
            object gate;
            lock (inflightLock)
            {
                if (cache.TryGetValue(url, out var cached))
                {
                    return cached;
                }
                if (!inflight.TryGetValue(url, out var existing))
                {
                    existing = new object();
                    inflight[url] = existing;
                }
                gate = existing;
            }

            lock (gate)
            {
                try
                {
                    // Another requester may have filled the cache while this thread was
                    // waiting to acquire the gate.
                    lock (cacheLock)
                    {
                        if (cache.TryGetValue(url, out var cached))
                        {
                            return cached;
                        }
                    }

                    var ydl = new YDLProcess
                    {
                        Uri = new Uri(url!)
                    };
                    try
                    {
                        ydl.Start();
                    }
                    catch (FileNotFoundException)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        // yt-dlp can exit non-zero for a playlist that contains private/removed
                        // entries even though it still printed valid JSON lines; keep parsing the
                        // output instead of discarding it.
                        Log.Debug(ex, "yt-dlp returned a non-zero exit; parsing partial output");
                    }

                    if (string.IsNullOrEmpty(ydl.JsonOutputFile) || !File.Exists(ydl.JsonOutputFile))
                    {
                        return null;
                    }
                    var entries = YDLOutputParser.Parse(ydl.JsonOutputFile);
                    if (entries == null || entries.Count == 0)
                    {
                        return null;
                    }

                    lock (cacheLock)
                    {
                        cache[url] = entries;
                    }
                    return entries;
                }
                finally
                {
                    lock (inflightLock)
                    {
                        inflight.Remove(url);
                    }
                }
            }
        }

        private static YDLVideoFormatEntry SelectAudioTrack(List<YDLVideoFormatEntry> formats, YDLVideoFormatEntry selected, string? lang)
        {
            if (string.IsNullOrEmpty(lang) || string.IsNullOrEmpty(selected.VideoUrl))
            {
                return selected;
            }
            var variants = formats
                .Where(f => !string.IsNullOrEmpty(f.VideoUrl) && f.VideoUrl == selected.VideoUrl)
                .ToList();
            if (variants.Count == 0)
            {
                return selected;
            }
            var match = variants.FirstOrDefault(f => LangMatch(f.Language, lang));
            return match.Equals(default(YDLVideoFormatEntry)) ? selected : match;
        }

        private static bool LangMatch(string? candidateLang, string requestedLang)
        {
            if (string.IsNullOrEmpty(candidateLang))
            {
                return false;
            }
            if (string.Equals(candidateLang, requestedLang, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            var cb = LangBase(candidateLang);
            var rb = LangBase(requestedLang);
            return cb != null && rb != null && cb == rb;
        }

        private static string? LangBase(string code)
        {
            if (string.IsNullOrEmpty(code))
            {
                return null;
            }
            var i = code.IndexOfAny(new[] { '-', '_' });
            return (i >= 0 ? code.Substring(0, i) : code).ToLowerInvariant();
        }

        private static List<AudioTrackInfo>? BuildAudioTracks(List<YDLVideoFormatEntry> formats)
        {
            var langs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in formats)
            {
                var lg = f.Language;
                if (string.IsNullOrEmpty(lg))
                {
                    continue;
                }
                langs.Add(lg);
                if (!names.ContainsKey(lg) && !string.IsNullOrEmpty(f.AudioName))
                {
                    names[lg] = f.AudioName;
                }
            }
            if (langs.Count == 0)
            {
                return null;
            }
            var list = new List<AudioTrackInfo>();
            foreach (var lg in langs.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
            {
                var name = LanguageName(lg);
                if (string.IsNullOrEmpty(name) && names.ContainsKey(lg))
                {
                    name = CleanAudioName(names[lg]);
                }
                if (string.IsNullOrEmpty(name))
                {
                    name = lg;
                }
                list.Add(new AudioTrackInfo { Lang = lg, Name = name });
            }
            return list;
        }

        private static string LanguageName(string code)
        {
            var baseL = LangBase(code);
            if (baseL != null && LanguageMap.ContainsKey(baseL))
            {
                return LanguageMap[baseL];
            }
            return "";
        }

        private static string CleanAudioName(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return "";
            }
            var part = name.Split(',')[0].Trim();
            part = System.Text.RegularExpressions.Regex.Replace(part, @"\s*\(default\)\s*", " ", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
            part = System.Text.RegularExpressions.Regex.Replace(part, @"\s*original\s*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return part.Trim();
        }

        private static YDLVideoFormatEntry FindMatchingFormat(List<YDLVideoFormatEntry> formats, int quality, string? requestedFormat, out bool found)
        {
            found = false;
            if (formats == null || formats.Count == 0)
            {
                return default;
            }

            if (!string.IsNullOrEmpty(requestedFormat))
            {
                // Prefer the requested codec family (e.g. av01/vp9/avc1) at the target height.
                foreach (var f in formats)
                {
                    if (int.TryParse(f.Height, out var h) && h == quality &&
                        NormalizeCodec(f.VideoCodec) == requestedFormat)
                    {
                        found = true;
                        return f;
                    }
                }
                // Fall back to any same-codec format (best height near target) below/equal quality.
                YDLVideoFormatEntry codecBest = default;
                var codecMax = -1;
                foreach (var f in formats)
                {
                    if (NormalizeCodec(f.VideoCodec) != requestedFormat || !int.TryParse(f.Height, out var h) || h <= 0)
                    {
                        continue;
                    }
                    if (h <= quality && h > codecMax)
                    {
                        codecMax = h;
                        codecBest = f;
                    }
                }
                if (codecMax >= 0)
                {
                    found = true;
                    return codecBest;
                }
            }

            foreach (var f in formats)
            {
                if (int.TryParse(f.Height, out var h) && h == quality &&
                    (!string.IsNullOrEmpty(f.FileExt) && f.FileExt.IndexOf("mp4", StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    found = true;
                    return f;
                }
            }

            foreach (var f in formats)
            {
                if (int.TryParse(f.Height, out var h) && h == quality)
                {
                    found = true;
                    return f;
                }
            }

            var best = default(YDLVideoFormatEntry);
            var max = -1;
            foreach (var format in formats)
            {
                if (int.TryParse(format.Height, out var h) && h > 0 && quality > h && h > max)
                {
                    max = h;
                    best = format;
                }
            }
            if (max >= 0)
            {
                found = true;
                return best;
            }

            found = true;
            return formats[0];
        }

        private static IRequestData? BuildRequestData(YDLVideoFormatEntry entry)
        {
            return entry.YDLEntryType switch
            {
                YDLEntryType.Http => new SingleSourceHTTPDownloadInfo
                {
                    Uri = entry.VideoUrl
                },
                YDLEntryType.Dash => new DualSourceHTTPDownloadInfo
                {
                    Uri1 = entry.VideoUrl,
                    Uri2 = entry.AudioUrl
                },
                YDLEntryType.Hls => new MultiSourceHLSDownloadInfo
                {
                    VideoUri = entry.VideoUrl,
                    AudioUri = entry.AudioUrl
                },
                YDLEntryType.MpegDash => new MultiSourceDASHDownloadInfo
                {
                    VideoSegments = entry.VideoFragments?.Select(x => new Uri(new Uri(entry.FragmentBaseUrl), x.Path)).ToList(),
                    AudioSegments = entry.AudioFragments?.Select(x => new Uri(new Uri(entry.FragmentBaseUrl), x.Path)).ToList(),
                    AudioFormat = entry.AudioFormat != null ? "." + entry.AudioFormat : null,
                    VideoFormat = entry.VideoFormat != null ? "." + entry.VideoFormat : null,
                    Url = entry.VideoUrl
                },
                _ => null
            };
        }
    }
}
