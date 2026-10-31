import { _electron as electron } from '@playwright/test';
import { fixtures } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('test-results/next-'+Date.now());mkdirSync(dir,{recursive:true});
const env={...process.env,READER_DATA_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch(process.argv.includes('--packaged')?{executablePath:path.resolve('release/win-unpacked/AI读书助手.exe'),args:[],env}:{args:['.'],env});
try {
 const page=await app.firstWindow();await page.getByRole('button',{name:'导入书籍',exact:true}).waitFor();
 await app.evaluate(({session})=>{globalThis.nextPayloads=[];session.fromPartition('reader-network').fetch=async(url,init)=>{
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'fixture'}]});
  const body=JSON.parse(init.body);let text;
  if(body.messages[0].content.includes('你是书籍分段编辑')){const paragraphs=JSON.parse(body.messages.at(-1).content);text=JSON.stringify({ends:[12,paragraphs.length]});}
  else {globalThis.nextPayloads.push(body);text='这是当前分段的概述。';}
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\n');
 };});
 await page.evaluate(async files=>{await window.reader.importBooks(files.map(f=>({...f,bytes:new Uint8Array(f.bytes)})));const {books}=await window.reader.snapshot();await window.reader.configure('api','fixture');await window.reader.settings({activeBook:books.find(b=>b.format==='epub').id,smartSegments:true,model:'fixture'});},await fixtures());
 await page.reload();const frame=page.frameLocator('iframe.epub-document');await frame.locator('[data-reader-ui="segments"] button').first().waitFor();
 const next=page.getByRole('button',{name:'概述下一节',exact:true});
 const sendNext=async()=>{await next.click();await page.waitForFunction(()=>!document.querySelector('.message-status.streaming'));await next.waitFor({state:'visible'});};
 await sendNext();
 await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===1);
 await page.getByRole('textbox',{name:'聊天输入框'}).fill('下一节');await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===2&&!document.querySelector('.message-status.streaming'));
 await sendNext();await frame.getByRole('heading',{name:'第2章 阅读的开始'}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===3&&!document.querySelector('.message-status.streaming'));
 const refs=await page.evaluate(async()=>{const s=await window.reader.snapshot();return (await window.reader.messages(s.sessions.find(x=>x.bookId===s.settings.activeBook).id)).filter(m=>m.role==='user').map(m=>m.refs[0]);});
 assert.deepEqual(refs.map(r=>r.segment.index),[0,1,0]);assert.notEqual(refs[1].segment.href,refs[2].segment.href);
 assert.ok(refs.every(r=>r.text.length>50));assert.equal(await app.evaluate(()=>globalThis.nextPayloads.length),3);
 await page.reload();await next.waitFor();await next.click();
 await page.waitForFunction(()=>document.querySelectorAll('.message.assistant').length===4&&!document.querySelector('.message-status.streaming'));
 await next.click();await page.getByText('已到全书最后一段',{exact:true}).waitFor();
 assert.equal(await app.evaluate(()=>globalThis.nextPayloads.length),4);
 console.log('PASS: button starts first segment, typed next supplies second, chapter crossing and reload resume, end-of-book stops.');
}finally{await app.close();}
