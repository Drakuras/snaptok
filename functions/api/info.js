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

async function handleTikTok(url) {
    const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!res.ok) throw new Error('API bridge unavailable. Try again later.');

    const data = await res.json();
    if (data.code !== 0 || !data.data) throw new Error(data.msg || 'Could not find video data.');

    const v = data.data;
    return {
        platform: 'tiktok',
        title: v.title || 'TikTok Video',
        thumbnail: v.cover || null,
        duration: v.duration || 0,
        author: v.author?.unique_id || v.author?.nickname || 'Unknown',
        downloadUrl: v.play || v.wmplay || v.hdplay || null
    };
}

async function handleYouTube(url) {
    const [metaRes, cobaltRes] = await Promise.all([
        fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`),
        fetch('https://api.cobalt.tools/', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                videoQuality: '720',
                youtubeVideoCodec: 'h264',
                filenameStyle: 'basic'
            })
        })
    ]);

    if (!metaRes.ok) throw new Error('Could not fetch YouTube video info. The video may be private or unavailable.');

    const meta = await metaRes.json();
    const cobalt = await cobaltRes.json();

    let downloadUrl = null;
    if (cobalt.status === 'stream' || cobalt.status === 'tunnel' || cobalt.status === 'redirect') {
        downloadUrl = cobalt.url;
    } else if (cobalt.status === 'picker' && cobalt.picker?.length) {
        // Pick the first video stream from the picker (avoid audio-only entries)
        const videoItem = cobalt.picker.find(p => p.type === 'video') || cobalt.picker[0];
        downloadUrl = videoItem?.url || null;
    }

    if (!downloadUrl) {
        const reason = cobalt.error?.code || 'unknown';
        throw new Error(`Could not get download link (${reason}). The video may be age-restricted, private, or unavailable.`);
    }

    return {
        platform: 'youtube',
        title: meta.title || 'YouTube Video',
        thumbnail: meta.thumbnail_url || null,
        duration: 0,
        author: meta.author_name || 'Unknown',
        downloadUrl
    };
}

export async function onRequestPost(context) {
    try {
        const { url } = await context.request.json();
        if (!url) return jsonResponse({ error: 'URL is required' }, 400);

        const platform = detectPlatform(url);
        if (!platform) return jsonResponse({ error: 'Please provide a valid TikTok or YouTube URL.' }, 400);

        const result = platform === 'youtube' ? await handleYouTube(url) : await handleTikTok(url);
        return jsonResponse(result);

    } catch (err) {
        return jsonResponse({ error: err.message || 'Failed to process video info.' }, 500);
    }
}
