const { json, options, callCloudFunction } = require('../../../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  const { id } = req.query;
  try {
    const result = await callCloudFunction('rejectRequest', { id, reason: req.body.reason });
    json(res, result);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
