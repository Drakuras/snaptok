// Cloudflare Pages Function: POST /api/vmake (submit job) | GET /api/vmake (poll status)
//
// Env vars required in Cloudflare Pages dashboard:
//   VMAKE_AK  → your Access Key  (MT_AK from VMake developer dashboard)
//   VMAKE_SK  → your Secret Key  (MT_SK from VMake developer dashboard)

const WAPI_HOST = 'wapi-skill.vmake.ai';
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
async function wapiPost(ak, sk, path, body) {
    const url = `https://${WAPI_HOST}${path}`;
    const bodyStr = JSON.stringify(body);
    const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' };
    await applySignature(ak, sk, url, 'POST', headers, bodyStr);
    const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
    const data = await res.json();
    if (data.meta?.code !== 0) throw new Error(data.meta?.msg || `WAPI error on ${path}`);
    return data.response ?? {};
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

async function getAiPolicy(ak, sk) {
    const config = await wapiPost(ak, sk, '/skill/config.json', { gid: '', version: 'v1.0.0' });
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
    const result = body?.data?.result;
    if (!result || typeof result !== 'object') return [];
    const out = [];
    const seen = new Set();
    function add(v) {
        if (typeof v === 'string' && v.startsWith('http') && !seen.has(v)) {
            seen.add(v); out.push(v);
        }
    }
    for (const k of ['urls', 'images', 'videos']) {
        const val = result[k];
        if (Array.isArray(val)) val.forEach(add); else add(val);
    }
    add(result.url);
    const mil = result.media_info_list ?? result.data?.media_info_list;
    if (Array.isArray(mil)) mil.forEach(item => add(item?.media_data));
    return out;
}

async function submitJob(ak, sk, videoUrl) {
    const policy = await getAiPolicy(ak, sk);

    const consume = await wapiPost(ak, sk, '/skill/consume.json', {
        url: videoUrl, task: TASK, gid: '',
    });
    const context = consume?.context ?? '';

    const invokeUrl = `${policy.url}/${policy.push_path}`;
    const result = await aiPost(ak, sk, invokeUrl, {
        params: JSON.stringify({ parameter: { rsp_media_type: 'url' } }),
        context,
        task: TASK,
        task_type: 'mtlab',
        sync_timeout: policy.sync_timeout,
        init_images: [{ url: videoUrl }],
    });

    if (result.data?.status === 9) {
        return {
            taskId: String(result.data.result.id).trim(),
            statusUrl: `${policy.url}/${policy.status_query.path}`,
        };
    }
    // Rare sync result
    const urls = extractOutputUrls(result);
    return { done: true, videoUrl: urls[0] ?? null };
}

async function pollStatus(ak, sk, taskId, statusUrl) {
    const data = await aiGet(ak, sk, `${statusUrl}?task_id=${taskId}`);
    const status = data?.data?.status;
    if (status === 10 || status === 2 || status === 20) {
        const urls = extractOutputUrls(data);
        return { done: true, videoUrl: urls[0] ?? null };
    }
    if (status === 3) return { done: true, failed: true, error: 'VMake processing failed' };
    return { done: false, status };
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
    const ak = context.env.VMAKE_AK;
    const sk = context.env.VMAKE_SK;
    if (!ak || !sk) return json({ error: 'Set VMAKE_AK and VMAKE_SK in Cloudflare Pages env vars.' }, 500);

    try {
        const { videoUrl } = await context.request.json();
        if (!videoUrl) return json({ error: 'videoUrl is required' }, 400);
        return json(await submitJob(ak, sk, videoUrl));
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

export async function onRequestGet(context) {
    const ak = context.env.VMAKE_AK;
    const sk = context.env.VMAKE_SK;
    if (!ak || !sk) return json({ error: 'Set VMAKE_AK and VMAKE_SK in Cloudflare Pages env vars.' }, 500);

    const params = new URL(context.request.url).searchParams;
    const taskId = params.get('taskId');
    const statusUrl = params.get('statusUrl');
    if (!taskId || !statusUrl) return json({ error: 'taskId and statusUrl are required' }, 400);

    try {
        return json(await pollStatus(ak, sk, taskId, decodeURIComponent(statusUrl)));
    } catch (err) {
        return json({ error: err.message }, 500);
    }
}
