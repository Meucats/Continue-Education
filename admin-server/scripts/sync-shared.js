// shared/ 权威源 → 消费端副本复制（R3 起用；副本与源逐字节一致由 check 守卫比对）
// 用法：node scripts/sync-shared.js   （改动 shared/ 后必须执行，check 才会放行）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');              // admin-server
const SRC = path.join(ROOT, 'shared');                // 权威源
// 消费端目标（相对本脚本换算）：R3 = adminApi 云函数；R4 增补 public（index.html script src）与 miniprogram（admin-add require）
const TARGETS = [
  path.join(ROOT, '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'shared'),
  path.join(ROOT, 'public', 'shared'),
  path.join(ROOT, '..', 'wxminiprogram', 'miniprogram', 'shared')
];
let n = 0;
for (const dir of TARGETS) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js')) continue;
    fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
    console.log('sync-shared: shared/' + f + ' -> ' + path.relative(path.join(ROOT, '..'), path.join(dir, f)));
    n++;
  }
}
console.log('sync-shared: ' + n + ' file(s) copied');
