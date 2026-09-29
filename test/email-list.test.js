// test/email-list.test.js
//
// EXECUTION test: boots index.html in jsdom and checks the flexible guardian-email
// list used by the coach player-edit sheet and the player self-edit sheet. These
// two sheets used to have two FIXED email inputs (parentEmail / parentEmail2); they
// now share window.thwapEmailUI, which renders any number of email rows and collects
// them back as a `parentEmails` array (the backend's source of truth). Guards that
// the old fixed inputs are gone and the shared helper add/remove/collect works.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let win, doc;
beforeAll(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=0',
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  win = dom.window; doc = win.document;
  await new Promise((r) => setTimeout(r, 50));
});

describe('Flexible guardian-email list', () => {
  it('both edit sheets use a list container, not the old fixed pair', () => {
    // New containers exist...
    expect(doc.getElementById('peEmailList')).toBeTruthy();
    expect(doc.getElementById('psEmailList')).toBeTruthy();
    // ...and the two fixed inputs are gone from both sheets.
    ['peEmail', 'peEmail2', 'psEmail', 'psEmail2'].forEach((id) =>
      expect(doc.getElementById(id)).toBeNull());
  });

  it('exposes window.thwapEmailUI with render/collect/first', () => {
    expect(typeof win.thwapEmailUI).toBe('object');
    ['render', 'collect', 'first'].forEach((k) =>
      expect(typeof win.thwapEmailUI[k]).toBe('function'));
  });

  it('render() shows one row per email (or a single blank row when empty)', () => {
    const c = doc.createElement('div');
    win.thwapEmailUI.render(c, ['mom@example.com', 'dad@example.com']);
    expect(c.querySelectorAll('.pe-erow').length).toBe(2);
    expect(c.querySelector('.pe-eadd')).toBeTruthy();
    win.thwapEmailUI.render(c, []);
    expect(c.querySelectorAll('.pe-erow').length).toBe(1); // one empty row to type into
    expect(win.thwapEmailUI.collect(c)).toEqual([]);
  });

  it('collect() returns the trimmed, non-empty emails; first() is the first', () => {
    const c = doc.createElement('div');
    win.thwapEmailUI.render(c, ['  a@x.com  ', '', 'b@y.com']);
    expect(win.thwapEmailUI.collect(c)).toEqual(['a@x.com', 'b@y.com']);
    expect(win.thwapEmailUI.first(c)).toBe('a@x.com');
  });

  it('the + Add button appends a row; the × keeps at least one row', () => {
    const c = doc.createElement('div');
    win.thwapEmailUI.render(c, ['a@x.com']);
    c.querySelector('.pe-eadd').dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(c.querySelectorAll('.pe-erow').length).toBe(2);
    // remove both rows: the second deletes, the first only clears (one row stays)
    c.querySelectorAll('.pe-edel')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(c.querySelectorAll('.pe-erow').length).toBe(1);
    c.querySelector('.pe-edel').dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(c.querySelectorAll('.pe-erow').length).toBe(1); // never drops below one
    expect(win.thwapEmailUI.collect(c)).toEqual([]);
  });
});
