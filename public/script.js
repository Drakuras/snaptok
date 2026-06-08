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

    let currentUrl = '';

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

            currentUrl = url;
            showPreview(data);
        } catch (err) {
            showError(err.message || 'Failed to fetch video info. Please try again.');
        } finally {
            setLoading(false);
        }
    });

    // --- Download button ---
    downloadBtn.addEventListener('click', () => {
        if (!currentUrl) return;

        // Use the proxy download endpoint
        const downloadUrl = `/api/download?url=${encodeURIComponent(currentUrl)}`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.setAttribute('download', '');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
