// Cloudflare Pages Function: GET /api/download
// Proxies the TikTok video stream to the user

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

function extractVideoData(html) {
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

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const tiktokUrl = url.searchParams.get('url');

    if (!tiktokUrl || !isValidTikTokUrl(tiktokUrl)) {
        return jsonResponse({ error: 'Please provide a valid TikTok URL.' }, 400);
    }

    try {
        // Fetch TikTok page to get the video download URL
        const pageRes = await fetch(tiktokUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',
            },
            redirect: 'follow',
        });

        if (!pageRes.ok) {
            return jsonResponse({ error: 'Could not access TikTok video.' }, 502);
        }

        const html = await pageRes.text();
        const videoData = extractVideoData(html);

        if (!videoData) {
            return jsonResponse(
                { error: 'Could not extract video. Try a different link.' },
                500
            );
        }

        const video = videoData.video || {};
        const downloadUrl =
            video.downloadAddr ||
            video.playAddr ||
            video.play_addr?.url_list?.[0] ||
            null;

        if (!downloadUrl) {
            return jsonResponse(
                { error: 'Could not find a downloadable video URL.' },
                500
            );
        }

        // Proxy the video stream with TikTok referer so it's not blocked
        const videoRes = await fetch(downloadUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Referer: 'https://www.tiktok.com/',
                'Accept-Encoding': 'identity',
            },
        });

        if (!videoRes.ok) {
            return jsonResponse({ error: 'Failed to download the video.' }, 502);
        }

        // Build a safe filename
        const title = (videoData.desc || 'tiktok_video')
            .substring(0, 60)
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const filename = `${title || 'tiktok_video'}.mp4`;

        return new Response(videoRes.body, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        console.error('Download endpoint error:', err);
        return jsonResponse({ error: 'An unexpected error occurred.' }, 500);
    }
}
