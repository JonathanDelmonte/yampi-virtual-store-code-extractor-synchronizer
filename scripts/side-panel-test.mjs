// Test-only CDP driver for native extension side panels, which Playwright does not expose as pages.
// Used exclusively with the disposable browser profile and fictitious editor in e2e.mjs.
import {copyFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function nativePanelDriver(browser, downloadDirectory) {
  const cdp = await browser.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath: downloadDirectory, eventsEnabled: true});
  const downloads = [], waiters = [], completed = new Map();
  cdp.on('Browser.downloadWillBegin', item => {
    const promise = new Promise(resolve => completed.set(item.guid, resolve));
    const download = {async saveAs(destination) {await promise; await copyFile(path.join(downloadDirectory, item.guid), destination);}};
    const waiting = waiters.shift(); if (waiting) waiting(download); else downloads.push(download);
  });
  cdp.on('Browser.downloadProgress', item => {
    if (item.state === 'completed') {completed.get(item.guid)?.(); completed.delete(item.guid);}
  });
  const waitDownload = () => downloads.length ? Promise.resolve(downloads.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Download não chegou ao driver do teste.')), 60000);
    waiters.push(value => {clearTimeout(timer); resolve(value);});
  });
  async function attach(tabId, page = 'panel') {
    let target;
    const deadline = Date.now() + 30000;
    while (!target && Date.now() < deadline) {
      target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && new URL(t.url).pathname===`/${page}.html` && new URL(t.url).searchParams.has('tab')&&(!tabId||new URL(t.url).searchParams.get('tab')===String(tabId)));
      if (!target) await new Promise(r => setTimeout(r, 100));
    }
    if (!target) throw new Error('Painel lateral nativo não abriu.');
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId: target.targetId, flatten: false});
    let id = 0; const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', ({sessionId: received, message}) => {
      if (received !== sessionId) return;
      const reply = JSON.parse(message), request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id); reply.error ? request.reject(new Error(reply.error.message)) : request.resolve(reply.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id; pending.set(requestId, {resolve, reject});
      void cdp.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id: requestId, method, params})}).catch(reject);
    });
    await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
    const evaluate = async (fn, value) => {
      const reply = await send('Runtime.evaluate', {expression: `(${fn.toString()})(${JSON.stringify(value) ?? ''})`, awaitPromise: true, returnByValue: true});
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
      return reply.result.value;
    };
    const waitForFunction = async (fn, {timeout = 45000} = {}) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(fn).catch(() => false) && await evaluate(() => !document.querySelector('#cancel') || document.querySelector('#cancel').hidden).catch(() => false)) return;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error(`Timeout no painel: ${fn}`);
    };
    return {
      evaluate, waitForFunction, async reload() {await send('Page.reload');},
      async screenshot({path: destination}) {const {data} = await send('Page.captureScreenshot', {captureBeyondViewport: true}); await writeFile(destination, Buffer.from(data, 'base64'));},
      locator(selector) {return {
        async click() {const point=await evaluate(s => {const el = document.querySelector(s); if (!el || el.disabled || !el.getClientRects().length) throw new Error(`Controle indisponível: ${s}`);el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});},
        async fill(value) {await evaluate(({s, value}) => {const el = document.querySelector(s); el.value = value; el.dispatchEvent(new Event('input', {bubbles: true}));}, {s: selector, value});},
        async textContent() {return evaluate(s => document.querySelector(s)?.textContent, selector);},
        async setInputFiles(file) {
          const {root} = await send('DOM.getDocument'); const {nodeId} = await send('DOM.querySelector', {nodeId: root.nodeId, selector});
          await send('DOM.setFileInputFiles', {nodeId, files: [file]});
        }
      };}
    };
  }
  return {attach, waitDownload, cdp};
}
