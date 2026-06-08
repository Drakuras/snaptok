// Cloudflare Pages Function: POST /api/info
// Uses a stable API bridge to guarantee video extraction and bypass CDN blocks

export async function onRequestPost(context) {
    try {
        const { url } = await context.request.json();

        if (!url) {
            return new Response(JSON.stringify({ error: 'URL is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // TikWM is a public, free-to-use API bridge for TikTok downloading
        // It's the industry standard for stable, watermark-free links
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;

        const res = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ error: 'API bridge unavailable. Try again later.' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await res.json();

        if (data.code !== 0 || !data.data) {
            return new Response(JSON.stringify({ error: data.msg || 'Could not find video data.' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const videoData = data.data;

        // Return a clean, stable object to the frontend
        return new Response(JSON.stringify({
            title: videoData.title || 'TikTok Video',
            thumbnail: videoData.cover || null,
            duration: videoData.duration || 0,
            author: videoData.author?.unique_id || videoData.author?.nickname || 'Unknown',
            // Prefer the "No Watermark" link
            downloadUrl: videoData.play || videoData.wmplay || videoData.hdplay || null
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to process video info.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
