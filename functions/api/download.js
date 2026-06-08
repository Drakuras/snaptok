// Cloudflare Pages Function: GET /api/download
// Proxies the TikTok video stream to the user with Range support

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const videoUrl = url.searchParams.get('videoUrl');
    const title = url.searchParams.get('title') || 'tiktok_video';

    if (!videoUrl) {
        return jsonResponse({ error: 'Please provide a video URL.' }, 400);
    }

    // Capture the Range header from the user's browser
    const rangeHeader = context.request.headers.get('Range');

    try {
        const fetchHeaders = {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
            'Accept-Encoding': 'identity',
        };

        // Forward the Range header if it exists
        if (rangeHeader) {
            fetchHeaders['Range'] = rangeHeader;
        }

        const videoRes = await fetch(videoUrl, {
            headers: fetchHeaders,
            redirect: 'follow'
        });

        if (!videoRes.ok && videoRes.status !== 206) {
            return jsonResponse({ error: 'Failed to stream the video from TikTok.' }, 502);
        }

        const safeTitle = title
            .substring(0, 60)
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const filename = `${safeTitle || 'tiktok_video'}.mp4`;

        // Set up response headers, forwarding important ones from TikTok
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'video/mp4');
        responseHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
        responseHeaders.set('Cache-Control', 'no-store');
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        // Forward range-related headers back to the browser
        const rangeHeaders = ['Content-Range', 'Accept-Ranges', 'Content-Length'];
        rangeHeaders.forEach(h => {
            const val = videoRes.headers.get(h);
            if (val) responseHeaders.set(h, val);
        });

        return new Response(videoRes.body, {
            status: videoRes.status,
            headers: responseHeaders,
        });
    } catch (err) {
        console.error('Download endpoint error:', err);
        return jsonResponse({ error: 'An unexpected error occurred.' }, 500);
    }
}
