/**
 * 兼容旧版 /api/ask 地址。
 *
 * 所有问答统一进入新的文档索引 Provider，避免旧知识库与公开材料范围漂移。
 * 当前公开语料仅包含学生教材和教师教学用书。
 */
import indexHandler from './index.js';

export default async function handler(req, res) {
  req.indexPath = '/ask';
  return indexHandler(req, res);
}
