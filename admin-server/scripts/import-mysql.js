// 一次性迁移工具：云导出 JSON → MySQL（schema.sql）+ 数据校验
// 输入支持：
//   1) export-cloud.js 产出的全量文件（含 students/admins/... 顶层键）
//   2) 单个集合文件（数组 / NDJSON / {data:[...]})
//   3) 目录（students.json, admins.json, entry_requests.json, users.json, tips.json，
//      或以集合名开头的文件名，兼容控制台导出）
// 用法：
//   node scripts/import-mysql.js --input scripts/out/cloud-export-xxx.json --verify
//   node scripts/import-mysql.js --input ./云导出目录 --truncate --verify
//   node scripts/import-mysql.js --input ... --dry-run     （只解析统计，不连库）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const dbCfg = config.db || {};

const COLLECTIONS = ['students', 'admins', 'entry_requests', 'users', 'tips'];

const TABLES = {
  students: {
    required: ['name', 'phone'],
    str: ['name', 'phone', 'className', 'schedule', 'deadline', 'location', 'courseStartDate', 'courseEndDate', 'idCard', 'company', 'password'],
    json: ['courseDates'], dt: ['createdAt', 'updatedAt'], bool: ['mustChangePassword']
  },
  admins: {
    required: ['name', 'phone'],
    str: ['name', 'phone', 'password', 'role'],
    json: ['classes'], dt: ['createdAt', 'updatedAt'], bool: ['mustChangePassword']
  },
  entry_requests: {
    required: ['name', 'phone'],
    str: ['name', 'phone', 'carPlate', 'entryDate', 'entryStartTime', 'entryEndTime', 'status', 'rejectReason'],
    json: [], dt: ['createdAt', 'processedAt'], bool: []
  },
  users: {
    required: ['phone'],
    str: ['phone', 'name', 'role', 'password'],
    json: [], dt: ['createdAt'], bool: []
  },
  tips: {
    required: ['className'],
    str: ['className', 'content', 'createdBy'],
    json: [], dt: ['createdAt', 'updatedAt'], bool: []
  }
};

// ---------- 参数 ----------
function parseArgs(argv) {
  const a = { input: null, verify: false, truncate: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--input') a.input = argv[++i];
    else if (k === '--verify') a.verify = true;
    else if (k === '--truncate') a.truncate = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}
const args = parseArgs(process.argv);
if (args.help || !args.input) {
  console.log('用法: node scripts/import-mysql.js --input <文件或目录> [--verify] [--truncate] [--dry-run]');
  process.exit(args.help ? 0 : 1);
}

// ---------- 解析云导出 ----------
function parseJsonLoose(txt) {
  try { return JSON.parse(txt); } catch (e) { return undefined; }
}

function loadDocs(file) {
  const txt = fs.readFileSync(file, 'utf8').trim();
  const parsed = parseJsonLoose(txt);
  if (Array.isArray(parsed)) return { __mixed: parsed };
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed);
    if (keys.some(k => COLLECTIONS.includes(k))) return parsed;          // 全量文件
    if (Array.isArray(parsed.data)) return { __mixed: parsed.data };     // {data:[...]}
    if (parsed._id !== undefined) return { __mixed: [parsed] };          // 单文档
  }
  // NDJSON（每行一个文档）
  const docs = [];
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const d = parseJsonLoose(s);
    if (d && typeof d === 'object') docs.push(d);
  }
  if (docs.length) return { __mixed: docs };
  throw new Error('无法解析: ' + file);
}

function collect(inputPath) {
  const out = Object.fromEntries(COLLECTIONS.map(c => [c, []]));
  const st = fs.statSync(inputPath);
  if (st.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter(f => f.endsWith('.json'));
    let matched = 0;
    for (const f of files) {
      const full = path.join(inputPath, f);
      const parsed = loadDocs(full);
      const hit = COLLECTIONS.find(c => f === c + '.json' || f.startsWith(c + '_') || f.startsWith(c + '-'));
      if (hit) { out[hit].push(...parsed.__mixed || parsed[hit] || []); matched++; continue; }
      for (const c of COLLECTIONS) if (Array.isArray(parsed[c])) { out[c].push(...parsed[c]); matched++; }
      if (Array.isArray(parsed.__mixed)) throw new Error(`目录内 ${f} 无法识别集合归属，请重命名为 <集合名>.json`);
    }
    if (!matched) throw new Error('目录内未找到集合 JSON 文件');
    return out;
  }
  const parsed = loadDocs(inputPath);
  if (parsed.__mixed) {
    // 单集合文件：按内容猜集合
    const guess = guessCollection(parsed.__mixed);
    if (!guess) throw new Error('无法识别该文件属于哪个集合（文档缺少特征字段）');
    out[guess] = parsed.__mixed;
    return out;
  }
  for (const c of COLLECTIONS) out[c] = parsed[c] || [];
  return out;
}

function guessCollection(docs) {
  const d = docs[0] || {};
  if (d.status !== undefined && d.entryDate !== undefined) return 'entry_requests';
  if (d.className !== undefined && d.content !== undefined) return 'tips';
  if (d.schedule !== undefined || d.idCard !== undefined) return 'students';
  if (d.role !== undefined && d.password !== undefined && d.classes !== undefined) return 'admins';
  if (d.role !== undefined && d.phone !== undefined) return 'users';
  return null;
}

// ---------- 值转换 ----------
function fmtDT(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
function toDT(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') {
    if (v.$date !== undefined) {
      let ms = v.$date;
      if (ms && typeof ms === 'object') ms = ms.$numberLong;
      if (typeof ms === 'string') ms = Number(ms);
      if (typeof ms === 'number' && Number.isFinite(ms)) return fmtDT(new Date(ms));
      if (typeof ms === 'string') { const d = new Date(ms); return isNaN(d) ? null : fmtDT(d); }
      return null;
    }
    return null;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : fmtDT(d);
}
function toJSONCol(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[') || t.startsWith('{') || t.startsWith('"')) {
      try { JSON.parse(t); return t; } catch (e) { /* 落到下面 */ }
    }
    return JSON.stringify(v);
  }
  return JSON.stringify(v);
}
function toBool(v) { return v ? 1 : 0; }

function toRow(coll, doc) {
  const def = TABLES[coll];
  const row = { _id: String(doc._id || crypto.randomUUID()) };
  for (const f of def.str) {
    const v = doc[f];
    row[f] = (v === undefined || v === null) ? '' : String(v);
  }
  for (const f of def.json) row[f] = toJSONCol(doc[f]);
  for (const f of def.dt) row[f] = toDT(doc[f]);
  for (const f of def.bool) row[f] = toBool(doc[f]);
  if (coll === 'entry_requests' && !row.status) row.status = 'pending';
  if (coll === 'admins' && !row.role) row.role = 'admin';
  if (coll === 'users' && !row.role) row.role = 'student';
  return row;
}

// ---------- 主流程 ----------
async function main() {
  const data = collect(args.input);
  console.log('== 解析结果（源数据）==');
  for (const c of COLLECTIONS) console.log(`  ${c}: ${data[c].length} 条`);
  const total = COLLECTIONS.reduce((s, c) => s + data[c].length, 0);
  if (total === 0) { console.error('未解析到任何数据'); process.exit(1); }
  if (args.dryRun) { console.log('--dry-run：不连库，结束'); return; }

  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: dbCfg.host || '127.0.0.1',
    port: dbCfg.port || 3306,
    user: dbCfg.user || 'root',
    password: dbCfg.password || '',
    database: dbCfg.database || 'entry_system',
    multipleStatements: true
  });

  // 建表（幂等）
  const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await conn.query(schema);

  await conn.beginTransaction();
  const errors = [];
  let inserted = 0, updated = 0;

  for (const coll of COLLECTIONS) {
    const def = TABLES[coll];
    const cols = ['_id', ...def.str, ...def.json, ...def.dt, ...def.bool];
    const sql = `INSERT INTO ${coll} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
      ON DUPLICATE KEY UPDATE ${cols.filter(c => c !== '_id').map(c => `${c}=VALUES(${c})`).join(',')}`;
    for (const doc of data[coll]) {
      try {
        const row = toRow(coll, doc);
        const missing = def.required.filter(f => !row[f]);
        if (missing.length) { errors.push(`${coll}/${row._id}: 缺少必填 ${missing.join(',')}`); continue; }
        const [r] = await conn.query(sql, cols.map(c => row[c]));
        if (r.affectedRows > 0 && r.changedRows === 0) updated += 0; else updated += 0;
        inserted += r.affectedRows ? 1 : 0;
      } catch (e) {
        errors.push(`${coll}/${doc._id}: ${e.message}`);
      }
    }
  }
  await conn.commit();
  console.log(`== 导入完成：处理 ${total} 条，错误 ${errors.length} 条 ==`);
  errors.slice(0, 20).forEach(e => console.log('  ! ' + e));
  if (errors.length > 20) console.log(`  ... 共 ${errors.length} 条错误`);

  if (args.verify) {
    console.log('== 校验 ==');
    let pass = true;
    for (const coll of COLLECTIONS) {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${coll}`);
      const ok = Number(row.n) === data[coll].length;
      if (!ok) pass = false;
      console.log(`  ${coll}: 源 ${data[coll].length} / 库 ${row.n} ${ok ? '✓' : '✗'}`);
    }
    // 抽样字段比对（每表前 5 条）
    for (const coll of COLLECTIONS) {
      const def = TABLES[coll];
      const sample = data[coll].slice(0, 5);
      for (const doc of sample) {
        const [rs] = await conn.query(`SELECT * FROM ${coll} WHERE _id = ?`, [String(doc._id)]);
        if (!rs.length) { console.log(`  ✗ ${coll}/${doc._id} 库中缺失`); pass = false; continue; }
        const dbRow = rs[0];
        const row = toRow(coll, doc);
        for (const f of def.str) {
          if (String(dbRow[f] ?? '') !== String(row[f] ?? '')) {
            console.log(`  ✗ ${coll}/${doc._id}.${f}: 源="${row[f]}" 库="${dbRow[f]}"`); pass = false;
          }
        }
        for (const f of def.bool) {
          if (Number(dbRow[f]) !== row[f]) { console.log(`  ✗ ${coll}/${doc._id}.${f}`); pass = false; }
        }
      }
    }
    // 密码散列完整性（scrypt 格式或空）
    const [[pwBad]] = await conn.query(
      `SELECT COUNT(*) AS n FROM students WHERE password <> '' AND password NOT LIKE 'scrypt$%'`);
    console.log(`  students 密码非 scrypt 格式: ${pwBad.n} 条 ${Number(pwBad.n) === 0 ? '✓' : '(旧明文可在登录时自动升级)'}`);
    console.log(pass ? '== 校验通过 ✓ ==' : '== 校验发现差异 ✗ ==');
    process.exitCode = pass ? 0 : 2;
  }

  await conn.end();
}

args.truncate && console.log('（注意: --truncate 当前版本未启用清表，重复导入靠 upsert 幂等）');
main().catch(e => { console.error('失败:', e.message); process.exit(1); });
