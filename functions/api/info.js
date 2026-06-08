// Cloudflare Pages Function: POST /api/info
// Fetches TikTok video metadata by scraping the page

const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'];

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

// Extract video data from TikTok's embedded JSON
function extractVideoData(html) {
    // Try __UNIVERSAL_DATA_FOR_REHYDRATION__ (newer TikTok pages)
    const universalMatch = html.match(
        /<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (universalMatch) {
        try {
            const data = JSON.parse(universalMatch[1]);
            const defaultScope = data?.__DEFAULT_SCOPE__;
            const videoDetail =
                defaultScope?.['webapp.video-detail']?.itemInfo?.itemStruct ||
                defaultScope?.['webapp.video-detail']?.itemStruct;
            if (videoDetail) return videoDetail;
        } catch { }
    }

    // Try SIGI_STATE (older pages)
    const sigiMatch = html.match(
        /<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/
    );
    if (sigiMatch) {
        try {
            const data = JSON.parse(sigiMatch[1]);
            const items = data?.ItemModule;
            if (items) {
                const key = Object.keys(items)[0];
                if (key) return items[key];
            }
        } catch { }
    }

    // Try __NEXT_DATA__
    const nextMatch = html.match(
        /<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextMatch) {
        try {
            const data = JSON.parse(nextMatch[1]);
            const videoData = data?.props?.pageProps?.itemInfo?.itemStruct;
            if (videoData) return videoData;
        } catch { }
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

        // Fetch the TikTok page (follow redirects for short URLs)
        const res = await fetch(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',
            },
            redirect: 'follow',
        });

        if (!res.ok) {
            return jsonResponse(
                { error: 'Could not access TikTok. The video may be private or removed.' },
                502
            );
        }

        const html = await res.text();
        const videoData = extractVideoData(html);

        if (!videoData) {
            // Fallback: try oEmbed for basic info
            const oembedRes = await fetch(
                `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
            );
            if (oembedRes.ok) {
                const oembed = await oembedRes.json();
                return jsonResponse({
                    title: oembed.title || 'TikTok Video',
                    thumbnail: oembed.thumbnail_url || null,
                    duration: 0,
                    author: oembed.author_name || 'Unknown',
                    description: oembed.title || '',
                    downloadUrl: null, // no direct download from oembed
                });
            }
            return jsonResponse(
                { error: 'Could not extract video info. Try a different link.' },
                500
            );
        }

        // Extract download URL
        const video = videoData.video || {};
        const downloadUrl =
            video.downloadAddr ||
            video.playAddr ||
            video.play_addr?.url_list?.[0] ||
            null;

        return jsonResponse({
            title: videoData.desc || 'TikTok Video',
            thumbnail:
                video.cover || video.originCover || video.dynamicCover || null,
            duration: video.duration || 0,
            author: videoData.author?.uniqueId || videoData.author?.nickname || 'Unknown',
            description: videoData.desc ? videoData.desc.substring(0, 200) : '',
            downloadUrl,
        });
    } catch (err) {
        console.error('Info endpoint error:', err);
        return jsonResponse({ error: 'An unexpected error occurred.' }, 500);
    }
}
