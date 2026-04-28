/**
 * api/catalog.js - Catalog 业务代理层
 *
 * 覆盖后端路由: GET /catalog/skills, /catalog/commands, /catalog/agents
 *
 * 注意：当前后端 hard-coded 返回空数组（placeholder），但路由和 envelope 形状稳定
 *
 * NOT YET AVAILABLE (后端未实现):
 * - 无
 */

const { request } = require('../utils/api');

function normalizeResponse(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: { code: 'invalid-response', message: 'Invalid response body' } };
  }
  return {
    ok: body.ok === true,
    data: body.ok === true ? body.data : undefined,
    error: body.ok === false ? body.error : undefined,
    traceUuid: body.trace_uuid,
  };
}

/**
 * 获取技能列表
 * 注意：当前后端返回空数组 placeholder
 * @returns {Promise<{ok, data: {skills: []}, error, traceUuid}>}
 */
async function listSkills() {
  const body = await request('catalogSkills', { showLoading: false });
  const result = normalizeResponse(body);
  // 确保返回空数组而非 null
  if (result.ok && result.data && !result.data.skills) {
    result.data.skills = [];
  }
  return result;
}

/**
 * 获取命令列表
 * 注意：当前后端返回空数组 placeholder
 * @returns {Promise<{ok, data: {commands: []}, error, traceUuid}>}
 */
async function listCommands() {
  const body = await request('catalogCommands', { showLoading: false });
  const result = normalizeResponse(body);
  if (result.ok && result.data && !result.data.commands) {
    result.data.commands = [];
  }
  return result;
}

/**
 * 获取 Agent 列表
 * 注意：当前后端返回空数组 placeholder
 * @returns {Promise<{ok, data: {agents: []}, error, traceUuid}>}
 */
async function listAgents() {
  const body = await request('catalogAgents', { showLoading: false });
  const result = normalizeResponse(body);
  if (result.ok && result.data && !result.data.agents) {
    result.data.agents = [];
  }
  return result;
}

module.exports = {
  listSkills,
  listCommands,
  listAgents,
};
