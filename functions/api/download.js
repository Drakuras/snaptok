// Cloudflare Pages Function: GET /api/download
// Proxies video streams with platform-appropriate headers and Range support

const TIKTOK_UA = 'com.zhiliaoapp.musically/2022405040 (Linux; U; Android 12; en_US; Pixel 6 Build/SD1A.210817.036; Cronet/58.0.2991.0)';

function isTikTokCdnUrl(url) {
    try {
        const { hostname } = new URL(url);
        return /tiktok\.com$/.test(hostname) ||
            /tiktokcdn\.com$/.test(hostname) ||
            /tiktokv\.com$/.test(hostname) ||
            /snssdk\.com$/.test(hostname) ||
            /ibytedtos\.com$/.test(hostname);
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

async function fetchVideoWithRetry(videoUrl, fetchHeaders, rangeHeader, maxAttempts = 5) {
    const RETRY_DELAYS = [0, 2000, 4000, 8000, 15000];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        try {
            const headers = { ...fetchHeaders };
            if (rangeHeader) headers['Range'] = rangeHeader;
            const res = await fetch(videoUrl, { headers, redirect: 'follow' });
            if (res.ok || res.status === 206) return res;
            // 403 on TikTok CDN is permanent — don't retry
            if (res.status === 403) return res;
            // 404/503 on a freshly-processed VMake URL may just need a moment
            if (attempt === maxAttempts - 1) return res;
        } catch {
            if (attempt === maxAttempts - 1) throw new Error('Proxy fetch failed after retries');
        }
    }
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const videoUrl = url.searchParams.get('videoUrl');
    const title = url.searchParams.get('title') || 'video';

    if (!videoUrl) return jsonResponse({ error: 'Missing video URL.' }, 400);

    const rangeHeader = context.request.headers.get('Range');

    try {
        const fetchHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        if (isTikTokCdnUrl(videoUrl)) {
            fetchHeaders['User-Agent'] = TIKTOK_UA;
            fetchHeaders['Referer'] = 'https://www.tiktok.com/';
        }

        // Range requests: don't retry — byte-range responses must be exact
        const videoRes = rangeHeader
            ? await fetch(videoUrl, { headers: { ...fetchHeaders, Range: rangeHeader }, redirect: 'follow' })
            : await fetchVideoWithRetry(videoUrl, fetchHeaders, null);

        if (videoRes.status === 403 && isTikTokCdnUrl(videoUrl)) {
            return Response.redirect(videoUrl, 302);
        }

        if (!videoRes.ok && videoRes.status !== 206) {
            return jsonResponse({ error: `Upstream server returned ${videoRes.status}` }, 502);
        }

        const safeTitle = title.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'video/mp4');
        responseHeaders.set('Content-Disposition', `attachment; filename="${safeTitle || 'video'}.mp4"`);

        ['Content-Range', 'Accept-Ranges', 'Content-Length'].forEach(h => {
            const val = videoRes.headers.get(h);
            if (val) responseHeaders.set(h, val);
        });

        return new Response(videoRes.body, { status: videoRes.status, headers: responseHeaders });

    } catch {
        return jsonResponse({ error: 'Proxy error.' }, 500);
    }
}
