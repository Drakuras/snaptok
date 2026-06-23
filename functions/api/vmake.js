// Cloudflare Pages Function: POST /api/vmake (submit job) | GET /api/vmake (poll status)
//
// Env vars required in Cloudflare Pages dashboard:
//   VMAKE_AK  → your Access Key  (MT_AK from VMake developer dashboard)
//   VMAKE_SK  → your Secret Key  (MT_SK from VMake developer dashboard)

const WAPI_HOST      = 'wapi-skill.vmake.ai';
const WAPI_MAIN_HOST = 'wapi.vmake.ai';
const USER_AGENT = 'action-web-skill-v1.3.0';
const TASK = 'videoscreenclear';
const DEFAULT_REGION = 'cn-north-4';

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ── HMAC-SHA256 signing — mirrors Python SDK signer.py exactly ────────────────

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret, message) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function nowTimestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Mutates `headers` — adds X-Sdk-Date and Authorization in place.
async function applySignature(ak, sk, url, method, headers, body) {
    const dt = nowTimestamp();
    headers['X-Sdk-Date'] = dt;

    const parsedUrl = new URL(url);
    const lowerMap = {};
    for (const [k, v] of Object.entries(headers)) lowerMap[k.toLowerCase()] = v.trim();

    const signedKeys = Object.keys(lowerMap).sort();
    const canonicalHeadersStr = signedKeys.map(k => `${k}:${lowerMap[k]}`).join('\n');
    const signedHeadersStr = signedKeys.join(';');

    const sortedQs = [...parsedUrl.searchParams.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const canonicalUri = parsedUrl.pathname.endsWith('/') ? parsedUrl.pathname : parsedUrl.pathname + '/';
    const bodyHash = await sha256Hex(body || '');

    const canonicalRequest = [method, canonicalUri, sortedQs, canonicalHeadersStr, signedHeadersStr, bodyHash].join('\n');
    const stringToSign = ['SDK-HMAC-SHA256', dt, await sha256Hex(canonicalRequest)].join('\n');
    const signature = await hmacSha256Hex(sk, stringToSign);

    const headerValue = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;
    headers['Authorization'] = 'Bearer ' + btoa(headerValue);
}

// WAPI calls — Host NOT in signed headers (matches WapiClient.request() in SDK)
async function wapiPost(ak, sk, path, body, host = WAPI_HOST) {
    const url = `https://${host}${path}`;
    const bodyStr = JSON.stringify(body);
    const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' };
    await applySignature(ak, sk, url, 'POST', headers, bodyStr);
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
    return res.json();
}

// AI API calls — Host IS in signed headers, Content-Type added AFTER signing (matches AiApi in SDK)
async function aiGet(ak, sk, url) {
    const parsedUrl = new URL(url);
    const headers = { 'Host': parsedUrl.host, 'User-Agent': USER_AGENT };
    await applySignature(ak, sk, url, 'GET', headers, '');
    const res = await fetch(url, { method: 'GET', headers });
    return res.json();
}

async function aiPost(ak, sk, url, body) {
    const parsedUrl = new URL(url);
    const bodyStr = JSON.stringify(body);
    const headers = { 'Host': parsedUrl.host, 'User-Agent': USER_AGENT };
    await applySignature(ak, sk, url, 'POST', headers, bodyStr);
    headers['Content-Type'] = 'application/json'; // added after signing, not in signature
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
    return res.json();
}

// ── API flow ──────────────────────────────────────────────────────────────────

async function getAiPolicy(ak, sk, gid) {
    const raw = await wapiPost(ak, sk, '/skill/config.json', { gid, version: 'v1.0.0' });
    if (raw.meta?.code !== 0) throw new Error(raw.meta?.msg || 'skill/config.json failed');
    const config = raw.response ?? {};
    const endpoint = config.algorithm?.regions?.[DEFAULT_REGION];
    if (!endpoint) throw new Error('No endpoint in skill config for region ' + DEFAULT_REGION);

    const tp = await aiGet(ak, sk, `https://${endpoint}/ai/token_policy?type=mtai`);
    const apiMap = tp?.data?.mtai?.api;
    const cloud = apiMap?.order?.[0];
    const policy = apiMap?.[cloud];
    if (!policy?.url) throw new Error('Could not resolve AI policy from token_policy');
    return policy;
}

function extractOutputUrls(body) {
    // Mirrors the official SDK _extract_output_urls exactly
    const result = body?.data?.result;
    if (!result || typeof result !== 'object') return [];

    const out = [];
    const seen = new Set();

    function addUrl(v) {
        if (typeof v === 'string' && v.startsWith('http') && !seen.has(v)) {
            seen.add(v); out.push(v);
        }
    }
    function addList(v) {
        if (Array.isArray(v)) v.forEach(addUrl); else addUrl(v);
    }
    function fromMil(items) {
        if (!Array.isArray(items)) return;
        items.forEach(it => { if (it && typeof it === 'object') addUrl(it.media_data); });
    }

    // 1. Top-level url fields
    addList(result.urls);
    addList(result.images);
    addList(result.videos);
    addUrl(result.url);

    // 2. result.media_info_list and result.data.media_info_list
    fromMil(result.media_info_list);
    const nestedData = result.data;
    if (nestedData && typeof nestedData === 'object') fromMil(nestedData.media_info_list);

    // 3. mtlab_res.media_info_list (SDK only checks this one field inside mtlab_res)
    const mtlab = result.mtlab_res;
    if (mtlab && typeof mtlab === 'object') fromMil(mtlab.media_info_list);

    return out;
}

async function submitJob(ak, sk, gid, videoUrl) {
    const policy = await getAiPolicy(ak, sk, gid);

    // consume.json registers the job for billing; may return a record_id for WAPI query polling
    let recordId = null;
    try {
        const consumeRaw = await wapiPost(ak, sk, '/skill/consume.json', { url: videoUrl, task: TASK, gid });
        const consume = consumeRaw?.response ?? consumeRaw ?? {};
        recordId = consume.record_id ?? consume.id ?? null;
    } catch {}


    const invokeUrl = `${policy.url}/${policy.push_path}`;
    const result = await aiPost(ak, sk, invokeUrl, {
        params: JSON.stringify({ parameter: { rsp_media_type: 'url', effect_model: 'video_remove_full', support_h_265: 1 } }),
        context: '',   // SDK always passes empty string; consume.json context causes GATEWAY_AUTHORIZED_ERROR
        task: TASK,
        task_type: 'mtlab',
        sync_timeout: policy.sync_timeout,
        init_images: [{ url: videoUrl }],
    });

    // If URLs are already in the response (rare sync completion), return immediately
    const urls = extractOutputUrls(result);
    if (urls.length) return { done: true, videoUrl: urls[0] };

    // Task submitted for async processing — grab the task ID (present in status 9 and status 2)
    const taskId = result.data?.result?.id ?? result.data?.task_id;
    if (taskId) {
        return {
            taskId: String(taskId).trim(),
            recordId: recordId ?? String(taskId).trim(),
            statusUrl: `${policy.url}/${policy.status_query.path}`,
        };
    }

    throw new Error(`VMake submit: no task ID or URLs. Response: ${JSON.stringify(result?.data ?? null).slice(0, 400)} consume_recordId=${recordId}`);
}

async function pollStatus(ak, sk, taskId, recordId, statusUrl) {
    // Try WAPI query.json first — this is what VMake's own frontend uses
    try {
        const wapi = await wapiPost(ak, sk, '/vm/tool/query.json', {
            record_id: [recordId],
            client_os: 'web',
        }, WAPI_MAIN_HOST);

        const item = wapi?.response?.list?.[0] ?? wapi?.data?.list?.[0] ?? wapi?.list?.[0];
        if (item) {
            const taskStatus = item.status ?? item.task_status;
            if (taskStatus === 'success' || taskStatus === 3 || taskStatus === 'done') {
                const url = item.result_url ?? item.video_url ?? item.url
                    ?? item.result?.url ?? item.result?.video_url;
                if (url) return { done: true, videoUrl: url };
                return { done: true, failed: true, error: 'WAPI query: no output URL in completed task' };
            }
            if (taskStatus === 'failed' || taskStatus === 4 || taskStatus === 'error') {
                return { done: true, failed: true, error: `VMake processing failed (WAPI status: ${taskStatus})` };
            }
            return { done: false, status: taskStatus, _debug: JSON.stringify(wapi).slice(0, 400) };
        }
        // WAPI returned but no list item — fall through to SDK status poll
    } catch {}

    // Fallback: SDK AI status endpoint
    const data = await aiGet(ak, sk, `${statusUrl}?task_id=${taskId}`);
    const status = data?.data?.status;
    if (status === 10 || status === 2 || status === 20) {
        const urls = extractOutputUrls(data);
        if (!urls.length) throw new Error(`VMake done but no URL. Poll: ${JSON.stringify(data).slice(0, 400)}`);
        return { done: true, videoUrl: urls[0] };
    }
    if (status === 3) return { done: true, failed: true, error: 'VMake processing failed' };
    return { done: false, status, _debug: JSON.stringify(data).slice(0, 400) };
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
    const ak  = context.env.VMAKE_AK;
    const sk  = context.env.VMAKE_SK;
    const gid = context.env.VMAKE_GID || ak;
    if (!ak || !sk) return json({ error: 'Set VMAKE_AK and VMAKE_SK in Cloudflare Pages env vars.' }, 500);

    try {
        const { videoUrl } = await context.request.json();
        if (!videoUrl) return json({ error: 'videoUrl is required' }, 400);

        return json(await submitJob(ak, sk, gid, videoUrl));
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

export async function onRequestGet(context) {
    const ak = context.env.VMAKE_AK;
    const sk = context.env.VMAKE_SK;
    if (!ak || !sk) return json({ error: 'Set VMAKE_AK and VMAKE_SK in Cloudflare Pages env vars.' }, 500);

    const params = new URL(context.request.url).searchParams;
    const taskId   = params.get('taskId');
    const recordId = params.get('recordId') ?? params.get('taskId');
    const statusUrl = params.get('statusUrl');
    if (!taskId || !statusUrl) return json({ error: 'taskId and statusUrl are required' }, 400);

    try {
        return json(await pollStatus(ak, sk, taskId, recordId, decodeURIComponent(statusUrl)));
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}
