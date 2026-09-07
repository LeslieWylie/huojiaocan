import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeachingSkillSession, selectTeachingSkills } from './teaching-skills.js';
const env = { TEACHING_SKILLS_ENABLED: 'true' };
test('skills are disabled by default and expose no prompt or catalog', () => {
 const s=createTeachingSkillSession({env:{}});s.require(['lesson-design']);
 assert.equal(s.prompt(),'');assert.deepEqual(s.catalog(),[]);assert.equal(s.load('lesson-design').reason,'disabled');
});
test('task selection separates evidence reading from lesson/card production', () => {
 assert.deepEqual(selectTeachingSkills({question:'谁的原句不对？',stage:'retrieval'}),['material-location','source-verification']);
 assert.deepEqual(selectTeachingSkills({question:'怎样备课',expectedCardTypes:['board']}),['lesson-design','card-review']);
 assert.deepEqual(selectTeachingSkills({question:'你好'}),[]);
});
test('packaged skills have versioned instructions and duplicate loads do not expand prompts', () => {
 const s=createTeachingSkillSession({env});s.require(['material-location']); const before=s.prompt();
 assert.match(before,/物理页/); assert.equal(s.load('material-location').alreadyLoaded,true);assert.equal(s.prompt(),before);
 assert.equal(s.audit().loaded[0].version,'1.0.0');assert.equal(s.audit().optionalReads,0);
});
test('arbitrary paths, URLs and object prototype names cannot load', () => {
 const s=createTeachingSkillSession({env});for(const id of ['../auth.js','https://evil.example/x','__proto__','constructor']) assert.equal(s.load(id).reason,'unknown_skill');
 assert.equal(s.prompt(),'');
});
test('optional skills are bounded and required evidence instructions do not consume their budget', () => {
 const s=createTeachingSkillSession({env});s.require(['material-location']);
 assert.equal(s.load('source-verification').ok,true);assert.equal(s.load('lesson-design').ok,true);
 assert.equal(s.load('card-review').reason,'skill_budget');
});
test('expired requests cannot load skills', () => {
 const s=createTeachingSkillSession({env,deadlineAt:Date.now()-1}); assert.equal(s.load('lesson-design').reason,'deadline');assert.equal(s.prompt(),'');
});
test('activation and audit state never cross requests', async () => {
 const [a,b]=await Promise.all([Promise.resolve(createTeachingSkillSession({env})),Promise.resolve(createTeachingSkillSession({env}))]);
 a.require(['card-review']);b.require(['source-verification']);a.audit().loaded[0].id='tampered';
 assert.deepEqual(b.audit().loaded.map(x=>x.id),['source-verification']);assert.deepEqual(a.audit().loaded.map(x=>x.id),['card-review']);
});
