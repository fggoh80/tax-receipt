/* 税务收据小助手 — 纯前端 PWA
 * 手机拍照 → Gemini 读收据并按 LHDN 减免项目归类 → 存进自己的 Google Drive + Google Sheets 总账
 * 没有后端服务器：API Key 和登录凭证只在本机浏览器。
 */
'use strict';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const LEDGER_NAME = '收据总账 Ledger';
const HEADER = ['上传时间', '收据日期', '商家', '金额(RM)', '分类代码', '分类名称', '家人', '内容/备注',
  '文件', '文件ID', 'AI信心', '文件指纹', 'AI建议分类', '报税人'];
const DEFAULTS = {
  clientId: '', geminiKey: '', model: 'gemini-flash-latest',
  payers: ['我', '老婆'], members: ['我', '老婆', '孩子1', '父亲', '母亲'], rootName: 'LHDN 税务收据',
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const relief = (id) => RELIEFS.find((r) => r.id === id) || RELIEFS[RELIEFS.length - 1];

/* ---------------- 设置（本机存储） ---------------- */
function loadCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tr_cfg') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveCfg(c) { try { localStorage.setItem('tr_cfg', JSON.stringify(c)); } catch {} }
let cfg = loadCfg();

function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), ms);
}

/* ---------------- Google 登录（Google Identity Services） ---------------- */
let tokenClient = null, accessToken = null, tokenExp = 0;

function gisReady() { return window.google && google.accounts && google.accounts.oauth2; }

function initTokenClient() {
  if (!cfg.clientId || !gisReady()) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: cfg.clientId, scope: SCOPES, callback: () => {} });
  return true;
}

function getToken(interactive = false) {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExp - 60_000) return resolve(accessToken);
    if (!tokenClient && !initTokenClient()) return reject(new Error('请先在“设置”填入 Google Client ID'));
    tokenClient.callback = (r) => {
      if (r.error) return reject(new Error('Google 授权失败：' + r.error));
      accessToken = r.access_token; tokenExp = Date.now() + r.expires_in * 1000;
      try { localStorage.setItem('tr_consented', '1'); } catch {}
      setChip(true); resolve(accessToken);
    };
    tokenClient.error_callback = (e) => reject(new Error('Google 授权窗口被关闭或被拦截（' + (e.type || e.message) + '）'));
    const consented = (() => { try { return localStorage.getItem('tr_consented') === '1'; } catch { return false; } })();
    tokenClient.requestAccessToken({ prompt: interactive || !consented ? 'consent' : '' });
  });
}

function setChip(on) {
  $('gchip').textContent = on ? 'Google 已连接' : '未连接 Google';
  $('gchip').classList.toggle('on', on);
}

async function gfetch(url, opts = {}) {
  const t = await getToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (r.status === 401) { accessToken = null; setChip(false); throw new Error('Google 登录已过期，请再试一次'); }
  if (!r.ok) throw new Error('Google API 错误 ' + r.status + '：' + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json();
}

/* ---------------- Google Drive ---------------- */
const folderCache = new Map();
const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function folder(name, parent = 'root') {
  const key = parent + '/' + name;
  if (folderCache.has(key)) return folderCache.get(key);
  const query = `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
  const res = await gfetch('https://www.googleapis.com/drive/v3/files?fields=files(id,name)&q=' + encodeURIComponent(query));
  let id = res.files[0]?.id;
  if (!id) {
    const f = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
    });
    id = f.id;
  }
  folderCache.set(key, id);
  return id;
}

async function uploadFile(blob, name, parent, description) {
  const meta = { name, parents: [parent], description };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', blob);
  return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', body: form,
  });
}

/* ---------------- Google Sheets 总账 ---------------- */
let ledgerId = null;

async function ledger(create = true) {
  if (ledgerId) return ledgerId;
  const root = await folder(cfg.rootName);
  const query = `name='${q(LEDGER_NAME)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and '${root}' in parents`;
  const res = await gfetch('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(query));
  ledgerId = res.files[0]?.id || null;
  if (!ledgerId && create) {
    const f = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: LEDGER_NAME, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root] }),
    });
    ledgerId = f.id;
  }
  return ledgerId;
}

const sheetsKnown = new Set();
async function ensureTab(id, title) {
  if (sheetsKnown.has(title)) return;
  const meta = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`);
  const titles = meta.sheets.map((s) => s.properties.title);
  if (!titles.includes(title)) {
    await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }),
    });
    await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=RAW`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [HEADER] }),
    });
  }
  sheetsKnown.add(title);
}

async function readRows(ya) {
  const id = await ledger(false);
  if (!id) return [];
  try {
    const r = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'YA${ya}'!A2:N`)}?valueRenderOption=UNFORMATTED_VALUE`);
    return (r.values || []).filter((v) => v.length > 4);
  } catch (e) {
    if (String(e.message).includes('400')) return []; // 该年份分页还不存在
    throw e;
  }
}

const payerOf = (row) => (cfg.payers.includes(row[13]) ? row[13] : cfg.payers[0]);

// 防止商家名称等被 Sheets 当成公式
const safe = (s) => (/^[=+\-@]/.test(String(s || '')) ? "'" + s : String(s || ''));

async function appendRow(ya, row) {
  const id = await ledger();
  await ensureTab(id, 'YA' + ya);
  await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'YA${ya}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }),
  });
}

/* ---------------- 图片处理 ---------------- */
async function prepareFile(file) {
  if (file.type === 'application/pdf') return { blob: file, mime: 'application/pdf', ext: 'pdf' };
  // 缩到最长边 2400px、JPEG 85%：清晰可读，又省 Drive 空间
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('无法读取这张图片'));
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  // 给 AI 的版本：最长边 1280px，够读清楚文字，上传和分析都快很多
  const s2 = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const c2 = document.createElement('canvas');
  c2.width = Math.round(img.naturalWidth * s2); c2.height = Math.round(img.naturalHeight * s2);
  c2.getContext('2d').drawImage(img, 0, 0, c2.width, c2.height);
  const aiBlob = await new Promise((res) => c2.toBlob(res, 'image/jpeg', 0.8));
  return { blob, aiBlob, mime: 'image/jpeg', ext: 'jpg', url: img.src };
}

const toBase64 = (blob) => new Promise((res) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob);
});

async function sha256(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/* ---------------- Gemini 分析 ---------------- */
function buildPrompt() {
  const cats = RELIEFS.map((r) => `- ${r.id}：${r.name}${r.cap ? `（上限 RM${r.cap}）` : ''}。适用：${r.covers}`).join('\n');
  return `你是马来西亚个人所得税（LHDN）助理。请读取这张收据/单据，并判断它属于哪一个个人所得税减免项目。

减免分类（只能从以下 id 选一个）：
${cats}

家人名单：${cfg.members.join('、')}

规则：
1. 只根据单据上看得到的内容判断；看不出是减免项目的日常花费，选 OTHER。
2. 电子产品只有电脑/手提电脑/手机/平板才算 LIFESTYLE；耳机、电视、手表等选 OTHER。
3. 一般衣服、普通鞋子不算 SPORTS，除非明确是运动器材/运动鞋。
4. 药房买的普通药品、保健品一般不能扣税，选 OTHER（除非是医疗监测器材或疫苗）。
5. 如能从单据看出是谁（病人名字、孩子名字、保单受保人），填 member_guess；否则填 "${cfg.members[0]}"。
6. 金额用最终实付总额（含 SST），只填数字。马来西亚收据日期通常是 日/月/年（DD/MM/YY 或 DD/MM/YYYY），两位数年份 YY 一律解读为 20YY（例如 31/08/26 = 2026-08-31）。今天是 ${new Date().toISOString().slice(0, 10)}，收据日期不可能晚于今天。输出格式 YYYY-MM-DD；看不清就填 null。
7. reason 用简体中文一两句话说明归类理由；若有申报风险（例如商家看起来不是注册诊所、项目可能不符合条件），写进 warnings。

只输出 JSON：
{"is_receipt": true, "date": "YYYY-MM-DD", "merchant": "", "total_amount": 0, "currency": "MYR",
 "items_summary": "", "category_id": "", "member_guess": "", "confidence": 0.0, "reason": "", "warnings": []}`;
}

async function analyze(prep) {
  if (!cfg.geminiKey) throw new Error('请先在“设置”填入 Gemini API Key');
  const body = {
    contents: [{ parts: [{ text: buildPrompt() }, { inlineData: { mimeType: prep.mime, data: await toBase64(prep.aiBlob || prep.blob) } }] }],
    // 读收据不需要深度推理：关掉“思考”，速度快好几倍
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model || DEFAULTS.model)}:generateContent`;
  const call = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, body: JSON.stringify(body) });
  let r = await call();
  if (r.status === 400) { delete body.generationConfig.thinkingConfig; r = await call(); } // 旧模型不支持此设定时自动退回
  if (!r.ok) throw new Error('Gemini 错误 ' + r.status + '：' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  const json = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
  if (!RELIEFS.some((x) => x.id === json.category_id)) json.category_id = 'OTHER';
  return json;
}

/* ---------------- 上传流程 ---------------- */
let current = null; // { prep, hash, ai }

function fillSelects() {
  $('fCat').innerHTML = RELIEFS.map((r) => `<option value="${r.id}">${r.name}${r.cap ? ' · 上限 RM' + r.cap.toLocaleString() : ''}</option>`).join('');
  $('fMember').innerHTML = cfg.members.map((m) => `<option>${escapeHtml(m)}</option>`).join('');
  const opts = cfg.payers.map((m) => `<option>${escapeHtml(m)}</option>`).join('');
  const keep = $('sPayer').value;
  $('fPayer').innerHTML = opts; $('sPayer').innerHTML = opts;
  if (cfg.payers.includes(keep)) $('sPayer').value = keep;
}
function lastPayer() { try { const p = localStorage.getItem('tr_lastPayer'); return cfg.payers.includes(p) ? p : cfg.payers[0]; } catch { return cfg.payers[0]; } }
// 收据是某位报税人自己的花费时，自动把报税人切换成他/她
function syncPayer() { const m = $('fMember').value; if (cfg.payers.includes(m)) $('fPayer').value = m; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function showOnly(id) {
  ['pickCard', 'reviewCard', 'doneCard'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
}

function updateCatHelp() {
  const r = relief($('fCat').value);
  $('catHelp').textContent = r.covers;
}
function updateYA() {
  const d = $('fDate').value || '', y = d.slice(0, 4), now = new Date();
  let warn = '';
  if (y && d > now.toISOString().slice(0, 10)) warn = ' ⚠ 日期在未来，请检查';
  else if (y && +y < now.getFullYear() - 1) warn = ' ⚠ 这是 ' + (now.getFullYear() - y) + ' 年前的收据，请确认日期没读错';
  $('yaNote').textContent = y ? `将存入 YA${y}（${y} 年的花费，${+y + 1} 年报税）${warn}` : '';
  $('yaNote').classList.toggle('bad', !!warn);
}

async function onPick(file) {
  if (!file) return;
  showOnly('reviewCard');
  $('form').classList.add('hidden'); $('aiBox').classList.add('hidden'); $('aiBusy').classList.remove('hidden');
  try {
    const prep = await prepareFile(file);
    if (prep.url) { $('preview').src = prep.url; $('preview').classList.remove('hidden'); $('pdfName').classList.add('hidden'); }
    else { $('preview').classList.add('hidden'); $('pdfName').textContent = '📄 ' + file.name; $('pdfName').classList.remove('hidden'); }
    current = { prep, hash: await sha256(prep.blob), fileName: file.name };
    let ai; const t0 = Date.now();
    const tick = setInterval(() => { $('aiBusy').innerHTML = `<span class="spinner"></span>&nbsp; AI 正在分析收据… ${Math.round((Date.now() - t0) / 1000)} 秒`; }, 1000);
    try { ai = await analyze(prep); }
    catch (e) { ai = { category_id: 'OTHER', confidence: 0, reason: 'AI 分析失败：' + e.message + '。请手动填写。', warnings: [] }; }
    finally { clearInterval(tick); $('aiBusy').innerHTML = '<span class="spinner"></span>&nbsp; AI 正在分析收据…'; }
    current.ai = ai;
    fillSelects();
    $('fCat').value = ai.category_id || 'OTHER';
    $('fMember').value = cfg.members.includes(ai.member_guess) ? ai.member_guess : cfg.members[0];
    $('fPayer').value = lastPayer(); syncPayer();
    $('fDate').value = /^\d{4}-\d{2}-\d{2}$/.test(ai.date || '') ? ai.date : new Date().toISOString().slice(0, 10);
    $('fAmount').value = ai.total_amount ?? '';
    $('fMerchant').value = ai.merchant || '';
    $('fDesc').value = ai.items_summary || '';
    const conf = Math.round((ai.confidence || 0) * 100);
    const box = $('aiBox');
    box.classList.toggle('low', conf < 70);
    box.innerHTML = `<b>AI 建议：${escapeHtml(relief(ai.category_id).name)}</b> <span class="badge">把握 ${conf}%</span><br>${escapeHtml(ai.reason || '')}`
      + (ai.warnings?.length ? `<br><span class="bad">⚠ ${ai.warnings.map(escapeHtml).join('；')}</span>` : '')
      + (ai.is_receipt === false ? '<br><span class="bad">⚠ 这看起来不像收据，请确认。</span>' : '');
    box.classList.remove('hidden');
    updateCatHelp(); updateYA();
    $('form').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 5000); showOnly('pickCard');
  } finally {
    $('aiBusy').classList.add('hidden');
  }
}

const clean = (s, n = 40) => String(s || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, n);

async function onSave() {
  const btn = $('btnSave');
  const date = $('fDate').value, amount = parseFloat($('fAmount').value);
  if (!date || isNaN(amount)) return toast('请填写日期和金额');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 保存中…';
  try {
    await getToken(); // 先在按钮点击时取得授权，避免弹窗被拦截
    const ya = date.slice(0, 4);
    const r = relief($('fCat').value), member = $('fMember').value, payer = $('fPayer').value;
    try { localStorage.setItem('tr_lastPayer', payer); } catch {}
    const merchant = $('fMerchant').value.trim(), desc = $('fDesc').value.trim();

    const existing = await readRows(ya);
    if (existing.some((row) => row[11] === current.hash) &&
        !confirm('这张收据好像已经上传过了（YA' + ya + '）。还要再存一次吗？')) {
      btn.disabled = false; btn.textContent = '保存到 Drive'; return;
    }

    const root = await folder(cfg.rootName);
    const yaF = await folder('YA' + ya, root);
    const payF = await folder(clean(payer, 30) || cfg.payers[0], yaF);
    const catF = await folder(r.folder, payF);
    const memF = await folder(clean(member, 30) || '本人', catF);
    const name = `${date}_${clean(merchant) || '收据'}_RM${amount.toFixed(2)}.${current.prep.ext}`;
    const descr = `报税人:${payer} | ${r.name} | ${member} | ${desc} | AI:${current.ai?.category_id || ''}`;
    const up = await uploadFile(current.prep.blob, name, memF, descr);

    await appendRow(ya, [
      new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }), date, safe(merchant), amount,
      r.id, r.name, safe(member), safe(desc), `=HYPERLINK("${up.webViewLink}","打开")`, up.id,
      current.ai?.confidence ?? '', current.hash, current.ai?.category_id || '', safe(payer),
    ]);

    $('doneText').textContent = `报税人：${payer} · ${r.name} · ${member} · ${fmt(amount)} → YA${ya}/${payer}/${r.folder}/${member}`;
    $('doneLink').href = up.webViewLink;
    showOnly('doneCard');
    summaryDirty = true;
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    btn.disabled = false; btn.textContent = '保存到 Drive';
  }
}

/* ---------------- 总览 ---------------- */
let summaryDirty = true;

function fillYAs() {
  const now = new Date().getFullYear();
  const ys = []; for (let y = now; y >= now - 7; y--) ys.push(y);
  $('sYA').innerHTML = ys.map((y) => `<option value="${y}">YA${y}</option>`).join('');
}

async function loadSummary() {
  const ya = $('sYA').value;
  $('sYANote').textContent = `${ya} 年 1–12 月的花费 · ${+ya + 1} 年 4–5 月报税 · 建议保留至 ${+ya + 8} 年`;
  $('sCats').innerHTML = '<p class="muted"><span class="spinner"></span> 载入中…</p>';
  try {
    await getToken();
    const payer = $('sPayer').value || cfg.payers[0];
    const rows = (await readRows(ya)).filter((v) => payerOf(v) === payer);
    const root = await folder(cfg.rootName);
    $('sFolder').href = 'https://drive.google.com/drive/folders/' + root;
    const lid = await ledger(false);
    $('sSheet').classList.toggle('hidden', !lid);
    if (lid) $('sSheet').href = 'https://docs.google.com/spreadsheets/d/' + lid;

    const byCat = {}, byMember = {};
    rows.forEach((v) => {
      const amt = Number(v[3]) || 0;
      byCat[v[4]] = (byCat[v[4]] || 0) + amt;
      if (relief(v[4]).cap) byMember[v[6]] = (byMember[v[6]] || 0) + amt;
    });

    // 先按单项上限，再按共享上限（如医疗 RM10,000）
    const claim = {};
    RELIEFS.forEach((r) => { if (r.cap) claim[r.id] = Math.min(byCat[r.id] || 0, r.cap); });
    const groupClaim = {};
    Object.entries(RELIEF_GROUPS).forEach(([g, info]) => {
      const s = RELIEFS.filter((r) => r.group === g).reduce((a, r) => a + (claim[r.id] || 0), 0);
      groupClaim[g] = Math.min(s, info.cap);
    });
    const total = RELIEFS.filter((r) => r.cap && !r.group).reduce((a, r) => a + claim[r.id], 0)
      + Object.values(groupClaim).reduce((a, b) => a + b, 0);
    $('sTotal').textContent = fmt(total);
    $('sCount').textContent = `${rows.length} 张收据` + (byCat.DONATION ? ` · 另有认可捐款 ${fmt(byCat.DONATION)}` : '')
      + (byCat.ZAKAT ? ` · Zakat ${fmt(byCat.ZAKAT)}` : '');

    const bar = (spent, cap) => {
      const p = Math.min(100, (spent / cap) * 100);
      const cls = spent > cap ? 'over' : spent >= cap ? 'full' : '';
      return `<div class="bar"><i class="${cls}" style="width:${p}%"></i></div>`;
    };
    let html = '';
    Object.entries(RELIEF_GROUPS).forEach(([g, info]) => {
      const spent = RELIEFS.filter((r) => r.group === g).reduce((a, r) => a + (byCat[r.id] || 0), 0);
      if (!spent) return;
      html += `<div class="cat"><div class="top"><b>${info.name}</b><span>${fmt(groupClaim[g])} / ${fmt(info.cap)}</span></div>${bar(spent, info.cap)}`
        + (info.note ? `<div class="muted">${info.note}</div>` : '') + '</div>';
    });
    RELIEFS.forEach((r) => {
      const spent = byCat[r.id] || 0;
      if (!spent) return;
      if (!r.cap) {
        html += `<div class="cat"><div class="top"><span>${r.name}</span><span>${fmt(spent)}</span></div></div>`;
        return;
      }
      const left = Math.max(0, r.cap - spent);
      html += `<div class="cat"><div class="top"><span>${r.group ? '↳ ' : ''}${r.name}</span><span>${fmt(spent)} / ${fmt(r.cap)}</span></div>${bar(spent, r.cap)}`
        + `<div class="muted">${spent > r.cap ? '已超过上限，超出部分不能扣除' : left ? '还可以用 ' + fmt(left) : '已用满'}</div></div>`;
    });
    $('sCats').innerHTML = html || '<p class="muted">这一年还没有收据。</p>';

    $('sMembers').innerHTML = Object.entries(byMember).map(([m, a]) =>
      `<div class="rec"><span>${escapeHtml(m)}</span><span>${fmt(a)}</span></div>`).join('') || '<p class="muted">—</p>';

    $('sRecent').innerHTML = rows.slice(-30).reverse().map((v) =>
      `<div class="rec"><div><b>${escapeHtml(v[2] || '收据')}</b><br><span class="muted">${escapeHtml(v[1])} · ${escapeHtml(v[5])} · ${escapeHtml(v[6])}</span></div>`
      + `<div style="text-align:right">${fmt(v[3])}<br><a href="https://drive.google.com/file/d/${encodeURIComponent(v[9])}/view" target="_blank" rel="noopener">打开</a></div></div>`
    ).join('') || '<p class="muted">—</p>';
    summaryDirty = false;
  } catch (e) {
    $('sCats').innerHTML = `<p class="bad">${escapeHtml(e.message)}</p><button class="btn secondary" onclick="loadSummary()">重试</button>`;
  }
}

/* ---------------- 导航与设置界面 ---------------- */
function go(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'v-' + view));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.goto === view));
  if (view === 'summary' && summaryDirty) loadSummary();
  window.scrollTo(0, 0);
}

function renderSettings() {
  $('cfgClient').value = cfg.clientId; $('cfgKey').value = cfg.geminiKey; $('cfgModel').value = cfg.model;
  $('cfgPayers').value = cfg.payers.join('\n');
  $('cfgMembers').value = cfg.members.join('\n'); $('cfgRoot').value = cfg.rootName;
  $('reliefNote').textContent = RELIEF_YEAR_NOTE;
  $('setupHint').classList.toggle('hidden', !!(cfg.clientId && cfg.geminiKey));
}

function readSettingsForm() {
  const payers = $('cfgPayers').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const members = $('cfgMembers').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const clientChanged = $('cfgClient').value.trim() !== cfg.clientId;
  cfg = {
    clientId: $('cfgClient').value.trim(), geminiKey: $('cfgKey').value.trim(),
    model: $('cfgModel').value.trim() || DEFAULTS.model,
    payers: payers.length ? payers : DEFAULTS.payers,
    members: members.length ? members : DEFAULTS.members, rootName: $('cfgRoot').value.trim() || DEFAULTS.rootName,
  };
  saveCfg(cfg);
  if (clientChanged) { tokenClient = null; accessToken = null; setChip(false); }
  folderCache.clear(); ledgerId = null; sheetsKnown.clear(); summaryDirty = true;
}

function bind() {
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  $('btnCamera').onclick = () => $('inCamera').click();
  $('btnFile').onclick = () => $('inFile').click();
  $('inCamera').onchange = (e) => { onPick(e.target.files[0]); e.target.value = ''; };
  $('inFile').onchange = (e) => { onPick(e.target.files[0]); e.target.value = ''; };
  $('fCat').onchange = updateCatHelp;
  $('fDate').onchange = updateYA;
  $('btnSave').onclick = onSave;
  $('btnCancel').onclick = () => showOnly('pickCard');
  $('btnNext').onclick = () => showOnly('pickCard');
  $('sYA').onchange = loadSummary;
  $('sPayer').onchange = loadSummary;
  $('fMember').addEventListener('change', syncPayer);
  $('btnSaveCfg').onclick = () => { readSettingsForm(); renderSettings(); fillSelects(); toast('设置已保存'); };
  $('btnConnect').onclick = async () => {
    readSettingsForm(); renderSettings();
    try { await getToken(true); await folder(cfg.rootName); toast('已连接 Google Drive ✓'); }
    catch (e) { toast(e.message, 5000); }
  };
  $('btnDisconnect').onclick = () => {
    if (accessToken && gisReady()) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null; tokenExp = 0; setChip(false);
    try { localStorage.removeItem('tr_consented'); } catch {}
    toast('已断开 Google');
  };
}

window.addEventListener('load', () => {
  bind(); fillSelects(); fillYAs(); renderSettings();
  if (!cfg.clientId || !cfg.geminiKey) go('settings');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
