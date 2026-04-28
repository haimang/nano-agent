/**
 * api/index.js - 统一业务接口代理层导出
 *
 * 分层原则：
 * - utils/ : 纯技术层（request, token, WS 底层）
 * - api/   : 业务层（按后端 facade 模块划分，统一数据转换与错误语义）
 * - pages/ : 消费层（只调用 api/ 层，不直接调用 utils/）
 *
 * 使用方式：
 *   const { auth, session, me, catalog, permission, stream } = require('../../api');
 */

const auth = require('./auth');
const session = require('./session');
const me = require('./me');
const catalog = require('./catalog');
const permission = require('./permission');
const stream = require('./stream');

module.exports = {
  auth,
  session,
  me,
  catalog,
  permission,
  stream,
};
