import { allowMethod, json } from '../serverless/shared.js';
export default function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  return json(res, 410, { error: '图片生成功能已停用，个人 DeepSeek 连接仅用于文字备课。' });
}
