// SnapTok — Frontend Logic
(function () {
    'use strict';

    // ── Single mode refs ────────────────────────────────────────────────────────
    const form        = document.getElementById('downloadForm');
    const urlInput    = document.getElementById('urlInput');
    const pasteBtn    = document.getElementById('pasteBtn');
    const submitBtn   = document.getElementById('submitBtn');
    const btnText     = submitBtn.querySelector('.btn-text');
    const btnLoader   = submitBtn.querySelector('.btn-loader');
    const errorMsg    = document.getElementById('errorMsg');
    const preview     = document.getElementById('preview');
    const previewThumb    = document.getElementById('previewThumb');
    const previewTitle    = document.getElementById('previewTitle');
    const previewAuthor   = document.getElementById('previewAuthor');
    const previewDuration = document.getElementById('previewDuration');
    const downloadBtn = document.getElementById('downloadBtn');
    let currentVideo  = null;

    // ── Bulk mode refs ──────────────────────────────────────────────────────────
    const bulkUrlInput  = document.getElementById('bulkUrlInput');
    const bulkFetchBtn  = document.getElementById('bulkFetchBtn');
    const bulkResults   = document.getElementById('bulkResults');
    const bulkErrorMsg  = document.getElementById('bulkErrorMsg');
    const selectAllWm    = document.getElementById('selectAllWm');
    const retryFailedBtn = document.getElementById('retryFailedBtn');
    const processAllBtn  = document.getElementById('processAllBtn');
    const downloadAllBtn = document.getElementById('downloadAllBtn');
    const videoGrid      = document.getElementById('videoGrid');

    // ── Mode tab refs ───────────────────────────────────────────────────────────
    const modeTabs  = document.querySelectorAll('.mode-tab');
    const singleMode = document.getElementById('singleMode');
    const bulkMode   = document.getElementById('bulkMode');

    // ── Modal refs ──────────────────────────────────────────────────────────────
    const previewModal    = document.getElementById('previewModal');
    const modalVideo      = document.getElementById('modalVideo');
    const modalClose      = document.getElementById('modalClose');
    const modalDownloadBtn = document.getElementById('modalDownloadBtn');
    let modalActiveUrl = null;
    let modalActiveTitle = '';

    // ── Bulk state ──────────────────────────────────────────────────────────────
    // Each entry: { url, info, downloadUrl, processedUrl, status, taskId, statusUrl, wm }
    // status: 'fetching' | 'ready' | 'processing' | 'done' | 'error'
    const bulkVideos = [];

    // ════════════════════════════════════════════════════════════════════════════
    // Mode switching
    // ════════════════════════════════════════════════════════════════════════════

    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
            singleMode.hidden = mode !== 'single';
            bulkMode.hidden   = mode !== 'bulk';
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Single mode
    // ════════════════════════════════════════════════════════════════════════════

    pasteBtn.addEventListener('click', async () => {
        try {
            urlInput.value = await navigator.clipboard.readText();
            urlInput.focus();
        } catch { urlInput.focus(); }
    });

    urlInput.addEventListener('paste', () => {
        setTimeout(() => {
            const val = urlInput.value.trim();
            if (isTikTokUrl(val) || isYouTubeUrl(val)) form.requestSubmit();
        }, 100);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;
        if (!isTikTokUrl(url) && !isYouTubeUrl(url)) {
            showError('Please enter a valid TikTok or YouTube URL.');
            return;
        }
        hideError(); hidePreview(); setLoading(true);
        try {
            const res  = await fetch('/api/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Something went wrong.');
            currentVideo = { url, downloadUrl: data.downloadUrl, title: data.title, platform: data.platform };
            showPreview(data);
        } catch (err) {
            showError(err.message || 'Failed to fetch video info. Please try again.');
        } finally {
            setLoading(false);
        }
    });

    downloadBtn.addEventListener('click', () => triggerDownload(currentVideo?.downloadUrl, currentVideo?.title));

    // ════════════════════════════════════════════════════════════════════════════
    // Bulk mode — fetch
    // ════════════════════════════════════════════════════════════════════════════

    bulkFetchBtn.addEventListener('click', bulkFetch);

    async function bulkFetch() {
        const raw   = bulkUrlInput.value.trim();
        const urls  = raw.split('\n').map(l => l.trim()).filter(l => l && isTikTokUrl(l));
        if (!urls.length) {
            showBulkError('No valid TikTok URLs found. Paste one per line.');
            return;
        }

        hideBulkError();
        bulkVideos.length = 0;
        videoGrid.innerHTML = '';
        bulkResults.hidden = false;
        downloadAllBtn.hidden = true;
        setBulkFetchLoading(true);

        // Add skeleton cards while fetching
        urls.forEach((url, i) => {
            bulkVideos.push({ url, info: null, downloadUrl: null, processedUrl: null, status: 'fetching', wm: false });
            videoGrid.appendChild(buildCard(i));
        });

        // Stagger fetches 1s apart to avoid TikTok rate-limiting the datacenter IP
        await Promise.all(urls.map((url, i) =>
            delay(i * 1000).then(() => fetchVideoInfo(url, i))
        ));
        setBulkFetchLoading(false);
        syncSelectAll();
        updateRetryBtn();
    }

    async function fetchVideoInfo(url, index, attempt = 0) {
        const RETRY_DELAYS = [0, 3000, 6000];
        const MAX_ATTEMPTS = RETRY_DELAYS.length;
        try {
            const res  = await fetch('/api/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');
            bulkVideos[index].info = data;
            bulkVideos[index].downloadUrl = data.downloadUrl;
            bulkVideos[index].status = 'ready';
            refreshCard(index);
        } catch (err) {
            if (attempt < MAX_ATTEMPTS - 1) {
                bulkVideos[index].errorMsg = `Retrying… (${attempt + 1}/${MAX_ATTEMPTS - 1})`;
                bulkVideos[index].status = 'error';
                refreshCard(index);
                await delay(RETRY_DELAYS[attempt + 1]);
                return fetchVideoInfo(url, index, attempt + 1);
            }
            bulkVideos[index].status = 'error';
            bulkVideos[index].errorMsg = err.message;
            refreshCard(index);
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Bulk mode — select all watermark toggle
    // ════════════════════════════════════════════════════════════════════════════

    selectAllWm.addEventListener('change', () => {
        const toProcess = [];
        bulkVideos.forEach((v, i) => {
            if (v.status === 'ready' || v.status === 'done') {
                v.wm = selectAllWm.checked;
                const el = videoGrid.children[i];
                if (el) {
                    const cb = el.querySelector('.wm-checkbox');
                    if (cb) cb.checked = v.wm;
                    el.classList.toggle('wm-enabled', v.wm);
                }
                if (v.wm && v.status === 'ready') toProcess.push(i);
            }
        });
        toProcess.forEach(i => processWithVmake(i));
    });

    function syncSelectAll() {
        const eligible = bulkVideos.filter(v => v.status === 'ready' || v.status === 'done');
        selectAllWm.checked = eligible.length > 0 && eligible.every(v => v.wm);
    }

    function checkBulkComplete() {
        const allSettled = bulkVideos.length > 0 && bulkVideos.every(
            v => v.status === 'done' || v.status === 'error' || (v.status === 'ready' && !v.wm)
        );
        if (allSettled) downloadAllBtn.hidden = false;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Bulk mode — process
    // ════════════════════════════════════════════════════════════════════════════

    retryFailedBtn.addEventListener('click', async () => {
        const failed = bulkVideos
            .map((v, i) => ({ v, i }))
            .filter(({ v }) => v.status === 'error' && !v.downloadUrl);
        if (!failed.length) return;
        retryFailedBtn.disabled = true;
        await Promise.all(failed.map(({ v, i }, si) =>
            delay(si * 1000).then(() => {
                v.status = 'fetching';
                v.errorMsg = '';
                refreshCard(i);
                return fetchVideoInfo(v.url, i);
            })
        ));
        retryFailedBtn.disabled = false;
        syncSelectAll();
        updateRetryBtn();
    });

    function updateRetryBtn() {
        retryFailedBtn.hidden = !bulkVideos.some(v => v.status === 'error' && !v.downloadUrl);
    }

    processAllBtn.addEventListener('click', processAll);

    async function processAll() {
        const readyVideos = bulkVideos.filter(v => v.status === 'ready');
        if (!readyVideos.length) return;

        processAllBtn.disabled = true;
        downloadAllBtn.hidden = true;

        await Promise.all(bulkVideos.map((v, i) => {
            if (v.status !== 'ready') return Promise.resolve();
            if (v.wm) return processWithVmake(i);
            v.status = 'done';
            refreshCard(i);
            return Promise.resolve();
        }));

        processAllBtn.disabled = false;
        checkBulkComplete();
    }

    async function processWithVmake(index) {
        const v = bulkVideos[index];
        v.status = 'processing';
        refreshCard(index);

        try {
            // Submit job
            const submitRes = await fetch('/api/vmake', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl: v.downloadUrl }),
            });
            const submitData = await submitRes.json();
            if (!submitRes.ok || submitData.error) throw new Error(submitData.error || 'Submit failed');

            if (submitData.done) {
                v.processedUrl = submitData.videoUrl;
                v.status = 'done';
                refreshCard(index);
                return;
            }

            v.taskId    = submitData.taskId;
            v.statusUrl = submitData.statusUrl;
            refreshCard(index);

            // Poll
            await pollVmake(index);
        } catch (err) {
            v.status = 'error';
            v.errorMsg = err.message;
            refreshCard(index);
        }
        checkBulkComplete();
    }

    async function pollVmake(index) {
        const v = bulkVideos[index];
        // Adaptive intervals: every 5s for first 2min, 10s up to 10min, 20s up to 30min
        function pollInterval(attempt) {
            if (attempt < 24) return 5000;
            if (attempt < 78) return 10000;
            return 20000;
        }
        for (let i = 0; ; i++) {
            await delay(pollInterval(i));
            try {
                const res  = await fetch(`/api/vmake?taskId=${encodeURIComponent(v.taskId)}&statusUrl=${encodeURIComponent(v.statusUrl)}`);
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                if (data.done) {
                    if (data.failed) throw new Error(data.error || 'VMake processing failed');
                    v.processedUrl = data.videoUrl;
                    v.status = 'done';
                    refreshCard(index);
                    return;
                }
                // Update status text to show elapsed attempts
                if (i > 0 && i % 6 === 0) refreshCard(index);
            } catch (err) {
                v.status = 'error';
                v.errorMsg = err.message;
                refreshCard(index);
                return;
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Bulk mode — download all
    // ════════════════════════════════════════════════════════════════════════════

    downloadAllBtn.addEventListener('click', () => {
        bulkVideos.forEach((v, i) => {
            const canDl = v.status === 'done' || (v.status === 'ready' && !v.wm);
            if (!canDl) return;
            const finalUrl = v.processedUrl || v.downloadUrl;
            if (!finalUrl) return;
            const title = v.info?.title || `video_${i + 1}`;
            setTimeout(() => triggerDownload(finalUrl, title), i * 600);
        });
    });

    // ════════════════════════════════════════════════════════════════════════════
    // Card rendering
    // ════════════════════════════════════════════════════════════════════════════

    function buildCard(index) {
        const el = document.createElement('div');
        el.className = 'video-card';
        el.dataset.index = index;
        renderCardContent(el, index);
        return el;
    }

    function refreshCard(index) {
        const el = videoGrid.children[index];
        if (el) renderCardContent(el, index);
    }

    function renderCardContent(el, index) {
        const v = bulkVideos[index];
        el.classList.toggle('wm-enabled', !!v.wm);

        const thumb    = v.info?.thumbnail;
        const title    = v.info?.title || v.url;
        const author   = v.info?.author ? `@${v.info.author}` : '';
        const duration = v.info?.duration ? formatDuration(v.info.duration) : '';
        const meta     = [author, duration].filter(Boolean).join(' · ');

        const statusHtml = buildStatusHtml(v);
        const thumbHtml  = thumb
            ? `<img class="card-thumb" src="${escHtml(thumb)}" alt="" loading="lazy">`
            : `<div class="card-thumb-placeholder">🎵</div>`;

        const isDone    = v.status === 'done';
        const isReady   = v.status === 'ready';
        const canDownload = isDone || (isReady && !v.wm);
        const finalUrl  = v.processedUrl || v.downloadUrl || '';
        const previewUrl = v.processedUrl
            ? v.processedUrl
            : (v.downloadUrl ? `/api/download?videoUrl=${encodeURIComponent(v.downloadUrl)}&title=${encodeURIComponent(v.info?.title || '')}` : '');

        const canInteract = isReady || isDone;

        el.innerHTML = `
            ${thumbHtml}
            <div class="card-info">
                <div class="card-title">${escHtml(title)}</div>
                ${meta ? `<div class="card-meta">${escHtml(meta)}</div>` : ''}
                <div class="card-status">${statusHtml}</div>
            </div>
            <div class="card-side">
                <label class="wm-toggle-wrap" title="Remove TikTok watermark using VMake AI">
                    <span class="wm-toggle-label">Remove WM</span>
                    <div class="toggle-switch">
                        <input type="checkbox" class="wm-checkbox" ${v.wm ? 'checked' : ''} ${!canInteract ? 'disabled' : ''}>
                        <div class="toggle-track"><div class="toggle-thumb"></div></div>
                    </div>
                </label>
                <div class="card-btn-group">
                    <button class="card-btn card-btn-preview" ${!canDownload ? 'disabled' : ''} data-preview="${escHtml(previewUrl)}" data-title="${escHtml(v.info?.title || '')}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        Preview
                    </button>
                    <button class="card-btn card-btn-download" ${!canDownload ? 'disabled' : ''} data-url="${escHtml(finalUrl)}" data-title="${escHtml(v.info?.title || `video_${index + 1}`)}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download
                    </button>
                </div>
            </div>`;

        // Watermark toggle
        const cb = el.querySelector('.wm-checkbox');
        if (cb) {
            cb.addEventListener('change', () => {
                v.wm = cb.checked;
                el.classList.toggle('wm-enabled', v.wm);
                syncSelectAll();
                if (v.wm && v.status === 'ready') processWithVmake(index);
                else if (!v.wm) refreshCard(index); // re-enable download button immediately
            });
        }

        // Preview button
        const previewBtn = el.querySelector('.card-btn-preview');
        if (previewBtn && !previewBtn.disabled) {
            previewBtn.addEventListener('click', () => openModal(previewBtn.dataset.preview, previewBtn.dataset.title));
        }

        // Download button
        const dlBtn = el.querySelector('.card-btn-download');
        if (dlBtn && !dlBtn.disabled) {
            dlBtn.addEventListener('click', () => triggerDownload(dlBtn.dataset.url, dlBtn.dataset.title));
        }
    }

    function buildStatusHtml(v) {
        const spinner = `<span class="spinner" style="width:12px;height:12px;border-width:1.5px"></span>`;
        switch (v.status) {
            case 'fetching':   return `${spinner} <span class="status-waiting">Fetching…</span>`;
            case 'ready':      return `<span class="status-ready">●</span> <span class="status-ready">Ready</span>`;
            case 'processing': return `${spinner} <span class="status-process">Removing watermark…</span>`;
            case 'done':
                return v.processedUrl
                    ? `<span class="status-done">✓</span> <span class="status-done">Watermark removed</span>`
                    : `<span class="status-done">✓</span> <span class="status-done">Ready to download</span>`;
            case 'error':      return `<span class="status-error">✗ ${escHtml(v.errorMsg || 'Error')}</span>`;
            default:           return '';
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Preview modal
    // ════════════════════════════════════════════════════════════════════════════

    function openModal(videoUrl, title) {
        modalActiveUrl   = videoUrl;
        modalActiveTitle = title || 'video';
        modalVideo.src   = videoUrl;
        previewModal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        previewModal.hidden = true;
        modalVideo.pause();
        modalVideo.src = '';
        document.body.style.overflow = '';
    }

    modalClose.addEventListener('click', closeModal);
    previewModal.addEventListener('click', e => { if (e.target === previewModal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !previewModal.hidden) closeModal(); });
    modalDownloadBtn.addEventListener('click', () => triggerDownload(modalActiveUrl, modalActiveTitle));

    // ════════════════════════════════════════════════════════════════════════════
    // Download helper
    // ════════════════════════════════════════════════════════════════════════════

    async function triggerDownload(url, title) {
        if (!url) return;
        const proxyUrl = url.startsWith('/api/') || url.startsWith('http')
            ? `/api/download?videoUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(title || 'video')}`
            : url;

        try {
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = sanitizeFilename(title || 'video') + '.mp4';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            } else {
                window.open(url, '_blank');
            }
        } catch {
            window.open(url, '_blank');
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Single-mode helpers (unchanged)
    // ════════════════════════════════════════════════════════════════════════════

    function setLoading(loading) {
        submitBtn.disabled = loading;
        btnText.hidden  = loading;
        btnLoader.hidden = !loading;
    }

    function setBulkFetchLoading(loading) {
        bulkFetchBtn.disabled = loading;
        bulkFetchBtn.querySelector('.btn-text').hidden  = loading;
        bulkFetchBtn.querySelector('.btn-loader').hidden = !loading;
    }

    function showError(msg)  { errorMsg.textContent = msg; errorMsg.hidden = false; }
    function hideError()     { errorMsg.hidden = true; }
    function hidePreview()   { preview.hidden = true; }
    function showBulkError(msg) { bulkErrorMsg.textContent = msg; bulkErrorMsg.hidden = false; }
    function hideBulkError()    { bulkErrorMsg.hidden = true; }

    function showPreview(data) {
        previewTitle.textContent   = data.title || 'Video';
        previewAuthor.textContent  = data.platform === 'youtube'
            ? (data.author || '')
            : (data.author ? `@${data.author}` : '');
        previewDuration.textContent = data.duration ? formatDuration(data.duration) : '';
        if (data.thumbnail) { previewThumb.src = data.thumbnail; previewThumb.style.display = ''; }
        else { previewThumb.style.display = 'none'; }
        preview.hidden = false;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // URL detection
    // ════════════════════════════════════════════════════════════════════════════

    function isTikTokUrl(url) {
        try { return /tiktok\.com$/i.test(new URL(url).hostname) || /\.tiktok\.com$/i.test(new URL(url).hostname); }
        catch { return false; }
    }

    function isYouTubeUrl(url) {
        try { const h = new URL(url).hostname; return /youtube\.com$/i.test(h) || /youtu\.be$/i.test(h); }
        catch { return false; }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Utils
    // ════════════════════════════════════════════════════════════════════════════

    function formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function sanitizeFilename(name) {
        return name.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '_');
    }

    function escHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

})();
