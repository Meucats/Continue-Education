const { json, options, callCloudFunction } = require('./_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  try {
    if (req.method === 'GET') {
      const result = await callCloudFunction('getRequests', { status: req.query.status });
      return json(res, result);
    }
    if (req.method === 'POST') {
      const result = await callCloudFunction('addRequest', { data: req.body });
      return json(res, result);
    }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
