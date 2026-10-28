/* avatar.js: Thwap player character, built from CSS 3D boxes.
 *
 * Phase 1 prototype (see docs/avatar-roadmap.md). The character is a set of
 * boxes; a look is plain data, so every gear item works in every pose and the
 * art job is textures, not one image per item per pose.
 *
 * Preview flag: hidden from players. Open any page with ?avatar=1 to turn it on
 * for this device (stored in localStorage 'thwapAvatarPreview'), ?avatar=0 to
 * turn it off. While on, buildFront renders the character in the photo slot.
 *
 * Lighting is applied here (top lighter, sides darker) so textures stay flat.
 */
(function(){
  'use strict';

  // --- Flag -------------------------------------------------------------------
  try{
    var q=(location.search||'').match(/[?&]avatar=([01])/);
    if(q){ if(q[1]==='1') localStorage.setItem('thwapAvatarPreview','1'); else localStorage.removeItem('thwapAvatarPreview'); }
  }catch(_){}
  function on(){ try{ return localStorage.getItem('thwapAvatarPreview')==='1'; }catch(_){ return false; } }

  // --- Palette (placeholder colors until the art kit lands) -------------------
  var SKIN={ s1:'#F4D3B5', s2:'#E6B793', s3:'#C99470', s4:'#A26E4B', s5:'#7A4E32', s6:'#4E3121' };
  var HAIR={ black:'#1E1A18', brown:'#5A3A22', auburn:'#8A3B1E', blonde:'#D9B163', red:'#B5522A', grey:'#9A9A9A' };
  var JERSEY={
    red:  { body:'#C8102E', stripe:'#111111', trim:'#FFFFFF', num:'#FFFFFF' },
    black:{ body:'#151515', stripe:'#C8102E', trim:'#FFFFFF', num:'#FFFFFF' },
    white:{ body:'#F2F2F2', stripe:'#C8102E', trim:'#111111', num:'#C8102E' },
    forest:{ body:'#1F5A3A', stripe:'#F2F2F2', trim:'#111111', num:'#FFFFFF' },
    legend:{ body:'#D4A72C', stripe:'#111111', trim:'#FFFFFF', num:'#111111' }
  };
  var GLOVES={ black:'#141414', red:'#C8102E', ice:'#BFE6F2' };
  var STICK={ classic:'#2B2B2B', wood:'#B07A45', gold:'#D4A72C' };
  var DEFAULT_LOOK={ skin:'s3', hair:'brown', jersey:'red', helmet:'team', gloves:'black', stick:'classic', num:'' };

  // Server looks use catalog ids ('jersey-red', 'skin-s3'); the renderer keys
  // on the part after the slot prefix. Unknown values fall back to defaults.
  function norm(look){
    var out={};
    for(var k in look){ var v=look[k]; out[k]=(typeof v==='string' && v.indexOf(k+'-')===0)?v.slice(k.length+1):v; }
    return out;
  }

  // --- Box builder ------------------------------------------------------------
  // All sizes are in em, so one font-size scales the whole character.
  // (x,y,z) is the box CENTER; y is height above the ice (up is positive).
  function face(cls,w,h,tf,bg,inner){
    return "<div class='av-f "+cls+"' style='width:"+w+"em;height:"+h+"em;margin:-"+(h/2)+"em 0 0 -"+(w/2)+"em;"+
      "transform:"+tf+";background:"+bg+";background-size:100% 100%'>"+(inner||'')+"</div>";
  }
  function box(o){
    var w=o.w,h=o.h,d=o.d, c=o.c;
    var f=o.faces||{};
    var tf="translate3d("+(o.x||0)+"em,"+(-(o.y||0))+"em,"+(o.z||0)+"em)"+(o.rot?' '+o.rot:'');
    return "<div class='av-b"+(o.cls?' '+o.cls:'')+"' style='transform:"+tf+"'>"+
      face('av-front',w,h,'translateZ('+(d/2)+'em)',f.front||c,o.frontInner)+
      face('av-back',w,h,'rotateY(180deg) translateZ('+(d/2)+'em)',f.back||c,o.backInner)+
      face('av-right',d,h,'rotateY(90deg) translateZ('+(w/2)+'em)',f.side||c)+
      face('av-left',d,h,'rotateY(-90deg) translateZ('+(w/2)+'em)',f.side||c)+
      face('av-top',w,d,'rotateX(90deg) translateZ('+(h/2)+'em)',f.top||c)+
      face('av-bottom',w,d,'rotateX(-90deg) translateZ('+(h/2)+'em)',f.bottom||c)+
    "</div>";
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(ch){ return '&#'+ch.charCodeAt(0)+';'; }); }

  // --- Character ---------------------------------------------------------------
  // Heights (em, from the ice up): blade 0-0.6, boot 0.6-2.2, legs 2.2-10,
  // pants 10-14.6, torso 14.6-24, head 24-32. Minecraft-like 8/12/12 rhythm,
  // with hockey bulk (pants, shoulders, gloves) added on top.
  function html(look){
    look=norm(look||{});
    var skin=SKIN[look.skin]||SKIN[DEFAULT_LOOK.skin];
    var hair=HAIR[look.hair]||HAIR[DEFAULT_LOOK.hair];
    var J=JERSEY[look.jersey]||JERSEY[DEFAULT_LOOK.jersey];
    var num=esc(look.num);
    var black='#141414', steel='#C9CED3';
    var helmet=look.helmet==='chrome'?'#B8C2CC':(look.jersey==='white'?'#F2F2F2':'#141414');
    var gloveC=GLOVES[look.gloves]||black;
    var stickC=STICK[look.stick]||'#2B2B2B';

    // Jersey front/back with two arm-height stripes; number on the back.
    var torsoBg='linear-gradient(0deg,'+J.stripe+' 0 9%,'+J.trim+' 9% 12%,'+J.body+' 12% 100%)';
    var sleeveBg='linear-gradient(0deg,'+J.body+' 0 38%,'+J.trim+' 38% 44%,'+J.stripe+' 44% 58%,'+J.trim+' 58% 64%,'+J.body+' 64% 100%)';
    var sockBg='linear-gradient(0deg,'+J.body+' 0 40%,'+J.stripe+' 40% 55%,'+J.trim+' 55% 62%,'+J.body+' 62% 100%)';
    // Phase 1 pixel textures (style A). Flat tiles -- the code still shades each
    // face (top lighter, sides darker), so these must stay flat (no baked lighting).
    var JTEX={red:1,black:1,white:1};
    var jKey=JERSEY[look.jersey]?look.jersey:DEFAULT_LOOK.jersey;
    var jTex=JTEX[jKey]?"url(avatar-tex/jersey-"+jKey+".png)":J.body;
    // helmet.png is the ink (black) shell; white and chrome helmets stay flat color.
    var helTex=helmet==='#141414'?"url(avatar-tex/helmet.png)":helmet;
    var helFaces={front:helTex,back:helTex,side:helTex,top:helTex,bottom:helTex};
    var stripeTop=look.stripe&&look.stripe!=='none'
      ? 'linear-gradient(90deg,'+helmet+' 0 '+(look.stripe==='twin'?'34%,'+J.body+' 34% 42%,'+helmet+' 42% 58%,'+J.body+' 58% 66%,'+helmet+' 66%':'44%,'+J.body+' 44% 56%,'+helmet+' 56%')+')'
      : helTex;
    var helTop={front:helTex,back:helTex,side:helTex,top:stripeTop,bottom:helTex};
    var backNum="<span class='av-num' style='color:"+J.num+"'>"+num+"</span>";
    var chestNum="<span class='av-num av-num-sm' style='color:"+J.num+"'>"+num+"</span>";

    // Face: simple blocky eyes and brows, focused, not cute.
    var faceInner="<i class='av-brow l'></i><i class='av-brow r'></i><i class='av-eye l'></i><i class='av-eye r'></i><i class='av-mouth'></i>";
    // Cage: a steel grid on a see-through face.
    var cageBg='repeating-linear-gradient(90deg,'+steel+' 0 .22em,transparent .22em 1.3em),repeating-linear-gradient(0deg,'+steel+' 0 .22em,transparent .22em 1.3em)';

    var parts=[
      // Skates: blade + boot
      box({w:.5,h:.6,d:5.4,x:-2.1,y:.3,z:.6,c:steel}),
      box({w:.5,h:.6,d:5.4,x:2.1,y:.3,z:.6,c:steel}),
      box({w:3,h:1.6,d:5,x:-2.1,y:1.4,z:.6,c:black}),
      box({w:3,h:1.6,d:5,x:2.1,y:1.4,z:.6,c:black}),
      // Legs (socks over shin guards)
      box({w:3.4,h:7.8,d:3.6,x:-2.1,y:6.1,c:J.body,faces:{front:sockBg,back:sockBg,side:sockBg}}),
      box({w:3.4,h:7.8,d:3.6,x:2.1,y:6.1,c:J.body,faces:{front:sockBg,back:sockBg,side:sockBg}}),
      // Pants
      box({w:8.6,h:4.6,d:4.8,y:12.3,c:black}),
      // Torso (jersey over shoulder pads)
      box({w:9.6,h:9.4,d:5.4,y:19.3,c:J.body,faces:{front:jTex,back:jTex,side:jTex,top:jTex},frontInner:chestNum,backInner:backNum}),
      // Arms, slightly forward in a ready stance
      box({w:3.4,h:8.4,d:3.6,x:-6.6,y:19.6,z:1,c:J.body,faces:{front:sleeveBg,back:sleeveBg,side:sleeveBg},rot:'rotateX(18deg)'}),
      box({w:3.4,h:8.4,d:3.6,x:6.6,y:19.6,z:1,c:J.body,faces:{front:sleeveBg,back:sleeveBg,side:sleeveBg},rot:'rotateX(18deg)'}),
      // Gloves
      box({w:3.8,h:3.6,d:4,x:-6.6,y:14.4,z:2.6,c:gloveC}),
      box({w:3.8,h:3.6,d:4,x:6.6,y:14.4,z:2.6,c:gloveC}),
      // Head
      box({w:7.6,h:7.6,d:7.6,y:28,c:skin,frontInner:faceInner}),
      // Hair flow out the back of the helmet
      box({w:6.8,h:2.4,d:1.4,y:25.3,z:-4.2,c:hair}),
      // Helmet shell (top + back half), leaves the face open for the cage
      box({w:8.4,h:2.6,d:8.4,y:31.3,c:helmet,faces:helTop}),
      box({w:8.4,h:4.6,d:2.4,y:28.2,z:-3.2,c:helmet,faces:helFaces}),
      box({w:1,h:4.8,d:5.6,x:-4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      box({w:1,h:4.8,d:5.6,x:4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      // Cage
      "<div class='av-b' style='transform:translate3d(0,-27.4em,4.3em)'>"+face('av-cage',7.8,6.4,'none',cageBg)+"</div>",
      // Stick: shaft from the right glove to the ice, blade forward
      box({w:.7,h:18.4,d:.7,x:5.6,y:8.4,z:5,c:stickC,rot:'rotateX(-24deg) rotateZ(-8deg)'}),
      box({w:4.4,h:1.2,d:.6,x:2.9,y:.6,z:8.6,c:stickC})
    ];
    return "<div class='av-wrap' aria-hidden='true'><div class='av-scene'>"+parts.join('')+"</div></div>";
  }

  // Look for a player. Order: the server roster looks (fetched below, cached on
  // the device so the next load paints right away), then this device's saved
  // look, then the default. The number always comes from the roster.
  var teamLooks=null;
  try{ teamLooks=JSON.parse(localStorage.getItem('thwapLooksCache')||'null'); }catch(_){}
  function lookFor(p,slug){
    var look={}; for(var k in DEFAULT_LOOK) look[k]=DEFAULT_LOOK[k];
    var id=String(slug||'').toLowerCase();
    var src=null;
    if(teamLooks && teamLooks[id]) src=norm(teamLooks[id]);
    if(!src){ try{ src=(JSON.parse(localStorage.getItem('thwapLooks')||'{}'))[id]||null; }catch(_){} }
    if(src) for(var m in src) if(m!=='num') look[m]=src[m];
    look.num=(p&&p.num)||'';
    return look;
  }
  function refreshTeamLooks(){
    if(!on() || typeof fetch!=='function') return;
    try{
      fetch('/api/board?action=looks',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
        if(!j || !j.looks) return;
        teamLooks=j.looks;
        try{ localStorage.setItem('thwapLooksCache',JSON.stringify(j.looks)); }catch(_){}
        try{ document.dispatchEvent(new CustomEvent('thwap:looks')); }catch(_){}
      }).catch(function(){});
    }catch(_){}
  }
  refreshTeamLooks();

  // --- Styles -----------------------------------------------------------------
  var css=
    ".av-wrap{position:absolute;inset:0;z-index:2;pointer-events:none;perspective:60em;perspective-origin:50% 30%;"+
      "font-size:min(9px,2.2vw)}"+
    ".av-scene{position:absolute;left:50%;bottom:9%;width:0;height:0;transform-style:preserve-3d;"+
      "transform:rotateX(-10deg) rotateY(-25deg)}"+
    ".av-b{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d}"+
    ".av-f{position:absolute;left:0;top:0;backface-visibility:hidden;box-shadow:inset 0 0 0 .06em rgba(0,0,0,.35);background-size:100% 100%;image-rendering:pixelated}"+
    ".av-top{filter:brightness(1.18)}.av-right,.av-left{filter:brightness(.78)}.av-back{filter:brightness(.88)}.av-bottom{filter:brightness(.6)}"+
    ".av-cage{box-shadow:none;backface-visibility:visible;opacity:.95}"+
    ".av-num{position:absolute;left:0;right:0;top:22%;text-align:center;font:900 3.6em/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em}"+
    ".av-num-sm{font-size:2em;top:30%;left:auto;right:12%;text-align:right}"+
    ".av-eye,.av-brow,.av-mouth{position:absolute;background:#141414;display:block}"+
    ".av-eye{width:1.2em;height:1.2em;top:3.4em}.av-eye.l{left:1.4em}.av-eye.r{right:1.4em}"+
    ".av-brow{width:1.9em;height:.45em;top:2.5em}.av-brow.l{left:1.1em;transform:rotate(8deg)}.av-brow.r{right:1.1em;transform:rotate(-8deg)}"+
    ".av-mouth{width:2.4em;height:.4em;left:2.6em;top:5.6em}";
  function injectCss(){
    if(document.getElementById('av-css')) return;
    var s=document.createElement('style'); s.id='av-css'; s.textContent=css;
    (document.head||document.documentElement).appendChild(s);
  }
  injectCss();


  // --- Locker Room (Phase 1: Gear) ---------------------------------------------
  // Opens with #locker or the preview button. Tap an owned item: it goes on the
  // character and saves to the server. Tap a locked item: try it on, with the
  // progress line; nothing is saved. Unlocks come from the server only.
  var GEAR_TABS=[['skin','Skin'],['hair','Hair'],['jersey','Jersey'],['helmet','Helmet'],['stripe','Stripe'],['gloves','Gloves'],['stick','Stick']];
  var TIER_LABEL={ common:'', rare:'Rare', epic:'Epic', legendary:'Legendary' };
  var L={ data:null, look:null, saved:null, tab:'skin', trying:null, changed:false, me:null };

  function swatch(slot,short){
    var c='#888';
    if(slot==='skin') c=SKIN[short]; else if(slot==='hair') c=HAIR[short];
    else if(slot==='jersey') c=(JERSEY[short]||{}).body; else if(slot==='gloves') c=GLOVES[short];
    else if(slot==='stick') c=STICK[short]; else if(slot==='helmet') c=short==='chrome'?'#B8C2CC':'#141414';
    else if(slot==='stripe') c=short==='none'?'transparent':'#C8102E';
    return c||'#888';
  }
  function ruleText(it){
    var r=it.rule||{};
    if(r.type==='activities') return r.n+' activities';
    if(r.type==='days') return r.n+' training days';
    if(r.type==='disc') return r.n+' '+({stick:'stickhandling',shoot:'shooting',dryland:'dryland',netplay:'net play',iq:'Hockey IQ',pass:'passing'}[r.disc]||r.disc)+' drills';
    if(r.type==='coach') return 'From your coach';
    return '';
  }
  function have(it){
    var p=(L.data&&L.data.progress)||{activities:0,trainingDays:0,disciplines:{}}, r=it.rule||{};
    if(r.type==='activities') return p.activities;
    if(r.type==='days') return p.trainingDays;
    if(r.type==='disc') return (p.disciplines||{})[r.disc]||0;
    return 0;
  }
  function owned(id){ return !!(L.data && L.data.unlocked.indexOf(id)>=0); }

  function lockerCss(){
    return ".lk{position:fixed;inset:0;z-index:9999;background:var(--bg,#F3F7F4);color:var(--text,#15221B);display:flex;flex-direction:column;font-family:inherit;overflow:hidden}.lk>*{min-width:0;flex-shrink:0}.lk>.lk-grid{flex:1 1 auto;min-height:0;align-content:start}"+
      ".lk-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px}"+
      ".lk-head h2{margin:0;font-size:22px;font-weight:900}"+
      ".lk-x{width:48px;height:48px;border-radius:50%;border:1px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);font-size:20px;cursor:pointer}"+
      ".lk-stage{position:relative;height:min(46vh,380px);margin:0 16px;border-radius:16px;background:var(--soft,#E7EEE8);overflow:hidden;touch-action:none}"+
      ".lk-stage .av-wrap{font-size:min(9px,2.2vw,1.1vh)}"+
      ".lk-note{min-height:22px;margin:8px 16px 0;font-size:14px;color:var(--muted,#5F6F64);text-align:center}"+
      ".lk-tabs{display:flex;gap:8px;overflow-x:auto;padding:12px 16px 4px;scrollbar-width:none}"+
      ".lk-tab{flex:none;min-height:48px;padding:0 16px;border-radius:24px;border:1px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);font-weight:800;font-size:15px;cursor:pointer}"+
      ".lk-tab[aria-selected=true]{background:var(--text,#15221B);color:var(--bg,#F3F7F4);border-color:var(--text,#15221B)}"+
      ".lk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;padding:8px 16px 24px;overflow-y:auto}"+
      ".lk-item{position:relative;min-height:96px;border-radius:14px;border:2px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;cursor:pointer;font:inherit}"+
      ".lk-item[aria-pressed=true]{border-color:var(--linesel,#8FD65E);box-shadow:0 0 0 2px var(--linesel,#8FD65E) inset}"+
      ".lk-sw{width:34px;height:34px;border-radius:50%;border:1px solid rgba(0,0,0,.25)}"+
      ".lk-lbl{font-size:13px;font-weight:800;text-align:center;line-height:1.15}"+
      ".lk-sub{font-size:11px;color:var(--muted,#5F6F64);text-align:center;line-height:1.2}"+
      ".lk-item.locked .lk-sw{opacity:.45}"+
      ".lk-lock{position:absolute;top:6px;right:6px;width:18px;height:18px;background:var(--twi-lock) center/contain no-repeat}"+
      ".lk-tier{font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5F6F64)}"+
      ".lk-btn{position:fixed;left:12px;bottom:84px;z-index:50;min-height:48px;padding:0 16px;border-radius:24px;border:1px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18)}"+
      ".lk-msg{padding:32px 16px;text-align:center;color:var(--muted,#5F6F64)}"+
      "@media (prefers-reduced-motion:no-preference){.lk-stage .av-scene{transition:transform .25s ease}}";
  }

  function paintStage(){
    var st=document.querySelector('.lk-stage'); if(!st) return;
    var look=L.trying?L.trying.look:L.look;
    var r=norm(look); r.num=L.num||'';
    st.innerHTML=html(r);
    var sc=st.querySelector('.av-scene'); if(sc) sc.style.transform='rotateX(-10deg) rotateY('+L.spin+'deg)';
    var note=document.querySelector('.lk-note');
    if(note){
      if(L.trying){ var it=L.trying.item, h=have(it), n=(it.rule||{}).n||0;
        note.textContent=it.label+'. Unlocks at '+ruleText(it)+'. You\u2019re at '+Math.min(h,n)+'.'; }
      else note.textContent=L.status||'';
    }
  }
  function paintTabs(){
    var t=document.querySelector('.lk-tabs'); if(!t) return;
    t.innerHTML=GEAR_TABS.map(function(x){ return "<button type='button' role='tab' class='lk-tab' data-tab='"+x[0]+"' aria-selected='"+(L.tab===x[0])+"'>"+x[1]+"</button>"; }).join('');
  }
  function paintGrid(){
    var g=document.querySelector('.lk-grid'); if(!g||!L.data) return;
    var items=L.data.items.filter(function(it){ return it.slot===L.tab; });
    g.innerHTML=items.map(function(it){
      var short=it.id.slice(it.slot.length+1), own=owned(it.id), on=L.look[it.slot]===it.id;
      var sub=own?(TIER_LABEL[it.tier]||''):ruleText(it);
      var lbl=it.slot==='skin'?'Tone '+short.slice(1):(it.slot==='hair'?short.charAt(0).toUpperCase()+short.slice(1):it.label);
      return "<button type='button' class='lk-item"+(own?'':' locked')+"' data-id='"+esc(it.id)+"' aria-pressed='"+on+"'"+
        " aria-label='"+esc(lbl+(own?'':', locked, unlocks at '+ruleText(it)))+"'>"+
        (own?'':"<i class='lk-lock' aria-hidden='true'></i>")+
        "<span class='lk-sw' style='background:"+swatch(it.slot,short)+"'></span>"+
        "<span class='lk-lbl'>"+esc(lbl)+"</span>"+(sub?"<span class='lk-sub'>"+esc(sub)+"</span>":"")+"</button>";
    }).join('');
  }

  function save(prev){
    L.status='Saving...'; paintStage();
    return fetch('/api/board?action=look',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({look:L.look})})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(x){
        if(!x.ok) throw new Error((x.j&&x.j.error)||'save failed');
        L.look=x.j.look; L.changed=true; L.status='Saved.';
        try{ var c=JSON.parse(localStorage.getItem('thwapLooksCache')||'{}')||{}; c[L.me]=L.look; localStorage.setItem('thwapLooksCache',JSON.stringify(c)); teamLooks=c; }catch(_){}
        paintStage(); paintGrid();
      })
      .catch(function(){ L.look=prev; L.status='That didn\u2019t save. Try again.'; paintStage(); paintGrid(); });
  }

  function onTap(e){
    var tab=e.target.closest('.lk-tab');
    if(tab){ L.tab=tab.getAttribute('data-tab'); L.trying=null; paintTabs(); paintGrid(); paintStage(); return; }
    var b=e.target.closest('.lk-item'); if(!b||!L.data) return;
    var id=b.getAttribute('data-id'), it=null;
    for(var i=0;i<L.data.items.length;i++) if(L.data.items[i].id===id) it=L.data.items[i];
    if(!it) return;
    if(!owned(id)){
      var tryLook={}; for(var k in L.look) tryLook[k]=L.look[k]; tryLook[it.slot]=id;
      L.trying={item:it,look:tryLook}; paintStage(); return;
    }
    L.trying=null;
    if(L.look[it.slot]===id){ paintStage(); return; }
    var prev={}; for(var k2 in L.look) prev[k2]=L.look[k2];
    L.look[it.slot]=id; paintGrid(); save(prev);
    try{ if(window.thwapHaptic) window.thwapHaptic('tap'); }catch(_){}
  }

  function bindSpin(st){
    var x0=null, s0=0;
    st.addEventListener('pointerdown',function(e){ x0=e.clientX; s0=L.spin; try{ st.setPointerCapture(e.pointerId); }catch(_){} });
    st.addEventListener('pointermove',function(e){ if(x0==null) return; L.spin=s0+(e.clientX-x0)*0.8;
      var sc=st.querySelector('.av-scene'); if(sc) sc.style.transform='rotateX(-10deg) rotateY('+L.spin+'deg)'; });
    function up(){ x0=null; }
    st.addEventListener('pointerup',up); st.addEventListener('pointercancel',up);
  }

  function closeLocker(){
    var el=document.querySelector('.lk'); if(el) el.remove();
    document.removeEventListener('keydown',onKey);
    if(location.hash==='#locker'){ try{ history.replaceState(null,'',location.pathname+location.search); }catch(_){} }
    if(L.changed) location.reload(); // cards read the look once at render
  }
  function onKey(e){ if(e.key==='Escape') closeLocker(); }

  function openLocker(){
    if(document.querySelector('.lk')) return;
    if(!document.getElementById('lk-css')){ var s=document.createElement('style'); s.id='lk-css'; s.textContent=lockerCss(); document.head.appendChild(s); }
    L={ data:null, look:null, tab:'skin', trying:null, changed:false, me:null, spin:-25, status:'', num:'' };
    var el=document.createElement('div'); el.className='lk'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','Locker Room');
    el.innerHTML="<div class='lk-head'><h2>Locker Room</h2><button type='button' class='lk-x' aria-label='Close'>&#10005;</button></div>"+
      "<div class='lk-stage' aria-label='Your player. Drag to spin.'></div><div class='lk-note' aria-live='polite'></div>"+
      "<div class='lk-tabs' role='tablist'></div><div class='lk-grid'><div class='lk-msg'>Opening your locker...</div></div>";
    document.body.appendChild(el);
    el.querySelector('.lk-x').addEventListener('click',closeLocker);
    el.addEventListener('click',onTap);
    bindSpin(el.querySelector('.lk-stage'));
    document.addEventListener('keydown',onKey);
    fetch('/api/board?action=look',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():Promise.reject(r.status); }).then(function(j){
      L.data=j; L.look=j.look; L.me=j.id;
      try{ var rp=(window.THWAP_ROSTER||{}); var info=rp[j.id]||rp[j.id&&j.id.charAt(0).toUpperCase()+j.id.slice(1)]; if(info&&info.num) L.num=info.num; }catch(_){}
      var nx=(j.next||[])[0];
      L.status=nx?('Next: '+nx.label+', '+nx.left+' to go.'):'';
      paintTabs(); paintGrid(); paintStage();
    }).catch(function(code){
      var g=el.querySelector('.lk-grid'); if(g) g.innerHTML="<div class='lk-msg'>"+(code===401?'Sign in to build your player.':'Your locker didn\u2019t open. Try again in a minute.')+"</div>";
      L.look={}; paintStage();
    });
  }

  // Preview-only entry points: #locker, and a floating button while the flag is on.
  function bootLocker(){
    if(!on()) return;
    if(location.hash==='#locker') openLocker();
    window.addEventListener('hashchange',function(){ if(location.hash==='#locker') openLocker(); });
    if(!document.querySelector('.lk-btn') && document.body){
      if(!document.getElementById('lk-css')){ var s=document.createElement('style'); s.id='lk-css'; s.textContent=lockerCss(); document.head.appendChild(s); }
      var b=document.createElement('button'); b.type='button'; b.className='lk-btn'; b.textContent='Locker Room';
      b.addEventListener('click',openLocker); document.body.appendChild(b);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootLocker); else bootLocker();

  window.thwapAvatar={ on:on, html:html, lookFor:lookFor, refreshTeamLooks:refreshTeamLooks, openLocker:openLocker, norm:norm, SKIN:SKIN, HAIR:HAIR, JERSEY:JERSEY, DEFAULT_LOOK:DEFAULT_LOOK };
})();
