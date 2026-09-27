/* The allowlist deliberately excludes API credentials and configuration. */
const QuizBackup = (() => {
  const keys = ['quiz_bank_stats_v1', 'quiz_question_seen_v1', 'quiz_ai_analysis_v1',
    'quiz_ai_analysis_text_v2', 'quiz_structured_analysis_v2', 'quiz_sessions_v1',
    'quiz_exam_results_v1', 'quiz_exam_drafts_v1', 'quiz_answer_stats_v1'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safe = key => !['__proto__', 'constructor', 'prototype'].includes(key);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function validate(backup) {
    if (!object(backup) || backup.format !== 'quiz-backup' || backup.version !== 1 || !object(backup.data)) {
      throw new Error('不是受支持的题库备份文件。');
    }
    if (!Object.hasOwn(backup.data, keys[5])) backup.data[keys[5]] = {};
    for (const key of keys.slice(6)) if (!Object.hasOwn(backup.data, key)) backup.data[key] = {};
    if (keys.some(key => !object(backup.data[key])) || Object.keys(backup.data).some(key => !keys.includes(key))) {
      throw new Error('备份数据不完整或含有未知数据项。');
    }
    for (const key of keys) {
      for (const [bank, records] of Object.entries(backup.data[key])) {
        if (!safe(bank) || !object(records)) throw new Error('题库记录格式错误。');
        if (key === keys[5]) {
          if (!Array.isArray(records.ids) || !records.ids.length || !records.ids.every(id => typeof id === 'string' && safe(id)) ||
              new Set(records.ids).size !== records.ids.length || !['unseen-first','unseen','all','category','wrong','exam'].includes(records.mode) ||
              typeof records.category !== 'string' || !integer(records.updatedAt) ||
              Object.keys(records).some(k => !['ids','mode','category','updatedAt'].includes(k))) throw new Error('练习断点格式错误。');
          continue;
        }
        if (key === keys[6]) {
          if (!Array.isArray(records) || records.length > 100 || records.some(run => !object(run) ||
              !Number.isSafeInteger(run.score) || run.score < 0 || run.score > 100 || typeof run.passed !== 'boolean' ||
              !integer(run.at) || Object.keys(run).some(k => !['score','passed','at'].includes(k)))) throw new Error('模拟成绩格式错误。');
          continue;
        }
        if (key === keys[7]) {
          if (!object(records.answers) || !Array.isArray(records.ids) || records.ids.length !== 80 ||
              !records.ids.every(id => typeof id === 'string' && safe(id)) || new Set(records.ids).size !== 80 ||
              Object.keys(records.answers).some(id => !records.ids.includes(id) || !safe(id) || typeof records.answers[id] !== 'string') ||
              Object.keys(records).some(k => !['answers','ids'].includes(k))) throw new Error('模拟试卷断点格式错误。');
          continue;
        }
        if (key === keys[8]) {
          for (const [id,value] of Object.entries(records)) {
            if (!safe(id) || !object(value) || !integer(value.correct) || !integer(value.wrong) ||
                Object.keys(value).some(k => !['correct','wrong'].includes(k))) throw new Error(`正确率记录格式错误：${bank} #${id}`);
          }
          continue;
        }
        for (const [id, value] of Object.entries(records)) {
          if (!safe(id)) throw new Error('题号无效。');
          let valid;
          if (key === keys[0]) valid = object(value) && integer(value.wrong) && integer(value.lastAt) && Object.keys(value).every(k => ['wrong','lastAt'].includes(k));
          else if (key === keys[1]) valid = value === 1 || value === true;
          else if (key === keys[4]) valid = object(value) && value.version === 2 &&
            ['memory','understanding'].includes(value.study_type) &&
            ['reason','explanation','memory_tip','fingerprint'].every(k => typeof value[k] === 'string') &&
            typeof value.needs_review === 'boolean' &&
            Object.keys(value).every(k => ['version','study_type','reason','explanation','memory_tip','fingerprint','needs_review'].includes(k));
          else valid = typeof value === 'string';
          if (!valid) throw new Error(`记录格式错误：${bank} #${id}`);
        }
      }
    }
    return backup;
  }
  function capture(storage) {
    const data = Object.fromEntries(keys.map(key => [key, JSON.parse(storage.getItem(key) || '{}')]));
    return validate({format:'quiz-backup',version:1,createdAt:new Date().toISOString(),data});
  }
  function merge(current, incoming) {
    validate(current); validate(incoming);
    const result = JSON.parse(JSON.stringify(current));
    for (const key of keys) for (const [bank, records] of Object.entries(incoming.data[key])) {
      if (key === keys[5] || key === keys[7]) { if (!result.data[key][bank]) result.data[key][bank] = records; continue; }
      if (key === keys[6]) {
        const runs = [...(result.data[key][bank] || []), ...records].sort((a,b) => b.at-a.at).slice(0,100);
        if (runs.length) result.data[key][bank] = runs;
        continue;
      }
      if (key === keys[8]) {
        const target = result.data[key][bank] ||= {};
        for (const [id,value] of Object.entries(records)) {
          const old=target[id] || {correct:0,wrong:0};
          target[id]={correct:Math.max(old.correct,value.correct),wrong:Math.max(old.wrong,value.wrong)};
        }
        continue;
      }
      const target = result.data[key][bank] ||= {};
      for (const [id, value] of Object.entries(records)) {
        if (!(id in target)) target[id] = value;
        else if (key === keys[0]) target[id] = {wrong:Math.max(target[id].wrong,value.wrong),lastAt:Math.max(target[id].lastAt,value.lastAt)};
      }
    }
    return result;
  }
  function restore(storage, incoming) {
    const result = merge(capture(storage), incoming);
    const originals = keys.map(key => storage.getItem(key));
    const changed = [];
    try {
      keys.forEach((key,i) => {
        const serialized = JSON.stringify(result.data[key]);
        if (serialized !== originals[i]) { storage.setItem(key,serialized); changed.push(i); }
      });
    } catch (error) {
      for (const i of changed.reverse()) {
        if (originals[i] === null) storage.removeItem(keys[i]); else storage.setItem(keys[i], originals[i]);
      }
      throw new Error('导入失败，已恢复原记录。可能是浏览器存储空间不足。');
    }
    return result;
  }
  function summary(backup) {
    const count = key => Object.values(backup.data[key]).reduce((sum, records) => sum + Object.keys(records).length,0);
    return `已做 ${count(keys[1])} 题 · 错题 ${count(keys[0])} 题 · 结构化解析 ${count(keys[4])} 条 · 文本解析 ${count(keys[2])+count(keys[3])} 条 · 练习断点 ${Object.keys(backup.data[keys[5]]).length} 个 · 模拟成绩 ${count(keys[6])} 次 · 正确率记录 ${count(keys[8])} 题`;
  }
  return {validate,capture,merge,restore,summary};
})();

if (typeof module !== 'undefined') module.exports = QuizBackup;
if (typeof document !== 'undefined') {
  let pending = null;
  const status = document.getElementById('backupStatus');
  const confirmButton = document.getElementById('btnImportBackup');
  document.getElementById('btnExportBackup').addEventListener('click', () => {
    try {
      const backup = QuizBackup.capture(localStorage);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const link = document.createElement('a');
      link.href = url; link.download = `quiz-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      status.textContent = `已生成备份：${QuizBackup.summary(backup)}。不含 API 配置。`;
    } catch (error) { status.textContent = `导出失败：${error.message}`; }
  });
  document.getElementById('backupFile').addEventListener('change', async event => {
    pending = null; confirmButton.disabled = true;
    const file = event.target.files[0];
    if (!file) { status.textContent = ''; return; }
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件超过 20 MB。');
      const text = await file.text();
      if (event.target.files[0] !== file) return;
      pending = QuizBackup.validate(JSON.parse(text));
      status.textContent = `待导入：${QuizBackup.summary(pending)}`;
      confirmButton.disabled = false;
    } catch (error) { status.textContent = `无法导入：${error.message}`; }
  });
  confirmButton.addEventListener('click', () => {
    if (!pending) return;
    if (typeof analysisRunning !== 'undefined' && analysisRunning) {
      status.textContent = '请先停止批量解析，待当前请求结束后再导入。'; return;
    }
    try {
      const result = QuizBackup.restore(localStorage,pending);
      pending = null; confirmButton.disabled = true;
      document.getElementById('backupFile').value = '';
      status.textContent = `导入成功：${QuizBackup.summary(result)}`;
      if (typeof refreshHeatAfterStatsChange === 'function') refreshHeatAfterStatsChange();
    } catch (error) { status.textContent = error.message; }
  });
}
