// SnapTok — Frontend Logic
(function () {
    'use strict';

    const form = document.getElementById('downloadForm');
    const urlInput = document.getElementById('urlInput');
    const pasteBtn = document.getElementById('pasteBtn');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    const errorMsg = document.getElementById('errorMsg');
    const preview = document.getElementById('preview');
    const previewThumb = document.getElementById('previewThumb');
    const previewTitle = document.getElementById('previewTitle');
    const previewAuthor = document.getElementById('previewAuthor');
    const previewDuration = document.getElementById('previewDuration');
    const downloadBtn = document.getElementById('downloadBtn');

    let currentVideo = null;

    // --- Paste button ---
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            urlInput.value = text;
            urlInput.focus();
        } catch {
            urlInput.focus();
        }
    });

    // --- Auto-detect paste ---
    urlInput.addEventListener('paste', () => {
        setTimeout(() => {
            if (isTikTokUrl(urlInput.value.trim())) {
                form.requestSubmit();
            }
        }, 100);
    });

    // --- Form submit ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();

        if (!url) return;

        if (!isTikTokUrl(url)) {
            showError('Please enter a valid TikTok URL.');
            return;
        }

        hideError();
        hidePreview();
        setLoading(true);

        try {
            const res = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Something went wrong.');
            }

            currentVideo = {
                url: url,
                downloadUrl: data.downloadUrl,
                title: data.title
            };
            showPreview(data);
        } catch (err) {
            showError(err.message || 'Failed to fetch video info. Please try again.');
        } finally {
            setLoading(false);
        }
    });

    // --- Download button ---
    downloadBtn.addEventListener('click', async () => {
        if (!currentVideo?.downloadUrl) {
            showError('No download link available for this video.');
            return;
        }

        const originalText = downloadBtn.innerHTML;
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<span class="spinner"></span> Downloading...';

        const proxyUrl = `/api/download?videoUrl=${encodeURIComponent(currentVideo.downloadUrl)}&title=${encodeURIComponent(currentVideo.title)}`;

        try {
            // Try fetching through proxy first
            const res = await fetch(proxyUrl);

            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                const safeTitle = currentVideo.title.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
                a.href = url;
                a.download = `${safeTitle || 'video'}.mp4`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                // Fallback: If proxy fails, try direct download in new tab
                window.open(currentVideo.downloadUrl, '_blank');
            }
        } catch (err) {
            // Fallback for any fetch error
            window.open(currentVideo.downloadUrl, '_blank');
        } finally {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalText;
        }
    });

    // --- Helpers ---
    function isTikTokUrl(url) {
        try {
            const parsed = new URL(url);
            return /tiktok\.com$/i.test(parsed.hostname) ||
                /\.tiktok\.com$/i.test(parsed.hostname);
        } catch {
            return false;
        }
    }

    function setLoading(loading) {
        submitBtn.disabled = loading;
        btnText.hidden = loading;
        btnLoader.hidden = !loading;
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.hidden = false;
    }

    function hideError() {
        errorMsg.hidden = true;
    }

    function showPreview(data) {
        previewTitle.textContent = data.title || 'TikTok Video';
        previewAuthor.textContent = data.author ? `@${data.author}` : '';
        previewDuration.textContent = data.duration
            ? formatDuration(data.duration)
            : '';

        if (data.thumbnail) {
            previewThumb.src = data.thumbnail;
            previewThumb.style.display = '';
        } else {
            previewThumb.style.display = 'none';
        }

        preview.hidden = false;
    }

    function hidePreview() {
        preview.hidden = true;
    }

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
})();
