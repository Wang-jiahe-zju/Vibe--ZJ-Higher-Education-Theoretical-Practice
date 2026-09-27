const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const storage = new Map();
let calls = 0;
let answer = {study_type:'memory',reason:'需记住术语定义',explanation:'依据概念的准确定义判断。',memory_tip:'术语与定义配对记忆',needs_review:false};
const q = {id:'1',stem:'示例',options:{A:'对',B:'错'},answer:'B',kind:'judge'};
const ctx = vm.createContext({
  console, URL, AbortController, setTimeout, clearTimeout,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{addEventListener(){},disabled:false,textContent:''});return elements.get(id);}},
  window:{addEventListener(){}},
  loadApiCfg:()=>({key:'test-only',base:'https://example.invalid/v1',model:'test'}),
  fetch:async(url,opts)=>{
    if(url==='/api/banks')return {ok:true,json:async()=>[{id:'bank'}]};
    if(url.startsWith('/api/banks/'))return {ok:true,json:async()=>[q]};
    calls++;
    assert.equal(url,'https://example.invalid/v1/chat/completions');
    assert.equal(JSON.parse(opts.body).response_format.type,'json_object');
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(answer)}}]})};
  }
});
vm.runInContext(fs.readFileSync('static/analysis.js','utf8'),ctx);
(async()=>{
  await vm.runInContext('runAllAnalysis()',ctx);
  assert.equal(calls,1);
  assert.match(elements.get('batchStatus').textContent,/成功 1\/1/);
  await vm.runInContext('runAllAnalysis()',ctx);
  assert.equal(calls,1,'Resume must skip successful unchanged questions');
  q.stem='修改后的题目';
  answer={...answer,study_type:'understanding'};
  await vm.runInContext('runAllAnalysis()',ctx);
  assert.equal(calls,2,'Changed question must be analyzed again');
  const saved=JSON.parse(storage.get('quiz_structured_analysis_v2')).bank['1'];
  assert.equal(saved.study_type,'understanding');
  assert.equal(saved.memory_tip,'');
  ctx.fetch=async()=>({ok:false,status:401});
  await assert.rejects(vm.runInContext('requestConciseAnalysis({},loadApiCfg())',ctx),/401/);
  assert.equal(elements.get('btnBatchAnalysis').disabled,false);
  console.log('PASS: requests, classification, resume, content invalidation, authentication error');
})().catch(error=>{console.error(error);process.exitCode=1;});
