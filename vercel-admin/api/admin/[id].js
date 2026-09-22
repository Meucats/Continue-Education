const { json, options, callCloudFunction } = require('../../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  const { id } = req.query;
  try {
    if (req.method === 'PUT') {
      const result = await callCloudFunction('updateAdmin', { data: { _id: id, ...req.body } });
      return json(res, result);
    }
    if (req.method === 'DELETE') {
      const target = (await callCloudFunction('getAdmins')).data?.find(a => a.id === id || a._id === id);
      if (target && target.phone === 'admin') return json(res, { success: false, message: '不能删除默认管理员' });
      const loginPhone = req.headers['x-admin-phone'];
      if (target && target.phone === loginPhone) return json(res, { success: false, message: '不能删除自己的账号' });
      const result = await callCloudFunction('deleteAdmin', { id });
      return json(res, result);
    }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
