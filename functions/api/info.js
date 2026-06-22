// Cloudflare Pages Function: POST /api/info

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function detectPlatform(url) {
    try {
        const { hostname } = new URL(url);
        if (/tiktok\.com$/.test(hostname)) return 'tiktok';
        if (/youtube\.com$/.test(hostname) || /youtu\.be$/.test(hostname)) return 'youtube';
    } catch {}
    return null;
}

const TIKTOK_APP_UA = 'TikTok 26.2.0 rv:262018 (iPhone; iOS 14.4.2; en_US) Cronet';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function extractUrl(field) {
    if (!field) return null;
    if (typeof field === 'string') return field;
    if (Array.isArray(field) && field.length) return field[0];
    if (field.urlList?.length) return field.urlList[0];
    if (field.url_list?.length) return field.url_list[0];
    return null;
}

// Step 2: TikTok's internal mobile API across multiple regional endpoints
async function tryMobileApi(awemeId) {
    const endpoints = [
        'https://api16-normal-c-useast1a.tiktokv.com',
        'https://api22-normal-c-useast2a.tiktokv.com',
        'https://api19-normal-c-useast1a.tiktokv.com',
    ];
    const qs = new URLSearchParams({
        aweme_id: awemeId,
        iid: '7318518857994389254',
        device_id: '7318517557120613121',
        channel: 'App',
        app_name: 'musical_ly',
        version_code: '260202',
        device_platform: 'iphone',
        device_type: 'iPhone14,5',
        os_version: '15.6.1',
    }).toString();

    for (const base of endpoints) {
        try {
            const res = await fetch(`${base}/aweme/v1/feed/?${qs}`, {
                headers: { 'User-Agent': TIKTOK_APP_UA },
            });
            if (!res.ok) continue;
            const data = await res.json();
            const item = data?.aweme_list?.[0];
            const downloadUrl = item?.video?.play_addr?.url_list?.[0]
                             || item?.video?.download_addr?.url_list?.[0];
            if (item && downloadUrl) return { item, downloadUrl };
        } catch {}
    }
    return null;
}

// Step 3: TikTok's web AJAX API — used by embed.js, less IP-restricted than mobile API
async function tryWebApi(awemeId) {
    const qs = new URLSearchParams({
        itemId: awemeId,
        aid: '1988',
        app_language: 'en',
        app_name: 'tiktok_web',
        channel: 'tiktok_web',
        device_platform: 'web_pc',
        region: 'US',
    }).toString();

    try {
        const res = await fetch(`https://www.tiktok.com/api/item/detail/?${qs}`, {
            headers: {
                'User-Agent': BROWSER_UA,
                'Referer': 'https://www.tiktok.com/',
                'Accept': 'application/json, text/plain, */*',
            },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const item = data?.itemInfo?.itemStruct;
        if (!item) return null;
        const downloadUrl = extractUrl(item.video?.playAddr) || extractUrl(item.video?.downloadAddr);
        if (!downloadUrl) return null;
        return { item, downloadUrl };
    } catch {
        return null;
    }
}

// Step 4: Scrape TikTok page HTML — try both desktop and mobile pages
async function scrapeTikTokPage(url, awemeId) {
    const attempts = [
        { fetchUrl: url, ua: BROWSER_UA },
        // Mobile page has simpler bot detection and different HTML structure
        ...(awemeId ? [{ fetchUrl: `https://m.tiktok.com/v/${awemeId}.html`, ua: MOBILE_UA }] : []),
    ];

    for (const { fetchUrl, ua } of attempts) {
        try {
            const res = await fetch(fetchUrl, {
                headers: {
                    'User-Agent': ua,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Sec-Fetch-Mode': 'navigate',
                },
                redirect: 'follow',
            });
            if (!res.ok) continue;

            const html = await res.text();
            let item = null;

            // Current desktop format
            const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
            if (universalMatch) {
                try {
                    const data = JSON.parse(universalMatch[1]);
                    item = data?.['webapp.video-detail']?.itemInfo?.itemStruct;
                } catch {}
            }

            // Older desktop format
            if (!item) {
                const sigiMatch = html.match(/<script id="__SIGI_STATE__"[^>]*>([\s\S]*?)<\/script>/);
                if (sigiMatch) {
                    try {
                        const data = JSON.parse(sigiMatch[1]);
                        const itemModule = data?.ItemModule;
                        if (itemModule) item = Object.values(itemModule)[0];
                    } catch {}
                }
            }

            if (!item) continue;

            const downloadUrl = extractUrl(item.video?.downloadAddr)
                             || extractUrl(item.video?.playAddr);
            if (!downloadUrl) continue;

            return {
                downloadUrl,
                title: item.desc || null,
                author: item.author?.uniqueId || item.author?.nickname || null,
                thumbnail: extractUrl(item.video?.cover) || extractUrl(item.video?.originCover) || null,
                duration: item.video?.duration || 0,
            };
        } catch {}
    }
    return null;
}

async function tryTikWM(url, apiKey) {
    try {
        const body = new URLSearchParams({ url, hd: '1' });
        if (apiKey) body.set('token', apiKey);
        const res = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.code !== 0 || !data.data) return null;
        const v = data.data;
        // Prefer HD → standard → watermarked as last resort
        const downloadUrl = v.hdplay || v.play || v.wmplay || null;
        if (!downloadUrl) return null;
        return {
            downloadUrl,
            title: v.title || null,
            author: v.author?.unique_id || v.author?.nickname || null,
            thumbnail: v.cover || null,
            duration: v.duration || 0,
        };
    } catch {
        return null;
    }
}

async function resolveShortUrl(url) {
    try {
        const res = await fetch(url, {
            method: 'HEAD', redirect: 'follow',
            headers: { 'User-Agent': MOBILE_UA },
        });
        return res.url || url;
    } catch {
        return url;
    }
}

async function handleTikTok(url, tikwmKey) {
    // Resolve tiktok.com/t/... short links to full video URLs before anything else
    if (/tiktok\.com\/t\//i.test(url)) {
        url = await resolveShortUrl(url);
    }

    // Step 1: oEmbed — resolves any URL format, gives metadata + aweme_id
    let awemeId = null;
    let meta = {};
    try {
        const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        if (oembedRes.ok) {
            const oembed = await oembedRes.json();
            awemeId = oembed.html?.match(/\/video\/(\d+)/)?.[1] ?? null;
            meta = { title: oembed.title, author: oembed.author_name, thumbnail: oembed.thumbnail_url };
        }
    } catch {}

    if (!awemeId) {
        awemeId = new URL(url).pathname.match(/\/video\/(\d+)/)?.[1] ?? null;
    }

    function buildResult(source) {
        return {
            platform: 'tiktok',
            title: meta.title || source.title || 'TikTok Video',
            thumbnail: meta.thumbnail || source.thumbnail || null,
            duration: source.duration || 0,
            author: meta.author || source.author || 'Unknown',
            downloadUrl: source.downloadUrl,
        };
    }

    // When an API key is set, TikWM is the most reliable method — try it first
    if (tikwmKey) {
        const tikwm = await tryTikWM(url, tikwmKey);
        if (tikwm?.downloadUrl) return buildResult(tikwm);
    }

    // Native TikTok methods (free, but blocked on some datacenter IPs)

    // Step 2: Mobile API (multiple regional endpoints)
    if (awemeId) {
        const r = await tryMobileApi(awemeId);
        if (r) {
            const raw = r.item.video?.duration || 0;
            return buildResult({
                downloadUrl: r.downloadUrl,
                title: r.item.desc,
                thumbnail: r.item.video?.cover?.url_list?.[0],
                duration: raw > 1000 ? Math.round(raw / 1000) : raw,
                author: r.item.author?.unique_id || r.item.author?.nickname,
            });
        }
    }

    // Step 3: TikTok web AJAX API
    if (awemeId) {
        const r = await tryWebApi(awemeId);
        if (r) {
            return buildResult({
                downloadUrl: r.downloadUrl,
                title: r.item.desc,
                thumbnail: extractUrl(r.item.video?.cover),
                duration: r.item.video?.duration || 0,
                author: r.item.author?.uniqueId || r.item.author?.nickname,
            });
        }
    }

    // Step 4: Page scraping (desktop + mobile TikTok)
    const scraped = await scrapeTikTokPage(url, awemeId);
    if (scraped?.downloadUrl) return buildResult(scraped);

    // Step 5: TikWM free tier — last resort (10k req/day, no key)
    if (!tikwmKey) {
        const tikwm = await tryTikWM(url, null);
        if (tikwm?.downloadUrl) return buildResult(tikwm);
    }

    throw new Error('Could not extract video info. Please try again.');
}

function extractYouTubeId(url) {
    try {
        const parsed = new URL(url);
        if (/youtu\.be$/.test(parsed.hostname)) return parsed.pathname.slice(1).split('?')[0];
        return parsed.searchParams.get('v');
    } catch { return null; }
}

async function fetchYouTubePlayer(videoId) {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)',
        },
        body: JSON.stringify({
            videoId,
            context: {
                client: {
                    clientName: 'IOS',
                    clientVersion: '19.45.4',
                    deviceModel: 'iPhone16,2',
                    hl: 'en',
                    gl: 'US'
                }
            }
        })
    });
    if (!res.ok) throw new Error(`YouTube API returned ${res.status}`);
    return res.json();
}

async function handleYouTube(url) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Could not parse YouTube video ID from URL.');

    const [metaRes, player] = await Promise.all([
        fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`),
        fetchYouTubePlayer(videoId)
    ]);

    if (player.playabilityStatus?.status !== 'OK') {
        throw new Error(player.playabilityStatus?.reason || 'This video is not available.');
    }

    const formats = player.streamingData?.formats || [];
    // itag 22 = 720p MP4 combined stream, itag 18 = 360p MP4 combined stream
    const format = formats.find(f => f.itag === 22)
                || formats.find(f => f.itag === 18)
                || formats.find(f => f.mimeType?.startsWith('video/mp4') && f.url);

    if (!format?.url) throw new Error('Could not extract a download link for this video.');

    const meta = metaRes.ok ? await metaRes.json() : {};

    return {
        platform: 'youtube',
        title: meta.title || player.videoDetails?.title || 'YouTube Video',
        thumbnail: meta.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        duration: parseInt(player.videoDetails?.lengthSeconds) || 0,
        author: meta.author_name || player.videoDetails?.author || 'Unknown',
        downloadUrl: format.url
    };
}

export async function onRequestPost(context) {
    try {
        const { url } = await context.request.json();
        if (!url) return jsonResponse({ error: 'URL is required' }, 400);

        const platform = detectPlatform(url);
        if (!platform) return jsonResponse({ error: 'Please provide a valid TikTok or YouTube URL.' }, 400);

        const tikwmKey = context.env.TIKWM_KEY || null;
        const result = platform === 'youtube' ? await handleYouTube(url) : await handleTikTok(url, tikwmKey);
        return jsonResponse(result);

    } catch (err) {
        const tikwmKey = context.env.TIKWM_KEY || null;
        const msg = err.message || 'Failed to process video info.';
        return jsonResponse({ error: `${msg} [tikwm_key:${tikwmKey ? 'SET' : 'MISSING'}]` }, 500);
    }
}
