// Cloudflare Pages Function: GET /api/download
// Proxies the TikTok video stream to the user

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

    try {
        // Proxy the video stream with TikTok referer so it's not blocked
        const videoRes = await fetch(videoUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/',
                'Accept-Encoding': 'identity',
            },
        });

        if (!videoRes.ok) {
            // If direct proxy fails, it might be due to an expired token or restricted IP
            return jsonResponse({ error: 'Failed to stream the video. It may be restricted.' }, 502);
        }

        // Build a safe filename
        const safeTitle = title
            .substring(0, 60)
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const filename = `${safeTitle || 'tiktok_video'}.mp4`;

        // Return the stream with proper headers for download
        return new Response(videoRes.body, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        console.error('Download endpoint error:', err);
        return jsonResponse({ error: 'An unexpected error occurred.' }, 500);
    }
}
