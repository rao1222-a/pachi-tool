// 調査結果のブロック（key: / name: / ... 形式）を machines.js に変換する
// 使い方: node tools/convert.js <ブロックのtxt>... > machines.js
const fs = require('fs');

const FIELD = /^(key|name|full|coin|situations|counters|ev|aim|guide-[^:：]+|memo)\s*[:：]\s*(.*)$/;
const num = s => Number(String(s).replace(/[,，円+＋\s]/g, '').replace(/[−–]/g, '-'));

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
  const counters = items(f.counters).map(s => {
    const [id, label, unit, ceils] = s.split('|').map(x => x.trim());
    const ceil = {};
    for (const p of (ceils || '').split(/[,、]/)) {
      const [sid, v] = p.split('=').map(x => x && x.trim());
      if (sid && v && !isNaN(num(v))) ceil[sid] = num(v);
    }
    situations.forEach(s => { if (ceil[s.id] == null) ceil[s.id] = ceil[situations[0].id] ?? 0; });
    return { id, label, unit: unit || 'G', ceil };
  });
  const ev = {};
  for (const line of (f.ev || []).join('\n').split('\n')) {
    const [cid, sit, cols, rows] = line.split('|').map(x => x && x.trim());
    if (!rows || /未確認/.test(rows)) continue;
    const rates = cols.split(/[,、/]/).map(x => x.trim());
    const pts = rows.split(/[;；]/).map(r => r.trim()).filter(Boolean).map(r => {
      const [x, vs] = r.split(/[:：]/);
      return [num(x), ...(vs || '').split('/').map(num)];
    }).filter(p => p.every(v => !isNaN(v)));
    rates.forEach((rate, i) => {
      const t = pts.filter(p => p[i + 1] != null && !isNaN(p[i + 1])).map(p => `${p[0]},${p[i + 1]}`);
      if (t.length) ev[`${cid}_${rate}_${sit}`] = t.join('\n');
    });
  }
  const aim = {};
  for (const p of (f.aim || []).join(',').split(/[,、]/)) {
    const [k, v] = p.split('=').map(x => x && x.trim());
    if (k && v && !isNaN(num(v))) aim[k] = num(v);
  }
  const guide = {};
  for (const k in f) if (k.startsWith('guide-')) {
    const list = f[k].join(';').split(/[;；]/).map(s => s.trim()).filter(Boolean);
    if (list.length) guide[k.slice(6).trim()] = list;
  }
  const coin = num(f.coin?.[0]);
  return [key, {
    name: f.name[0].trim(), full: f.full[0].trim(), coin: isNaN(coin) ? 32 : coin,
    situations, counters, threshold: 1000, aim, ev, guide,
    memo: (f.memo || []).join('\n').replace(/\\n/g, '\n').trim(),
  }];
}

const out = {};
const problems = [];
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
