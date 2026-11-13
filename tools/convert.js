// 調査結果のブロック（key: / name: / ... 形式）を machines.js に変換する
// 使い方: node tools/convert.js <ブロックのtxt>... > machines.js
const fs = require('fs');

const FIELD = /^(key|name|full|coin|situations|counters|ev|aim|guide-[^:：]+|memo)\s*[:：]\s*(.*)$/;
// 全角・▲・各種マイナス記号・桁区切りを吸収。空欄や読めないものは NaN（0 にしない）
const num = s => {
  s = String(s ?? '').normalize('NFKC').trim().replace(/^▲/, '-').replace(/[,円+\s]/g, '').replace(/[−–‐—]/g, '-').replace(/[GgＧ回pt]+$/, '');
  return s === '' ? NaN : Number(s);
};
// 「a=1,000, b=2」を key=値 の組に分ける（桁区切りのカンマでは切らない）
const pairs = s => s.split(/[,、]\s*(?=[A-Za-z0-9_]+\s*=)/).map(p => p.split('=').map(x => x && x.trim()));
const problems = [];

function parseBlock(text) {
  const f = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('```')) continue;
    const m = line.match(FIELD);
    if (m) { cur = m[1]; (f[cur] ||= []).push(m[2]); }
    else if (cur) f[cur].push(line);
  }
  return f;
}

// 「a|b|c ; d|e|f」や複数行を1件ずつに分ける
const items = arr => (arr || []).join('\n').split(/\n|\s*;\s*(?=[A-Za-z0-9_]+\|)/).map(s => s.trim()).filter(s => s.includes('|'));

function toMachine(f) {
  const key = f.key?.[0]?.trim();
  if (!key || /未確認/.test(key)) return null;
  const situations = items(f.situations).map(s => {
    const [id, label, ...stop] = s.split('|');
    return { id: id.trim(), label: label.trim(), stop: stop.join('|').trim() };
  });
  const sitIds = new Set(situations.map(s => s.id));
  const counters = items(f.counters).map(s => {
    const [id, label, unit, ceils] = s.split('|').map(x => x.trim());
    const ceil = {}, guess = [];
    for (const [sid, v] of pairs(ceils || '')) {
      if (!sid || v == null) continue;
      if (isNaN(num(v))) problems.push(`${key}: ${id} の天井 "${sid}=${v}" が読めない`);
      else ceil[sid] = num(v);
    }
    // 状況ごとの天井が書かれていなければ最初の状況の値を仮に入れ、画面で「仮」と分かるよう guess に記録
    situations.forEach(s => {
      if (ceil[s.id] == null) { ceil[s.id] = ceil[situations[0].id] ?? 0; guess.push(s.id); problems.push(`${key}: ${id}.${s.id} の天井を ${ceil[s.id]} で仮置き`); }
    });
    return { id, label, unit: unit || 'G', ceil, ...(guess.length ? { guess } : {}) };
  });
  const cids = new Set(counters.map(c => c.id));
  const RATES = new Set(['eq', '56m', '56c']);
  const checkKey = (cid, rate, sit, what) => {
    if (!cids.has(cid) || !RATES.has(rate) || !sitIds.has(sit)) { problems.push(`${key}: ${what} ${cid}_${rate}_${sit} のカウンター/交換率/状況が存在しない`); return false; }
    return true;
  };
  const ev = {};
  for (const line of (f.ev || []).join('\n').split('\n')) {
    const [cid, sit, cols, rows] = line.split('|').map(x => x && x.trim());
    if (!rows) continue;
    const rates = cols.split(/[,、/]/).map(x => x.trim());
    const cells = rows.split(/[;；]/).map(r => r.trim()).filter(Boolean).map(r => {
      const [x, vs] = r.split(/[:：]/);
      return [num(x), ...(vs || '').split('/').map(num)];
    });
    // 交換率の列ごとに、読める行だけ使う（1つのセルが読めなくても他の列の行は落とさない）
    rates.forEach((rate, i) => {
      if (!checkKey(cid, rate, sit, 'ev')) return;
      const ok = cells.filter(p => !isNaN(p[0]) && !isNaN(p[i + 1]));
      if (ok.length < cells.length) problems.push(`${key}: ev ${cid}_${rate}_${sit} で読めない行を${cells.length - ok.length}行スキップ`);
      if (!ok.length) return;
      const k = `${cid}_${rate}_${sit}`;
      if (ev[k]) problems.push(`${key}: ev ${k} が重複（後の行で上書き）`);
      ev[k] = ok.sort((a, b) => a[0] - b[0]).map(p => `${p[0]},${p[i + 1]}`).join('\n');
    });
  }
  const aim = {};
  for (const [k, v] of pairs((f.aim || []).join(','))) {
    if (!k || v == null) continue;
    if (isNaN(num(v))) { problems.push(`${key}: aim ${k}=${v} が読めない`); continue; }
    // カウンターidに _ が含まれる場合があるので、交換率の位置から分け直す
    const m = k.match(/^(.+)_(eq|56m|56c)_(.+)$/);
    if (!m || !checkKey(m[1], m[2], m[3], 'aim')) continue;
    aim[k] = num(v);
  }
  const guide = {};
  for (const k in f) if (k.startsWith('guide-')) {
    const list = f[k].join(';').split(/[;；]/).map(s => s.trim()).filter(Boolean);
    if (list.length) guide[k.slice(6).trim()] = list;
  }
  const coin = num(f.coin?.[0]);
  if (isNaN(coin)) problems.push(`${key}: コイン持ちが不明なので32を仮置き`);
  return [key, {
    name: f.name[0].trim(), full: f.full[0].trim(), coin: isNaN(coin) ? 32 : coin, ...(isNaN(coin) ? { coinGuess: true } : {}),
    situations, counters, threshold: 1000, aim, ev, guide,
    memo: (f.memo || []).join('\n').replace(/\\n/g, '\n').trim(),
  }];
}

const out = {};
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const block of text.split(/\n(?=\s*(?:```\s*\n\s*)?key\s*[:：])/)) {
    if (!/key\s*[:：]/.test(block)) continue;
    const r = toMachine(parseBlock(block));
    if (!r) continue;
    const [k, m] = r;
    // 天井（カウンター）がない機種はこのツールでは判定できないので外す
    if (!m.situations.length || !m.counters.length) { problems.push(`${k}: 状況かカウンターがないので除外`); continue; }
    if (out[k]) problems.push(`${k}: keyが重複`);
    out[k] = m;
  }
}
problems.forEach(p => console.error('⚠ ' + p));
console.error(`${Object.keys(out).length}機種を変換`);
process.stdout.write('// 自動生成（tools/convert.js）。手で直す場合はブロックのtxtを直して再生成する\nwindow.EXTRA_MACHINES = ' + JSON.stringify(out, null, 1) + ';\n');
