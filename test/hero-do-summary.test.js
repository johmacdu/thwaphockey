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
  it('names the three disciplines with the Hands label inside the sentence (not vague "3 things")', () => {
    const d = render(false, []);
    const lead = d.getElementById('doLead');
    expect(lead).toBeTruthy();
    const names = [...lead.querySelectorAll('.disc')].map(s => s.className.match(/disc-(\w+)/)[1]);
    expect(names).toEqual(['stick', 'shoot', 'dryland']);
    expect(lead.textContent).toContain('Hands');
    expect(lead.textContent).toContain('Shooting');
    expect(lead.textContent).toContain('Dryland');
    // the disciplines are flat status text, NOT tappable-looking (only "Today" is a button)
    expect(lead.querySelectorAll('.disc button').length).toBe(0);
  });

  it('open state reads as one sentence "Today\'s training is ... and ..." with an inline tappable "Today" that reveals the date', () => {
    const none = render(false, []);
    const lead = none.getElementById('doLead');
    const reveal = none.getElementById('todayReveal');
    expect(reveal).toBeTruthy();
    expect(reveal.textContent.startsWith('Today')).toBe(true);   // the tappable word
    expect(reveal.querySelector('.todaydate').textContent).toBe('Monday, September 28');
    expect(lead.innerHTML).toContain("'s training is");          // sentence form
    expect(lead.innerHTML).not.toContain("'s training:");        // no colon anymore
    expect(lead.textContent).toContain(' and ');                 // "Shooting and Dryland"
  });

  it('partway state is a sentence listing what is left, no colon', () => {
    const d = render(false, ['stick', 'shoot']);
    const lead = d.getElementById('doLead');
    expect(lead.textContent).toContain('You still have');
    expect(lead.textContent).toContain('Dryland');
    expect(lead.textContent).toContain('to do');
    expect(lead.innerHTML).not.toContain(':');                   // sentence, no colon
    const byName = {};
    [...lead.querySelectorAll('.disc')].forEach(s => { byName[s.className.match(/disc-(\w+)/)[1]] = true; });
    // only the remaining discipline is listed in the partway sentence
    expect(byName.dryland).toBe(true);
    expect(byName.stick).toBeUndefined();
    expect(byName.shoot).toBeUndefined();
  });

  it('celebrates as a sentence when all three are done', () => {
    const d = render(false, ['stick', 'shoot', 'dryland']);
    const lead = d.getElementById('doLead');
    expect(lead.textContent).toContain('All done');
    expect(lead.className).toContain('alldone');
  });

  it('weekend is a sentence and drops dryland', () => {
    const d = render(true, []);
    const lead = d.getElementById('doLead');
    expect(lead.textContent).toContain('No training');
    expect(lead.textContent).toContain('bonus skills');
    expect(lead.textContent).not.toContain('Dryland');
  });

  it('the floating "Today" chip is gone (affordance is inline in the sentence)', () => {
    expect(html).not.toContain("class='daytip daytip-chip' id='dayTip'");
  });
});
