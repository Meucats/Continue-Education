const { json, options, callCloudFunction } = require('../../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  const { id } = req.query;
  try {
    if (req.method === 'PUT') {
      const result = await callCloudFunction('updateStudent', { data: { _id: id, ...req.body } });
      return json(res, result);
    }
    if (req.method === 'DELETE') {
      const result = await callCloudFunction('deleteStudent', { id });
      return json(res, result);
    }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
