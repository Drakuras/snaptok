// Cloudflare Pages Function: POST /api/info
// Fetches TikTok video metadata using mobile app patterns

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
    // 1. Try __UNIVERSAL_DATA_FOR_REHYDRATION__
    const universalMatch = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (universalMatch) {
        try {
            const data = JSON.parse(universalMatch[1]);
            const defaultScope = data?.__DEFAULT_SCOPE__;
            const videoDetail = defaultScope?.['webapp.video-detail']?.itemInfo?.itemStruct || defaultScope?.['webapp.video-detail']?.itemStruct;
            if (videoDetail) return videoDetail;
        } catch { }
    }

    // 2. Try SIGI_STATE
    const sigiMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
    if (sigiMatch) {
        try {
            const data = JSON.parse(sigiMatch[1]);
            if (data?.ItemModule) {
                const key = Object.keys(data.ItemModule)[0];
                if (key) return data.ItemModule[key];
            }
        } catch { }
    }

    // 3. Try to find any JSON-like object that looks like video info
    const jsonMatches = html.match(/\{"id":"\d+","desc":".*?"video":\{.*?\}/g);
    if (jsonMatches) {
        for (const match of jsonMatches) {
            try {
                const data = JSON.parse(match);
                if (data.video) return data;
            } catch { }
        }
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
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'follow',
        });

        if (!res.ok) {
            return jsonResponse({ error: 'TikTok is blocking the request. Try again in a moment.' }, 502);
        }

        const html = await res.text();
        const videoData = extractVideoData(html);

        if (!videoData) {
            // Final fallback: oEmbed
            const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
            if (oembedRes.ok) {
                const oembed = await oembedRes.json();
                return jsonResponse({
                    title: oembed.title || 'TikTok Video',
                    thumbnail: oembed.thumbnail_url || null,
                    author: oembed.author_name || 'Unknown',
                    downloadUrl: null
                });
            }
            return jsonResponse({ error: 'Could not extract video data. The video might be private.' }, 404);
        }

        const video = videoData.video || {};
        // Prioritize playAddr as it's usually less restricted than downloadAddr
        const downloadUrl = video.playAddr || video.downloadAddr || (video.play_addr?.url_list?.[0]) || null;

        return jsonResponse({
            title: videoData.desc || 'TikTok Video',
            thumbnail: video.cover || video.originCover || null,
            duration: video.duration || 0,
            author: videoData.author?.uniqueId || videoData.author?.nickname || 'Unknown',
            downloadUrl
        });
    } catch (err) {
        return jsonResponse({ error: 'Internal server error.' }, 500);
    }
}
