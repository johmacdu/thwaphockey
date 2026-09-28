import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function render(weekend, done) {
  const store = {};
  (done || []).forEach(k => { store['thwapDone|2026-9-28|' + k] = '1'; });
  const inject = "<script>window.__wk=" + weekend + ";window.__done=" + JSON.stringify(store) + ";" +
    "Object.defineProperty(window,'thwapIsWeekend',{configurable:true,value:function(){return window.__wk;}});" +
    "window.thwapToday=function(){return new Date(2026,8,28);};" +
    "var _g=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k in window.__done)return window.__done[k];return _g.call(this,k);};<\/script>";
  const doc = html.replace('<head>', '<head>' + inject);
  const dom = new JSDOM(doc, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  return dom.window.document;
}

describe('Home hero do-summary', () => {
  it('names the three disciplines with the Hands label (not vague "3 things")', () => {
    const d = render(false, []);
    const line = d.getElementById('discLine');
    expect(line).toBeTruthy();
    const names = [...line.querySelectorAll('.disc')].map(s => s.className.match(/disc-(\w+)/)[1]);
    expect(names).toEqual(['stick', 'shoot', 'dryland']);
    expect(line.textContent).toContain('Hands');
    expect(line.textContent).toContain('Shooting');
    expect(line.textContent).toContain('Dryland');
    // flat status text, NOT a tappable-looking pill/button
    expect(line.querySelector('button')).toBeNull();
  });

  it('lead line shows the remaining count and an inline tappable "today" that reveals the date', () => {
    const none = render(false, []);
    expect(none.getElementById('doLead').textContent).toContain('Do all 3');
    const reveal = none.getElementById('todayReveal');
    expect(reveal).toBeTruthy();
    expect(reveal.querySelector('.todaydate').textContent).toBe('Monday, September 28');
  });

  it('marks finished disciplines done and reports what is left', () => {
    const d = render(false, ['stick', 'shoot']);
    expect(d.getElementById('doLead').textContent).toContain('1 left');
    expect(d.getElementById('doLead').textContent).toContain('Dryland');
    const byName = {};
    [...d.querySelectorAll('#discLine .disc')].forEach(s => { byName[s.className.match(/disc-(\w+)/)[1]] = s.classList.contains('done'); });
    expect(byName.stick).toBe(true);
    expect(byName.shoot).toBe(true);
    expect(byName.dryland).toBe(false);
  });

  it('celebrates when all three are done', () => {
    const d = render(false, ['stick', 'shoot', 'dryland']);
    const lead = d.getElementById('doLead');
    expect(lead.textContent).toContain('All 3 done');
    expect(lead.className).toContain('alldone');
  });

  it('weekend drops dryland and keeps the weekend line', () => {
    const d = render(true, []);
    expect(d.getElementById('doLead').textContent).toContain('Weekend');
    const names = [...d.querySelectorAll('#discLine .disc')].map(s => s.className.match(/disc-(\w+)/)[1]);
    expect(names).toEqual(['stick', 'shoot']);
  });

  it('the floating "Today" chip is gone (affordance is inline in the sentence)', () => {
    expect(html).not.toContain("class='daytip daytip-chip' id='dayTip'");
  });
});
