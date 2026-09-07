import { readFileSync } from 'node:fs';

const manifest = Object.freeze({
  'material-location': { description: '沿教材目录定位篇目并读取原页', url: new URL('../teaching-skills/material-location/SKILL.md', import.meta.url) },
  'source-verification': { description: '核对引文主语、段落比较和纠错', url: new URL('../teaching-skills/source-verification/SKILL.md', import.meta.url) },
  'lesson-design': { description: '按课堂条件形成可操作方案', url: new URL('../teaching-skills/lesson-design/SKILL.md', import.meta.url) },
  'card-review': { description: '审校板书、问题链和评价一致性', url: new URL('../teaching-skills/card-review/SKILL.md', import.meta.url) }
});
export const teachingSkillsEnabled = env => env?.TEACHING_SKILLS_ENABLED === 'true';
export function selectTeachingSkills({ question = '', followUpInstruction = '', expectedCardTypes = [], stage = 'answer' } = {}) {
  const ids = stage === 'retrieval' ? ['material-location'] : [];
  const text = `${question}\n${followUpInstruction}`;
  if (/原文|原句|引文|主语|谁|区别|比较|纠错|核对|不对|错误/u.test(text)) ids.push('source-verification');
  if (stage !== 'retrieval' && /备课|方案|课堂|教学|课时|活动|问题链/u.test(text)) ids.push('lesson-design');
  if (stage !== 'retrieval' && expectedCardTypes.length) ids.push('card-review');
  return [...new Set(ids)];
}
/** Only immutable built-in instructions are shared; activation state is per request. */
export function createTeachingSkillSession({ env = process.env, deadlineAt = Infinity } = {}) {
  const enabled = teachingSkillsEnabled(env);
  const loaded = new Map();
  const events = [];
  const failures = [];
  let optionalReads = 0;
  function load(id, required = false) {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (Date.now() >= deadlineAt) return { ok: false, reason: 'deadline' };
    if (!Object.hasOwn(manifest, id)) return { ok: false, reason: 'unknown_skill' };
    if (loaded.has(id)) return { ok: true, alreadyLoaded: true, id };
    if (!required && optionalReads >= 2) return { ok: false, reason: 'skill_budget' };
    if (!required) optionalReads++;
    try {
      const content = readFileSync(manifest[id].url, 'utf8');
      if (content.length > 6000 || !content.startsWith(`---\nname: ${id}\n`)) throw new Error('invalid_skill');
      loaded.set(id, content);
      events.push({ id, version: '1.0.0', source: 'huojiaocan-original', license: 'LicenseRef-Huojiaocan-Internal' });
      return { ok: true, id, content };
    } catch { return { ok: false, reason: 'skill_unavailable' }; }
  }
  return {
    enabled,
    catalog: () => enabled ? Object.entries(manifest).map(([id, value]) => ({ id, description: value.description })) : [],
    load,
    require: ids => ids.map(id => {
      const result = load(id, true);
      if (enabled && !result.ok) failures.push({ id, reason: result.reason });
      return result;
    }),
    prompt: () => [...loaded.values()].join('\n\n'),
    audit: () => ({ enabled, loaded: events.map(event => ({ ...event })), optionalReads, failures: failures.map(item => ({ ...item })) })
  };
}
