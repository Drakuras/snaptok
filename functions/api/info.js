// Cloudflare Pages Function: POST /api/info
// Deep-extraction TikTok metadata scraper

const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'];
const MOBILE_UA = 'com.zhiliaoapp.musically/2022405040 (Linux; U; Android 12; en_US; Pixel 6 Build/SD1A.210817.036; Cronet/58.0.2991.0)';

function isValidTikTokUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        return TIKTOK_HOSTS.some(
            (h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h)
        );
    } catch {
        return false;
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function extractVideoData(html) {
    // 1. Try __UNIVERSAL_DATA_FOR_REHYDRATION__ (Primary)
    const universalMatch = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (universalMatch) {
        try {
            const data = JSON.parse(universalMatch[1]);
            const scope = data?.__DEFAULT_SCOPE__ || {};
            const item = scope['webapp.video-detail']?.itemInfo?.itemStruct ||
                scope['webapp.video-detail']?.itemStruct ||
                scope['webapp.video-detail']?.videoDetail;
            if (item) return item;
        } catch { }
    }

    // 2. Try SIGI_STATE (Legacy/Secondary)
    const sigiMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
    if (sigiMatch) {
        try {
            const data = JSON.parse(sigiMatch[1]);
            if (data?.ItemModule) {
                const id = Object.keys(data.ItemModule)[0];
                if (id) return data.ItemModule[id];
            }
        } catch { }
    }

    // 3. Search for any JSON containing "playAddr" (The "Deep Search")
    const playAddrMatches = html.match(/"playAddr":"(.*?)"/);
    if (playAddrMatches && playAddrMatches[1]) {
        try {
            // Reconstruct a mini-object if possible
            const url = playAddrMatches[1].replace(/\\u002F/g, '/');
            return { video: { playAddr: url }, desc: 'TikTok Video' };
        } catch { }
    }

    // 4. Try extract from bitrate list (Common in newer pages)
    const bitrateMatch = html.match(/"bitrate_list":\[\{"bitrate":\d+,"video_extra":".*?","play_addr":\{"uri":".*?","url_list":\["(.*?)"\]/);
    if (bitrateMatch && bitrateMatch[1]) {
        return { video: { playAddr: bitrateMatch[1].replace(/\\u002F/g, '/') }, desc: 'TikTok Video' };
    }

    return null;
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const { url } = body;

        if (!url || !isValidTikTokUrl(url)) {
            return jsonResponse({ error: 'Please provide a valid TikTok URL.' }, 400);
        }

        const res = await fetch(url, {
            headers: {
                'User-Agent': MOBILE_UA,
                'header_name': 'header_value', // some dummy headers can help
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow',
        });

        if (!res.ok) {
            return jsonResponse({ error: 'TikTok is blocking access. Please try again later.' }, 502);
        }

        const html = await res.text();
        const videoData = extractVideoData(html);

        if (!videoData) {
            // Last resort: check if it's a mobile redirect-style page
            const redirectMatch = html.match(/window\.location\.href\s*=\s*"(.*?)"/);
            if (redirectMatch && redirectMatch[1] && redirectMatch[1] !== url) {
                // Should probably re-fetch, but let's just error for now to avoid loops
                return jsonResponse({ error: 'Video is protected or requires a refresh.' }, 403);
            }
            return jsonResponse({ error: 'Could not find video link. This video might be region-locked or private.' }, 404);
        }

        const video = videoData.video || {};
        // Find the best possible URL
        const downloadUrl = video.playAddr ||
            video.downloadAddr ||
            video.play_addr?.url_list?.[0] ||
            video.bitrate_list?.[0]?.play_addr?.url_list?.[0] ||
            null;

        return jsonResponse({
            title: videoData.desc || videoData.description || 'TikTok Video',
            thumbnail: video.cover || video.originCover || video.dynamicCover || null,
            duration: video.duration || 0,
            author: videoData.author?.uniqueId || videoData.author?.nickname || 'Unknown',
            downloadUrl: downloadUrl ? downloadUrl.replace(/\\u002F/g, '/') : null
        });
    } catch (err) {
        return jsonResponse({ error: 'Scraper failed to process this video.' }, 500);
    }
}
