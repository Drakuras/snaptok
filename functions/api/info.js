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

        const result = platform === 'youtube' ? await handleYouTube(url) : await handleTikTok(url);
        return jsonResponse(result);

    } catch (err) {
        return jsonResponse({ error: err.message || 'Failed to process video info.' }, 500);
    }
}
