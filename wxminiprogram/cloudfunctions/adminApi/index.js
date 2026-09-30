const cloud = require('wx-server-sdk');
const XLSX = require('xlsx');
const crypto = require('crypto');
cloud.init({ env: 'cloud1-d6gio7v8iff39bab7' });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// ====== 鉴权配置 ======
// 服务端调用方（admin-server / Cloudflare Worker）需携带 secret（云函数环境变量 ADMIN_API_SECRET）
// 小程序端调用 admin 需携带 loginAdmin 签发的 token
const SERVER_SECRET = process.env.ADMIN_API_SECRET || '';
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;

// 免鉴权 action（登录/学员自助）
const PUBLIC_ACTIONS = new Set(['loginAdmin', 'loginStudent', 'changePassword', 'getTips', 'addRequest']);
// 登录前可调用（必须验证原密码，且有限速）
const PRELOGIN_ACTIONS = new Set(['changeAdminPassword']);
// 学员会话可访问的 action
const STUDENT_ACTIONS = new Set(['getStudentSelf', 'getMyRequests', 'upsertMyUser']);
// 仅超管（或服务端）可访问
const SUPERADMIN_ACTIONS = new Set(['addAdmin', 'updateAdmin', 'deleteAdmin', 'resetAdminPassword', 'importAdmins', 'initDefaultAdmin', 'exportAll']);

// 登录/改密限速（复审 #9：持久化到 rate_limits 集合 —— 多实例共享、重启不清零，无需 Redis）
// 阈值：10 分钟窗口内失败 5 次 → 锁定 10 分钟；过期记录在下次命中时懒清理
// 并发写为读-改写（极端并发可能少计一次失败，属可接受的尽力而为）
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_FAILS = 5;
let rateCollReady = false;
async function ensureRateColl() {
  if (rateCollReady) return;
  await db.createCollection('rate_limits').catch(() => {});
  rateCollReady = true;
}
function rateDocId(key) {
  // 云数据库 _id 只允许字母数字_-()@$.，其余字符转义，保证同一 key 稳定映射
  return String(key).replace(/[^A-Za-z0-9_\-()@$.]/g, c => '_' + c.charCodeAt(0));
}
async function rateLimited(key) {
  try {
    await ensureRateColl();
    const id = rateDocId(key);
    const r = await db.collection('rate_limits').doc(id).get().catch(() => null);
    const rec = r && r.data;
    if (!rec) return false;
    const now = Date.now();
    if (rec.until > now) return true;
    if (now - rec.first > RATE_WINDOW_MS) await db.collection('rate_limits').doc(id).remove().catch(() => {});
    return false;
  } catch (e) {
    return false; // 限速存储异常不阻断登录（可用性优先）
  }
}
async function recordFail(key) {
  try {
    await ensureRateColl();
    const now = Date.now();
    const id = rateDocId(key);
    const r = await db.collection('rate_limits').doc(id).get().catch(() => null);
    let rec = r && r.data;
    if (!rec || now - rec.first > RATE_WINDOW_MS) {
      rec = { count: 1, first: now, until: 0 };
    } else {
      rec.count++;
      if (rec.count >= RATE_MAX_FAILS) rec.until = now + RATE_WINDOW_MS;
    }
    await db.collection('rate_limits').doc(id).set({ data: rec });
  } catch (e) { /* 记录失败不阻断主流程 */ }
}
async function clearFails(key) {
  try {
    await ensureRateColl();
    await db.collection('rate_limits').doc(rateDocId(key)).remove().catch(() => {});
  } catch (e) { /* 清理失败可容忍 */ }
}

// ====== 密码哈希（scrypt，兼容旧明文） ======
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(stored, input) {
  if (stored === undefined || stored === null || stored === '') return false;
  const s = String(stored);
  if (s.startsWith('scrypt$')) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    const test = crypto.scryptSync(String(input), parts[1], 32).toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(parts[2], 'hex'), Buffer.from(test, 'hex'));
    } catch (e) { return false; }
  }
  // 旧版明文
  return s === String(input);
}
function needsRehash(stored) {
  return typeof stored === 'string' && !stored.startsWith('scrypt$');
}

// ====== 会话 ======
async function createSession(payload) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('sessions').add({
    data: { token, ...payload, expiresAt: Date.now() + TOKEN_TTL, createdAt: new Date() }
  });
  // 约 5% 概率顺手清理过期会话，避免 sessions 集合无限膨胀（#14）
  if (Math.random() < 0.05) {
    db.collection('sessions').where({ expiresAt: db.command.lt(Date.now()) }).remove().catch(() => {});
  }
  return token;
}
async function getSession(token) {
  if (!token || typeof token !== 'string') return null;
  const res = await db.collection('sessions').where({ token }).limit(1).get();
  const s = res.data[0];
  if (!s) return null;
  if (!s.expiresAt || s.expiresAt < Date.now()) {
    await db.collection('sessions').doc(s._id).remove().catch(() => {});
    return null;
  }
  if (s.type === 'admin') {
    // 角色/负责班级以 admins 表为准实时刷新：改权限后无需等会话过期（班级隔离依赖此项）
    try {
      const a = await db.collection('admins').where({ phone: s.phone }).limit(1).get();
      if (a.data[0]) {
        s.role = a.data[0].role || 'admin';
        s.classes = a.data[0].classes || [];
      }
    } catch (e) { /* 读取失败时沿用会话内缓存 */ }
  }
  return s;
}
async function revokeSessions(phone, type) {
  const res = await db.collection('sessions').where({ phone, type }).get();
  for (const s of res.data) {
    await db.collection('sessions').doc(s._id).remove().catch(() => {});
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function stripSecrets(doc) {
  if (!doc) return doc;
  const { password, ...rest } = doc;
  return rest;
}

// 进校申请是否已过有效期：approved 且当前时间超过 进校日期+结束时间（无进校日期的旧申请视为过期）
function isRequestExpired(r) {
  if (!r || r.status !== 'approved') return false;
  if (!r.entryDate) return true;
  const endStr = (r.entryDate + ' ' + (r.entryEndTime || '23:59')).replace(/-/g, '/');
  return Date.now() > new Date(endStr).getTime();
}

// 计时安全字符串比较（用于 secret 比对）
function safeStrEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 班级隔离身份：小程序端取会话，Web 端由 Express 从登录态透传 actorRole/actorClasses。
// 豁免只认 role==='superadmin'，绝不因 secret 放行；无身份信息（服务端内部 secret 调用）不过滤。
function getActor(event, session) {
  if (session && session.type === 'admin') {
    return { role: session.role || 'admin', classes: Array.isArray(session.classes) ? session.classes : [] };
  }
  const r = event.actorRole;
  if (r) {
    const c = event.actorClasses;
    return { role: r, classes: Array.isArray(c) ? c : (typeof c === 'string' && c ? c.split(/[,，\s]+/) : []) };
  }
  return null;
}
function classFiltered(actor) {
  return !!(actor && actor.role !== 'superadmin' && Array.isArray(actor.classes) && actor.classes.length > 0);
}

// ====== 统计辅助（复审 #7：用 count/aggregate 代替全量拉内存） ======
async function countOf(coll, where) {
  let q = db.collection(coll);
  if (where) q = q.where(where);
  const r = await q.count();
  return r.total;
}
// 班级名单（超管全量场景）：aggregate group 无 1000 上限；失败回退字段裁剪拉取
async function classNamesAggregate() {
  try {
    const res = await db.collection('students').aggregate().group({ _id: '$className', n: $.sum(1) }).end();
    return res.data.map(g => g._id).filter(Boolean).sort();
  } catch (e) {
    const r = await db.collection('students').field({ className: true }).limit(1000).get();
    return [...new Set(r.data.map(s => s.className).filter(Boolean))];
  }
}

exports.main = async (event, context) => {
  const { action, data, id, status, reason, keyword, token, secret } = event;

  // ====== 调用方鉴权 ======
  const secretOk = !!(SERVER_SECRET && typeof secret === 'string' && safeStrEqual(secret, SERVER_SECRET));
  let session = await getSession(token);
  if (PRELOGIN_ACTIONS.has(action)) {
    // 登录前改密：无会话时必须提供 phone+原密码（有限速），有会话时用会话身份
    if (!secretOk && !session) {
      const d0 = data || {};
      if (!d0.phone || !d0.oldPassword) {
        return { success: false, code: 'UNAUTHORIZED', message: '请先登录' };
      }
    }
  } else if (!PUBLIC_ACTIONS.has(action)) {
    if (!secretOk && !session) {
      return { success: false, code: 'UNAUTHORIZED', message: '未登录或登录已过期' };
    }
    if (!secretOk && (!session || session.type !== 'admin')) {
      if (!STUDENT_ACTIONS.has(action)) {
        return { success: false, code: 'FORBIDDEN', message: '需要管理员权限' };
      }
    }
    if (SUPERADMIN_ACTIONS.has(action) && !secretOk && (!session || session.role !== 'superadmin')) {
      return { success: false, code: 'FORBIDDEN', message: '需要超级管理员权限' };
    }
    // 首登强制改密：未改密的管理员会话只能改密/退出
    if (!secretOk && session && session.type === 'admin' && session.mustChangePassword
        && action !== 'changeAdminPassword' && action !== 'logout') {
      return { success: false, code: 'FORCE_PASSWORD_CHANGE', message: '请先修改初始密码' };
    }
  }

  switch (action) {
    // ====== 学员管理 ======
    case 'getStudents': {
      const actor = getActor(event, session);
      const conds = [];
      if (classFiltered(actor)) conds.push({ className: _.in(actor.classes) });
      if (keyword) {
        const reg = db.RegExp({ regexp: escapeRegex(keyword), options: 'i' });
        conds.push(_.or([
          { name: reg },
          { phone: reg },
          { className: reg }
        ]));
      }
      let query = db.collection('students');
      if (conds.length === 1) query = query.where(conds[0]);
      else if (conds.length > 1) query = query.where(_.and(conds));
      const count = await query.count();
      const limit = Math.min(count.total, 1000);
      const result = await query.orderBy('createdAt', 'desc').limit(limit).get();
      return { success: true, data: result.data.map(stripSecrets), total: count.total, truncated: result.data.length < count.total };
    }

    case 'getStudent': {
      if (!id) return { success: false, message: '缺少学员ID' };
      const stu = await db.collection('students').doc(id).get().catch(() => null);
      if (!stu || !stu.data) return { success: false, message: '学员不存在' };
      return { success: true, data: stripSecrets(stu.data) };
    }

    case 'addStudent': {
      const { name, phone, className, schedule, deadline, location, courseDates, courseStartDate, courseEndDate, idCard, company } = data;
      if (!name || !phone || !className || !schedule || !location) {
        return { success: false, message: '请填写所有必填字段' };
      }
      // 初始密码：身份证后6位，没身份证用手机后6位
      const initPassword = (idCard && idCard.length >= 6) ? idCard.slice(-6) : phone.slice(-6);
      const existing = await db.collection('students').where({ phone }).get();
      if (existing.data.length > 0) {
        await db.collection('students').doc(existing.data[0]._id).update({
          data: { name, className, schedule, deadline: deadline || '', location, courseDates: courseDates || [], courseStartDate: courseStartDate || '', courseEndDate: courseEndDate || '', idCard: idCard || '', company: company || '', updatedAt: new Date() }
        });
        return { success: true, message: '学员信息已更新', id: existing.data[0]._id };
      }
      const res = await db.collection('students').add({
        data: { name, phone, className, schedule, deadline: deadline || '', location, courseDates: courseDates || [], courseStartDate: courseStartDate || '', courseEndDate: courseEndDate || '', idCard: idCard || '', company: company || '', password: hashPassword(initPassword), mustChangePassword: true, createdAt: new Date() }
      });
      return { success: true, message: '学员添加成功', id: res._id, initPassword };
    }

    case 'updateStudent': {
      const { _id, name, phone, className, schedule, deadline, location, courseDates, courseStartDate, courseEndDate, idCard, company } = data;
      if (!_id) return { success: false, message: '缺少学员ID' };
      const updateData = { name, phone, className, schedule, deadline: deadline || '', location, courseDates: courseDates || [], courseStartDate: courseStartDate || '', courseEndDate: courseEndDate || '', updatedAt: new Date() };
      if (idCard !== undefined) updateData.idCard = idCard;
      if (company !== undefined) updateData.company = company;
      await db.collection('students').doc(_id).update({ data: updateData });
      return { success: true, message: '学员信息已更新' };
    }

    case 'deleteStudent': {
      if (!id) return { success: false, message: '缺少学员ID' };
      await db.collection('students').doc(id).remove();
      return { success: true, message: '删除成功' };
    }

    case 'batchDeleteStudents': {
      const { ids } = data;
      if (!ids || ids.length === 0) return { success: false, message: '请选择要删除的学员' };
      try {
        // 一条语句批量删（复审 #7）；个别环境不支持 _id + _.in 时回退逐条删
        await db.collection('students').where({ _id: _.in(ids) }).remove();
      } catch (e) {
        for (const id of ids) {
          await db.collection('students').doc(id).remove();
        }
      }
      return { success: true, message: `成功删除 ${ids.length} 名学员` };
    }

    // ====== 密码管理 ======
    case 'resetPassword': {
      const stuId = id;
      if (!stuId) return { success: false, message: '缺少学员ID' };
      const stu = await db.collection('students').doc(stuId).get();
      if (!stu.data) return { success: false, message: '学员不存在' };
      const idCard = stu.data.idCard || '';
      const phone = stu.data.phone || '';
      const newPwd = (idCard.length >= 6) ? idCard.slice(-6) : phone.slice(-6);
      await db.collection('students').doc(stuId).update({
        data: { password: hashPassword(newPwd), mustChangePassword: true }
      });
      await revokeSessions(phone, 'student');
      return { success: true, message: '密码已重置', newPassword: newPwd };
    }

    case 'changePassword': {
      const stuPhone = (data && data.phone) || event.phone;
      const oldPassword = (data && data.oldPassword) || event.oldPassword;
      const newPassword = (data && data.newPassword) || event.newPassword;
      if (!stuPhone || !oldPassword || !newPassword) return { success: false, message: '请填写完整信息' };
      if (newPassword.length < 6) return { success: false, message: '新密码至少6位' };
      const limiterKey = 'pwd:' + stuPhone;
      if (await rateLimited(limiterKey)) return { success: false, message: '尝试次数过多，请10分钟后再试' };
      const stuRes = await db.collection('students').where({ phone: stuPhone }).get();
      if (stuRes.data.length === 0) return { success: false, message: '学员不存在' };
      const stuData = stuRes.data[0];
      if (!verifyPassword(stuData.password, oldPassword)) {
        await recordFail(limiterKey);
        return { success: false, message: '原密码错误' };
      }
      await clearFails(limiterKey);
      await db.collection('students').doc(stuData._id).update({
        data: { password: hashPassword(newPassword), mustChangePassword: false }
      });
      await revokeSessions(stuPhone, 'student');
      return { success: true, message: '密码修改成功' };
    }

    case 'changeAdminPassword': {
      // 会话内改密用会话身份；登录前改密必须提供 phone+原密码（有限速）
      const aPhone = session ? session.phone : (data && data.phone);
      const oldPassword = data && data.oldPassword;
      const newPassword = data && data.newPassword;
      if (!aPhone || !oldPassword || !newPassword) return { success: false, message: '请填写完整信息' };
      if (newPassword.length < 8) return { success: false, message: '新密码至少8位' };
      const limiterKey = 'apwd:' + aPhone;
      if (await rateLimited(limiterKey)) return { success: false, message: '尝试次数过多，请10分钟后再试' };
      const adminRes = await db.collection('admins').where({ phone: aPhone }).get();
      if (adminRes.data.length === 0) return { success: false, message: '账号不存在' };
      const adminDoc = adminRes.data[0];
      if (!verifyPassword(adminDoc.password, oldPassword)) {
        await recordFail(limiterKey);
        return { success: false, message: '原密码错误' };
      }
      await clearFails(limiterKey);
      await db.collection('admins').doc(adminDoc._id).update({
        data: { password: hashPassword(newPassword), mustChangePassword: false, updatedAt: new Date() }
      });
      await revokeSessions(aPhone, 'admin');
      return { success: true, message: '密码修改成功' };
    }

    // ====== 登录 ======
    case 'loginAdmin': {
      const { phone: aPhone, password: aPwd } = data || {};
      if (!aPhone || !aPwd) return { success: false, message: '请输入账号和密码' };
      const limiterKey = 'admin:' + aPhone;
      if (await rateLimited(limiterKey)) return { success: false, message: '尝试次数过多，请10分钟后再试' };
      let adminRes = await db.collection('admins').where({ phone: aPhone }).limit(1).get();
      // 首次部署引导：admins 集合为空时，用初始账号 admin/admin123 创建默认管理员（强制改密）
      if (adminRes.data.length === 0) {
        const cnt = await db.collection('admins').count();
        if (cnt.total === 0 && aPhone === 'admin' && aPwd === 'admin123') {
          await db.collection('admins').add({
            data: { name: '系统管理员', phone: 'admin', password: hashPassword('admin123'), role: 'superadmin', mustChangePassword: true, createdAt: new Date() }
          });
          adminRes = await db.collection('admins').where({ phone: aPhone }).limit(1).get();
        }
      }
      if (adminRes.data.length === 0 || !verifyPassword(adminRes.data[0].password, aPwd)) {
        await recordFail(limiterKey);
        return { success: false, message: '账号或密码错误' };
      }
      await clearFails(limiterKey);
      const admin = adminRes.data[0];
      if (needsRehash(admin.password)) {
        await db.collection('admins').doc(admin._id).update({ data: { password: hashPassword(aPwd) } });
      }
      // 普通管理员首登强制改密；超管豁免。唯一例外：默认账号 admin 仍强制一次（部署后立即改默认口令的加固）
      const role = admin.role || 'admin';
      const mustChange = !!admin.mustChangePassword && (role !== 'superadmin' || admin.phone === 'admin');
      const t = await createSession({ type: 'admin', phone: admin.phone, name: admin.name, role, classes: admin.classes || [], mustChangePassword: mustChange });
      return {
        success: true,
        data: { _id: admin._id, name: admin.name, phone: admin.phone, role, classes: admin.classes || [], mustChangePassword: mustChange, token: t }
      };
    }

    case 'loginStudent': {
      const { phone: sPhone, password: sPwd } = data || {};
      if (!sPhone || !sPwd) return { success: false, message: '请输入账号和密码' };
      const limiterKey = 'stu:' + sPhone;
      if (await rateLimited(limiterKey)) return { success: false, message: '尝试次数过多，请10分钟后再试' };
      const stuRes = await db.collection('students').where({ phone: sPhone }).limit(1).get();
      const stu = stuRes.data[0];
      if (!stu) {
        return { success: false, message: '未找到学员信息，请先咨询报名' };
      }
      // 无密码字段时按初始密码规则回退：身份证后6位，没身份证用手机后6位
      const legacyPwd = (stu.idCard && stu.idCard.length >= 6) ? stu.idCard.slice(-6) : sPhone.slice(-6);
      const stored = (stu.password !== undefined && stu.password !== null && stu.password !== '') ? stu.password : legacyPwd;
      if (!verifyPassword(stored, sPwd)) {
        await recordFail(limiterKey);
        return { success: false, message: '账号或密码错误' };
      }
      await clearFails(limiterKey);
      if (needsRehash(stored)) {
        await db.collection('students').doc(stu._id).update({ data: { password: hashPassword(sPwd) } });
      }
      const t = await createSession({ type: 'student', phone: stu.phone });
      const safe = stripSecrets(stu);
      delete safe.mustChangePassword;
      return { success: true, data: { ...safe, mustChangePassword: !!stu.mustChangePassword, token: t } };
    }

    case 'getStudentSelf': {
      if (!session || !session.phone) return { success: false, code: 'UNAUTHORIZED', message: '未登录' };
      const stuRes = await db.collection('students').where({ phone: session.phone }).limit(1).get();
      if (stuRes.data.length === 0) return { success: false, message: '学员不存在' };
      return { success: true, data: stripSecrets(stuRes.data[0]) };
    }

    case 'getMyRequests': {
      if (!session || !session.phone) return { success: false, code: 'UNAUTHORIZED', message: '未登录' };
      const result = await db.collection('entry_requests')
        .where({ phone: session.phone })
        .orderBy('createdAt', 'desc')
        .limit(data && data.limit ? data.limit : 50)
        .get();
      return { success: true, data: result.data.map(r => ({ ...r, isExpired: isRequestExpired(r) })) };
    }

    case 'logout': {
      if (session) await db.collection('sessions').doc(session._id).remove().catch(() => {});
      return { success: true, message: '已退出登录' };
    }

    case 'upsertMyUser': {
      if (!session || !session.phone) return { success: false, code: 'UNAUTHORIZED', message: '未登录' };
      const uRes = await db.collection('users').where({ phone: session.phone }).limit(1).get();
      if (uRes.data.length > 0) {
        return { success: true, data: stripSecrets(uRes.data[0]) };
      }
      const stuRes = await db.collection('students').where({ phone: session.phone }).limit(1).get();
      const stu = stuRes.data[0] || {};
      const addRes = await db.collection('users').add({
        data: { phone: session.phone, name: stu.name || session.phone, role: 'student', createdAt: new Date() }
      });
      const created = await db.collection('users').doc(addRes._id).get();
      return { success: true, data: stripSecrets(created.data) };
    }

    // ====== 入校申请 ======
    case 'getRequests': {
      const actor = getActor(event, session);
      const conds = [];
      if (status && status !== 'all') conds.push({ status });
      if (classFiltered(actor)) {
        // entry_requests 无班级字段：先取本班学生手机号，再按 phone 关联过滤
        const stuRes = await db.collection('students').where({ className: _.in(actor.classes) }).limit(1000).get();
        const phones = [...new Set(stuRes.data.map(s => s.phone))];
        if (phones.length === 0) return { success: true, data: [] };
        conds.push({ phone: _.in(phones) });
      }
      let query = db.collection('entry_requests');
      if (conds.length === 1) query = query.where(conds[0]);
      else if (conds.length > 1) query = query.where(_.and(conds));
      const count = await query.count();
      const result = await query.orderBy('createdAt', 'desc').limit(200).get();
      return { success: true, data: result.data.map(r => ({ ...r, isExpired: isRequestExpired(r) })), total: count.total, truncated: result.data.length < count.total };
    }

    case 'addRequest': {
      const { name, phone, carPlate, entryDate, entryStartTime, entryEndTime } = data;
      if (!name || !phone) return { success: false, message: '请填写姓名和电话' };
      if (!entryDate || !entryStartTime || !entryEndTime) return { success: false, message: '请选择进校日期和时间段' };
      const pendingRes = await db.collection('entry_requests').where({ phone, status: 'pending' }).limit(1).get();
      if (pendingRes.data.length > 0) return { success: false, message: '您已有待审核的申请' };
      await db.collection('entry_requests').add({
        data: {
          name, phone, carPlate: carPlate || '',
          entryDate, entryStartTime, entryEndTime,
          status: 'pending', createdAt: new Date()
        }
      });
      return { success: true, message: '申请已提交' };
    }

    case 'approveRequest': {
      if (!id) return { success: false, message: '缺少申请ID' };
      await db.collection('entry_requests').doc(id).update({
        data: { status: 'approved', processedAt: new Date() }
      });
      return { success: true, message: '已通过' };
    }

    case 'rejectRequest': {
      if (!id) return { success: false, message: '缺少申请ID' };
      await db.collection('entry_requests').doc(id).update({
        data: { status: 'rejected', rejectReason: reason || '', processedAt: new Date() }
      });
      return { success: true, message: '已拒绝' };
    }

    // ====== 账户管理 ======
    case 'getAccounts': {
      const count = await db.collection('users').count();
      const result = await db.collection('users').orderBy('createdAt', 'desc').limit(200).get();
      return { success: true, data: result.data.map(stripSecrets), total: count.total, truncated: result.data.length < count.total };
    }

    case 'syncAccounts': {
      const studentsRes = await db.collection('students').limit(1000).get();
      const accountsRes = await db.collection('users').limit(1000).get();
      const students = studentsRes.data;
      const accounts = accountsRes.data;
      let count = 0;
      for (const s of students) {
        if (!accounts.find(a => a.phone === s.phone)) {
          await db.collection('users').add({
            data: {
              phone: s.phone, name: s.name, role: 'student',
              password: hashPassword((s.idCard && s.idCard.length >= 6) ? s.idCard.slice(-6) : s.phone.slice(-6)), createdAt: new Date()
            }
          });
          count++;
        }
      }
      return { success: true, message: `同步了 ${count} 个新账户` };
    }

    // ====== 统计 ======
    case 'getStats': {
      const actor = getActor(event, session);
      const filtered = classFiltered(actor);
      const today = new Date().toISOString().slice(0, 10);
      const dayStart = new Date(Date.parse(today + 'T00:00:00.000Z'));
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const createdAtRange = _.and(_.gte(dayStart), _.lt(dayEnd));

      // 班级受限管理员：拉本班学员明细（字段裁剪）做本班口径；超管全量走 count（复审 #7）
      let students = null;
      if (filtered) {
        students = (await db.collection('students')
          .where({ className: _.in(actor.classes) })
          .field({ phone: 1, className: 1, deadline: 1, createdAt: 1 })
          .limit(1000).get()).data;
      }
      const studentCount = filtered ? students.length : await countOf('students');

      // 入校申请按状态 count；受限管理员先取本班手机号做关联过滤
      const reqPhones = filtered ? [...new Set(students.map(s => s.phone))] : null;
      const reqConds = extra => {
        const conds = [...(extra || [])];
        if (filtered) conds.push({ phone: _.in(reqPhones) });
        return conds.length === 1 ? conds[0] : _.and(...conds);
      };
      const pendingRequestCount = await countOf('entry_requests', reqConds([{ status: 'pending' }]));
      const approvedCount = await countOf('entry_requests', reqConds([{ status: 'approved' }]));
      const rejectedCount = await countOf('entry_requests', reqConds([{ status: 'rejected' }]));
      const todayRequests = await countOf('entry_requests', reqConds([{ createdAt: createdAtRange }]));

      let todayStudents, activeStudents, expiredStudents, classNames;
      if (filtered) {
        todayStudents = students.filter(s => s.createdAt && new Date(s.createdAt).toISOString().slice(0, 10) === today).length;
        activeStudents = students.filter(s => s.deadline && s.deadline >= today).length;
        expiredStudents = students.filter(s => s.deadline && s.deadline < today).length;
        // 保持原插入顺序（测试矩阵断言顺序）
        classNames = [...new Set(students.map(s => s.className))];
      } else {
        todayStudents = await countOf('students', { createdAt: createdAtRange });
        // deadline 为 YYYY-MM-DD 字符串，字典序即时间序；排除空串与缺失字段
        activeStudents = await countOf('students', { deadline: _.gte(today) });
        expiredStudents = await countOf('students', { deadline: _.and(_.gt(''), _.lt(today)) });
        classNames = await classNamesAggregate();
      }
      const accountCount = await countOf('users');

      return {
        success: true,
        data: {
          studentCount,
          pendingRequestCount,
          approvedCount,
          rejectedCount,
          accountCount,
          todayStudents,
          todayRequests,
          activeStudents,
          expiredStudents,
          classCount: classNames.length,
          classNames
        }
      };
    }

    // ====== 批量导入 ======
    case 'importStudents': {
      const { fileID } = event;
      if (!fileID) return { success: false, message: '缺少文件ID' };

      // 下载文件
      const downloadRes = await cloud.downloadFile({ fileID });
      const workbook = XLSX.read(downloadRes.fileContent, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] || [];

      // 自动识别表头
      const fieldMap = {};
      const aliases = {
        name: ['姓名', '名字', 'name', '学员姓名', '学生姓名'],
        phone: ['联系电话', '手机号', '手机', '电话', 'phone', '手机号码'],
        className: ['班级名称', '班级', '课程名称', '课程', 'className'],
        schedule: ['上课时间段', '上课时间', '时间', 'schedule', '时间段'],
        courseStartDate: ['课程开始日期', '开始日期', '课程开始', 'courseStartDate'],
        courseEndDate: ['课程结束日期', '结束日期', '课程结束', 'courseEndDate'],
        deadline: ['上课截止时间', '截止时间', '截止', 'deadline'],
        location: ['上课地点', '地点', 'location', '教室'],
        idCard: ['身份证号', '身份证', '证件号', 'idCard'],
        company: ['工作单位', '单位', '公司', 'company']
      };
      headers.forEach((h, i) => {
        const header = String(h).trim();
        for (const [field, names] of Object.entries(aliases)) {
          if (names.some(n => header.includes(n))) { fieldMap[field] = i; break; }
        }
      });

      function getVal(row, field) {
        const idx = fieldMap[field];
        if (idx === undefined) return '';
        const val = row[Object.keys(row)[idx]];
        return val !== undefined ? String(val).trim() : '';
      }

      // 将Excel日期值（字符串或序列号数字）转为 Date 对象
      function parseExcelDate(val) {
        if (!val) return null;
        if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
        const s = String(val).trim();
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) return new Date(s.replace(/-/g, '/'));
        return null;
      }
      function formatDateStr(d) {
        if (!d || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      }

      // 生成排课日期
      function generateCourseDates(schedule, startDate, endDate) {
        if (!schedule || !startDate || !endDate) return [];
        const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 };
        let targetDay = -1;
        for (const [key, val] of Object.entries(dayMap)) {
          if (schedule.includes(key)) { targetDay = val; break; }
        }
        if (targetDay < 0) return [];
        const timeMatch = schedule.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
        const timeSlot = timeMatch ? timeMatch[0] : schedule;
        const start = parseExcelDate(startDate);
        const end = parseExcelDate(endDate);
        if (!start || !end) return [];
        const dates = [];
        const d = new Date(start);
        while (d.getDay() !== targetDay && d <= end) d.setDate(d.getDate() + 1);
        while (d <= end) {
          dates.push({ date: formatDateStr(d), timeSlot });
          d.setDate(d.getDate() + 7);
        }
        return dates;
      }

      // 支持逗号分隔的多时间段
      function generateCourseDatesMulti(schedule, startDate, endDate) {
        const allDates = [];
        const parts = schedule.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        parts.forEach(part => {
          const dates = generateCourseDates(part, startDate, endDate);
          allDates.push(...dates);
        });
        allDates.sort((a, b) => a.date.localeCompare(b.date));
        return allDates;
      }

      let added = 0, updated = 0, failed = 0;
      const errors = [];

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        const rowNum = i + 2;
        try {
          const name = getVal(row, 'name');
          const phone = getVal(row, 'phone');
          const idCard = getVal(row, 'idCard');
          const company = getVal(row, 'company');
          const className = getVal(row, 'className');
          const schedule = getVal(row, 'schedule');
          const courseStartDate = getVal(row, 'courseStartDate');
          const courseEndDate = getVal(row, 'courseEndDate');
          const deadline = getVal(row, 'deadline');
          const location = getVal(row, 'location');

          if (!name) { errors.push(`第${rowNum}行：姓名为空`); failed++; continue; }
          if (!phone || phone.length !== 11) { errors.push(`第${rowNum}行：手机号格式错误`); failed++; continue; }
          if (!className) { errors.push(`第${rowNum}行：班级名称为空`); failed++; continue; }
          if (!schedule) { errors.push(`第${rowNum}行：上课时间段为空`); failed++; continue; }
          if (!location) { errors.push(`第${rowNum}行：上课地点为空`); failed++; continue; }

          const courseDates = generateCourseDatesMulti(schedule, courseStartDate, courseEndDate);
          const startStr = formatDateStr(parseExcelDate(courseStartDate)) || String(courseStartDate || '');
          const endStr = formatDateStr(parseExcelDate(courseEndDate)) || String(courseEndDate || '');
          const studentData = { name, phone, idCard: idCard || '', company: company || '', className, schedule, deadline: endStr || '', location, courseDates, courseStartDate: startStr, courseEndDate: endStr };

          const existing = await db.collection('students').where({ phone }).get();
          if (existing.data.length > 0) {
            await db.collection('students').doc(existing.data[0]._id).update({
              data: { ...studentData, updatedAt: new Date() }
            });
            updated++;
          } else {
            const initPwd = (idCard && idCard.length >= 6) ? idCard.slice(-6) : phone.slice(-6);
            await db.collection('students').add({
              data: { ...studentData, password: hashPassword(initPwd), mustChangePassword: true, createdAt: new Date() }
            });
            added++;
          }
        } catch (err) {
          errors.push(`第${rowNum}行：${err.message}`);
          failed++;
        }
      }

      return { success: true, total: jsonData.length, added, updated, failed, errors };
    }

    // ====== 管理员管理 ======
    case 'getAdmins': {
      const result = await db.collection('admins').orderBy('createdAt', 'desc').get();
      return { success: true, data: result.data.map(stripSecrets) };
    }

    case 'addAdmin': {
      const { name: aName, phone: aPhone2, password: aPwd2, role, classes: aClasses } = data || {};
      if (!aName || !aPhone2) return { success: false, message: '请填写姓名和账号' };
      const exists = await db.collection('admins').where({ phone: aPhone2 }).get();
      if (exists.data.length > 0) return { success: false, message: '该账号已存在' };
      // 未填密码时：账号=手机号，密码=手机号；由超管创建 → 首次登录强制改密
      await db.collection('admins').add({
        data: { name: aName, phone: aPhone2, password: hashPassword(String(aPwd2 || '').trim() || aPhone2), role: role || 'admin', classes: aClasses || [], mustChangePassword: true, createdAt: new Date() }
      });
      return { success: true, message: '添加成功' };
    }

    case 'updateAdmin': {
      const { _id, name: uName, phone: uPhone, password: uPwd, role: uRole, classes: uClasses } = data || {};
      if (!_id) return { success: false, message: '缺少管理员ID' };
      let oldDoc = null;
      try { const d = await db.collection('admins').doc(_id).get(); oldDoc = d.data || null; } catch (e) { oldDoc = null; }
      if (!oldDoc) return { success: false, message: '管理员不存在' };
      const oldPhone = oldDoc.phone;
      // 局部更新：未传的字段绝不写（否则 `uRole || 'admin'` 会把超管静默降权）
      const updateData = {};
      if (uName !== undefined) updateData.name = uName;
      if (uPhone !== undefined) updateData.phone = uPhone;
      if (uRole !== undefined) updateData.role = uRole;
      if (uClasses !== undefined) updateData.classes = uClasses;
      if (uPwd) {
        updateData.password = hashPassword(uPwd);
        // 超管下发的是临时密码 → 对方下次登录需改密（默认账号 admin 会被强制，其余超管豁免）
        updateData.mustChangePassword = true;
      }
      await db.collection('admins').doc(_id).update({ data: updateData });
      const phoneChanged = !!(uPhone && oldPhone && uPhone !== oldPhone);
      if (uPwd || phoneChanged) {
        // 必须吊销【旧手机号】会话：改号时旧号下的会话全部失效，改密时同号即旧号
        if (oldPhone) await revokeSessions(oldPhone, 'admin');
        if (uPwd && phoneChanged && uPhone) await revokeSessions(uPhone, 'admin');
      }
      return { success: true, message: '更新成功' };
    }

    case 'deleteAdmin': {
      if (!id) return { success: false, message: '缺少管理员ID' };
      const adminDoc = await db.collection('admins').doc(id).get();
      if (adminDoc.data && adminDoc.data.phone === 'admin') {
        return { success: false, message: '不能删除默认管理员' };
      }
      if (adminDoc.data) await revokeSessions(adminDoc.data.phone, 'admin');
      await db.collection('admins').doc(id).remove();
      return { success: true, message: '删除成功' };
    }

    case 'resetAdminPassword': {
      const tId = (data && data.id) || id;
      const tPhone = data && data.phone;
      let target = null;
      if (tId) {
        try {
          const doc = await db.collection('admins').doc(tId).get();
          target = doc.data || null;
        } catch (e) { target = null; }
      }
      if (!target && tPhone) {
        const r = await db.collection('admins').where({ phone: tPhone }).limit(1).get();
        target = r.data[0] || null;
      }
      if (!target) return { success: false, message: '管理员不存在' };
      // 规则：账号=密码=手机号（默认管理员重置为 admin123）；重置后对方首登强制改密
      const newPwd = target.phone === 'admin' ? 'admin123' : target.phone;
      await db.collection('admins').doc(target._id).update({
        data: { password: hashPassword(newPwd), mustChangePassword: true, updatedAt: new Date() }
      });
      await revokeSessions(target.phone, 'admin');
      return { success: true, message: '密码已重置', newPassword: newPwd };
    }

    case 'initDefaultAdmin': {
      const existing = await db.collection('admins').where({ phone: 'admin' }).get();
      if (existing.data.length === 0) {
        await db.collection('admins').add({
          data: { name: '系统管理员', phone: 'admin', password: hashPassword('admin123'), role: 'superadmin', mustChangePassword: true, createdAt: new Date() }
        });
        return { success: true, message: '默认管理员已创建（admin/admin123，首次登录需修改密码）' };
      }
      return { success: true, message: '默认管理员已存在' };
    }

    // ====== 温馨提示 ======
    case 'getTips': {
      const { className: tipClass } = data || {};
      if (!tipClass) return { success: true, data: { className: '默认', content: '欢迎来到杭州职业技术大学继续教育学院！请遵守校园管理规定，按时到校上课。如有疑问请联系：56700015。' } };
      const tipRes = await db.collection('tips').where({ className: tipClass }).limit(1).get();
      if (tipRes.data.length > 0) {
        return { success: true, data: tipRes.data[0] };
      }
      return { success: true, data: { className: tipClass, content: '欢迎来到杭州职业技术大学继续教育学院！请遵守校园管理规定，按时到校上课。如有疑问请联系：56700015。' } };
    }

    case 'getAllTips': {
      const allTipRes = await db.collection('tips').orderBy('className', 'asc').limit(100).get();
      return { success: true, data: allTipRes.data };
    }

    case 'updateTip': {
      const { className: tipClass2, content: tipContent } = data || {};
      if (!tipClass2) return { success: false, message: '请选择班级' };
      const existingTip = await db.collection('tips').where({ className: tipClass2 }).get();
      if (existingTip.data.length > 0) {
        await db.collection('tips').doc(existingTip.data[0]._id).update({
          data: { content: tipContent || '', updatedAt: new Date() }
        });
      } else {
        await db.collection('tips').add({
          data: { className: tipClass2, content: tipContent || '', createdBy: (session && session.phone) || data.adminPhone || '', createdAt: new Date(), updatedAt: new Date() }
        });
      }
      return { success: true, message: '保存成功' };
    }

    case 'deleteTip': {
      const { id: tipId } = data || {};
      if (!tipId) return { success: false, message: '缺少提示ID' };
      await db.collection('tips').doc(tipId).remove();
      return { success: true, message: '删除成功' };
    }

    case 'getClasses': {
      const actor = getActor(event, session);
      let query = db.collection('students');
      if (classFiltered(actor)) query = query.where({ className: _.in(actor.classes) });
      const stuRes = await query.limit(1000).get();
      const cls = [...new Set(stuRes.data.map(s => s.className).filter(Boolean))];
      return { success: true, data: cls };
    }

    case 'importAdmins': {
      const { admins: adminList } = data || {};
      if (!adminList || adminList.length === 0) return { success: false, message: '没有数据' };
      let addedA = 0, failedA = 0;
      const errorsA = [];
      for (let i = 0; i < adminList.length; i++) {
        const a = adminList[i] || {};
        try {
          const name = String(a.name || '').trim();
          const phone = String(a.phone || '').trim();
          const inputPwd = String(a.password || '').trim();
          if (!name || !phone) { errorsA.push(`第${i + 2}行：缺少姓名或电话`); failedA++; continue; }
          const dup = await db.collection('admins').where({ phone }).get();
          if (dup.data.length > 0) { errorsA.push(`第${i + 2}行：账号已存在`); failedA++; continue; }
          // 模板只有姓名/电话/负责班级时：账号=手机号，密码=手机号；创建时间自动生成；首次登录强制改密
          await db.collection('admins').add({
            data: {
              name, phone,
              password: hashPassword(inputPwd || phone),
              role: a.role === 'superadmin' ? 'superadmin' : 'admin',
              classes: a.classes || [],
              mustChangePassword: true,
              createdAt: new Date()
            }
          });
          addedA++;
        } catch (err) {
          errorsA.push(`第${i + 2}行：${err.message}`);
          failedA++;
        }
      }
      return { success: true, data: { total: adminList.length, added: addedA, failed: failedA, errors: errorsA } };
    }

    // ====== 一次性迁移导出（保留至迁移完全完成、云退役确认后再删除）======
    case 'exportAll': {
      async function dumpAll(coll) {
        const all = [];
        let skip = 0;
        for (;;) {
          const r = await db.collection(coll).skip(skip).limit(100).get();
          all.push(...r.data);
          if (r.data.length < 100) break;
          skip += r.data.length;
        }
        return all;
      }
      const out = {};
      for (const c of ['students', 'admins', 'entry_requests', 'users', 'tips']) {
        out[c] = await dumpAll(c);
      }
      out._exportedAt = new Date();
      return { success: true, data: out };
    }

    default:
      return { success: false, message: '未知操作: ' + action };
  }
};
