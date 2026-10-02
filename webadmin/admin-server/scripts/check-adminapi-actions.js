// 防漂移守卫（W4-1a R12 收敛后）：adminApi action handler map 结构与鉴权基线
// 1) HANDLERS 名单 = 重构前 37 个 case 名单（顺序一致、无重复）
// 2) 鉴权四集合逐字不变
// 3) 调用方鉴权块逐字不变
// 4) 未知 action 兜底（原 default）与分发逐字
// 5) switch(action) 已移除、default 标签清零
// 注：后续批次新增 action（1b 计划新增 ping）时同步更新 EXPECTED_ACTIONS/EXPECTED_SETS/EXPECTED_GATE/EXPECTED_DISPATCH 四项基线
const fs = require('fs');
const path = require('path');
const CLOUD = path.join(__dirname, '..', '..', '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'index.js');
const src = fs.readFileSync(CLOUD, 'utf8');

const EXPECTED_ACTIONS = [
  "getStudents",
  "getStudent",
  "addStudent",
  "updateStudent",
  "deleteStudent",
  "batchDeleteStudents",
  "resetPassword",
  "changePassword",
  "changeAdminPassword",
  "loginAdmin",
  "loginStudent",
  "getStudentSelf",
  "getMyRequests",
  "logout",
  "upsertMyUser",
  "getRequests",
  "addRequest",
  "approveRequest",
  "rejectRequest",
  "getAccounts",
  "syncAccounts",
  "getStats",
  "importStudents",
  "getAdmins",
  "addAdmin",
  "updateAdmin",
  "deleteAdmin",
  "resetAdminPassword",
  "initDefaultAdmin",
  "getTips",
  "getAllTips",
  "updateTip",
  "deleteTip",
  "getClasses",
  "importAdmins",
  "repairCourseDates",
  "exportAll"
];
const EXPECTED_SETS = "// 免鉴权 action（登录/学员自助）\nconst PUBLIC_ACTIONS = new Set(['loginAdmin', 'loginStudent', 'changePassword', 'getTips', 'addRequest']);\n// 登录前可调用（必须验证原密码，且有限速）\nconst PRELOGIN_ACTIONS = new Set(['changeAdminPassword']);\n// 学员会话可访问的 action\nconst STUDENT_ACTIONS = new Set(['getStudentSelf', 'getMyRequests', 'upsertMyUser']);\n// 仅超管（或服务端）可访问\nconst SUPERADMIN_ACTIONS = new Set(['addAdmin', 'updateAdmin', 'deleteAdmin', 'resetAdminPassword', 'importAdmins', 'initDefaultAdmin', 'exportAll', 'repairCourseDates']);";
const EXPECTED_GATE = "  // ====== 调用方鉴权 ======\n  const secretOk = !!(SERVER_SECRET && typeof secret === 'string' && safeStrEqual(secret, SERVER_SECRET));\n  let session = await getSession(token);\n  if (PRELOGIN_ACTIONS.has(action)) {\n    // 登录前改密：无会话时必须提供 phone+原密码（有限速），有会话时用会话身份\n    if (!secretOk && !session) {\n      const d0 = data || {};\n      if (!d0.phone || !d0.oldPassword) {\n        return { success: false, code: 'UNAUTHORIZED', message: '请先登录' };\n      }\n    }\n  } else if (!PUBLIC_ACTIONS.has(action)) {\n    if (!secretOk && !session) {\n      return { success: false, code: 'UNAUTHORIZED', message: '未登录或登录已过期' };\n    }\n    if (!secretOk && (!session || session.type !== 'admin')) {\n      if (!STUDENT_ACTIONS.has(action)) {\n        return { success: false, code: 'FORBIDDEN', message: '需要管理员权限' };\n      }\n    }\n    if (SUPERADMIN_ACTIONS.has(action) && !secretOk && (!session || session.role !== 'superadmin')) {\n      return { success: false, code: 'FORBIDDEN', message: '需要超级管理员权限' };\n    }\n    // 首登强制改密：未改密的管理员会话只能改密/退出\n    if (!secretOk && session && session.type === 'admin' && session.mustChangePassword\n        && action !== 'changeAdminPassword' && action !== 'logout') {\n      return { success: false, code: 'FORCE_PASSWORD_CHANGE', message: '请先修改初始密码' };\n    }\n  }";
const EXPECTED_DISPATCH = "  const handler = HANDLERS[action];\n  if (!handler) return { success: false, message: '未知操作: ' + action };\n  return handler({ event, data, id, status, reason, keyword, token, secret, session, secretOk });";

const failures = [];
const keys = [...src.matchAll(/^    (\w+): async \(ctx\) => \{$/gm)].map(m => m[1]);
if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_ACTIONS)) failures.push('HANDLERS 名单/顺序与基线不一致: got ' + JSON.stringify(keys));
if (new Set(keys).size !== keys.length) failures.push('HANDLERS 名单有重复');
if (!src.includes(EXPECTED_SETS)) failures.push('鉴权四集合与基线不逐字');
if (!src.includes(EXPECTED_GATE)) failures.push('调用方鉴权块与基线不逐字');
if (!src.includes(EXPECTED_DISPATCH)) failures.push('分发/兜底与基线不逐字');
if ((src.match(/未知操作/g) || []).length !== 1) failures.push('未知操作 文案出现次数≠1');
if (/switch\s*\(action\)/.test(src)) failures.push('switch(action) 仍在（R12 未完成）');
if ((src.match(/^    default:/gm) || []).length !== 0) failures.push('default 标签仍在');

if (failures.length) {
  console.error('check-adminapi-actions FAIL');
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log('check-adminapi-actions OK: 37 actions 名单顺序一致 / 鉴权四集合逐字 / 鉴权块逐字 / 分发兜底逐字 / switch+default 清零');
