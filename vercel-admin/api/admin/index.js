const { json, options, callCloudFunction } = require('../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  try {
    if (req.method === 'GET') {
      try {
        const result = await callCloudFunction('getAdmins');
        return json(res, result);
      } catch (e) {
        return json(res, { success: true, data: [{ id: 'admin-default', name: '系统管理员', phone: 'admin', role: 'superadmin', createdAt: '' }] });
      }
    }
    if (req.method === 'POST') {
      const result = await callCloudFunction('addAdmin', { data: req.body });
      return json(res, result);
    }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
