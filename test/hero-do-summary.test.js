import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function render(weekend, done, goalie) {
  const store = {};
  (done || []).forEach(k => { store['thwapDone|2026-9-28|' + k] = '1'; });
  const inject = "<script>window.__wk=" + weekend + ";window.__done=" + JSON.stringify(store) + ";" +
    "Object.defineProperty(window,'thwapIsWeekend',{configurable:true,value:function(){return window.__wk;}});" +
    "window.thwapToday=function(){return new Date(2026,8,28);};" +
    "var _g=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k in window.__done)return window.__done[k];return _g.call(this,k);};<\/script>";
  let doc = html.replace('<head>', '<head>' + inject);
  if (goalie) {
    // Force the goalie flag AFTER the app defines its helpers (they live late in the file), then re-render the summary.
    doc = doc.replace('</body>', "<script>window.thwapIsGoalie=function(){return true;};if(typeof window.thwapRefreshHero==='function')window.thwapRefreshHero();<\/script></body>");
  }
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
    // each discipline is a LINK to its category page
    const links = [...lead.querySelectorAll('a.disc')];
    expect(links.length).toBe(3);
    const hrefs = links.map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['#stick', '#shoot', '#dryland']);
    // the check mark is hidden until done, and the sentence's period follows the
    // last link directly, so it renders "Dryland." with no stray space on screen.
    const dryland = links[2];
    const chk = dryland.querySelector('.chk');
    expect(chk).toBeTruthy();
    expect(lead.innerHTML).not.toContain('Dryland <span');   // no space between label and chk span
    expect(lead.innerHTML).toMatch(/<\/a>\.<\/div>$|<\/a>\.$/); // period sits right after the closing link
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


function renderGated() {
  // Mirror render()'s weekday mock, then simulate the plan-gating hiding the
  // dryland card AFTER load and repainting the hero (what the gating IIFE does).
  const inject = "<script>window.__wk=false;" +
    "Object.defineProperty(window,'thwapIsWeekend',{configurable:true,value:function(){return false;}});" +
    "window.thwapToday=function(){return new Date(2026,8,28);};<\/script>";
  let doc = html.replace('<head>', '<head>' + inject);
  doc = doc.replace('</body>',
    "<script>var c=document.querySelector('.nav-dryland'); if(c) c.style.display='none';" +
    "if(typeof window.thwapRefreshHero==='function') window.thwapRefreshHero();<\/script></body>");
  const dom = new JSDOM(doc, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  return dom.window.document;
}

describe('Home hero do-summary — plan gating (no dryland today)', () => {
  // The coach plan / weekday default hides the .nav-<disc> card for a discipline
  // not scheduled today. The hero sentence must mirror that and NOT list a
  // discipline whose card is hidden (the "Dryland to do today" bug when there is
  // no dryland).
  it('drops Dryland from the sentence when its nav card is hidden', () => {
    const d = renderGated();
    const lead = d.getElementById('doLead');
    expect(lead).toBeTruthy();
    const names = [...lead.querySelectorAll('.disc')].map(s => s.className.match(/disc-(\w+)/)[1]);
    expect(names).toEqual(['stick', 'shoot']); // dryland dropped
    expect(lead.textContent).toContain('Hands');
    expect(lead.textContent).toContain('Shooting');
    expect(lead.textContent).not.toContain('Dryland');
  });

  it('the hero refreshes on return to #home and after a shoot drill is marked', () => {
    // Guard the wiring that keeps the hero from going stale after finishing a drill.
    expect(html).toContain("if(location.hash===''||location.hash==='#home'){ showHomePlayer();");
    // markDone + unMark + both gating hooks repaint the hero.
    const refreshCount = (html.match(/if\(window\.thwapRefreshHero\) window\.thwapRefreshHero\(\);/g) || []).length;
    expect(refreshCount).toBeGreaterThanOrEqual(4);
  });

  it('fill() no longer writes the dryland nav card display (gating owns it)', () => {
    expect(html).not.toContain("var dl=document.querySelector('.nav-dryland'); if(dl) dl.style.display=weekend?'none':'';");
  });
});

describe('Home hero do-summary — goalie', () => {
  it('a gated goalie (Net play coming-soon) sees Hands and Dryland only, never Shooting or Net play', () => {
    const d = render(false, [], true);
    const lead = d.getElementById('doLead');
    expect(lead).toBeTruthy();
    const names = [...lead.querySelectorAll('.disc')].map(s => s.className.match(/disc-(\w+)/)[1]);
    // gated: no third discipline for the goalie today
    expect(lead.textContent).toContain('Hands');
    expect(lead.textContent).toContain('Dryland');
    expect(lead.textContent).not.toContain('Shooting');
    expect(lead.textContent).not.toContain('Net play');
  });
});
