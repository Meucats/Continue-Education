const { json, options, callCloudFunction } = require('./_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  try {
    const result = await callCloudFunction('getStats');
    json(res, result);
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
