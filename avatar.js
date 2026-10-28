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
    white:{ body:'#F2F2F2', stripe:'#C8102E', trim:'#111111', num:'#C8102E' }
  };
  var DEFAULT_LOOK={ skin:'s3', hair:'brown', jersey:'red', num:'' };

  // --- Box builder ------------------------------------------------------------
  // All sizes are in em, so one font-size scales the whole character.
  // (x,y,z) is the box CENTER; y is height above the ice (up is positive).
  function face(cls,w,h,tf,bg,inner){
    return "<div class='av-f "+cls+"' style='width:"+w+"em;height:"+h+"em;margin:-"+(h/2)+"em 0 0 -"+(w/2)+"em;"+
      "transform:"+tf+";background:"+bg+"'>"+(inner||'')+"</div>";
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
    look=look||{};
    var skin=SKIN[look.skin]||SKIN[DEFAULT_LOOK.skin];
    var hair=HAIR[look.hair]||HAIR[DEFAULT_LOOK.hair];
    var J=JERSEY[look.jersey]||JERSEY[DEFAULT_LOOK.jersey];
    var num=esc(look.num);
    var black='#141414', helmet=look.jersey==='white'?'#F2F2F2':'#141414', steel='#C9CED3';

    // Jersey front/back with two arm-height stripes; number on the back.
    var torsoBg='linear-gradient(0deg,'+J.stripe+' 0 9%,'+J.trim+' 9% 12%,'+J.body+' 12% 100%)';
    var sleeveBg='linear-gradient(0deg,'+J.body+' 0 38%,'+J.trim+' 38% 44%,'+J.stripe+' 44% 58%,'+J.trim+' 58% 64%,'+J.body+' 64% 100%)';
    var sockBg='linear-gradient(0deg,'+J.body+' 0 40%,'+J.stripe+' 40% 55%,'+J.trim+' 55% 62%,'+J.body+' 62% 100%)';
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
      box({w:9.6,h:9.4,d:5.4,y:19.3,c:J.body,faces:{front:torsoBg,back:torsoBg,side:torsoBg,top:J.body},frontInner:chestNum,backInner:backNum}),
      // Arms, slightly forward in a ready stance
      box({w:3.4,h:8.4,d:3.6,x:-6.6,y:19.6,z:1,c:J.body,faces:{front:sleeveBg,back:sleeveBg,side:sleeveBg},rot:'rotateX(18deg)'}),
      box({w:3.4,h:8.4,d:3.6,x:6.6,y:19.6,z:1,c:J.body,faces:{front:sleeveBg,back:sleeveBg,side:sleeveBg},rot:'rotateX(18deg)'}),
      // Gloves
      box({w:3.8,h:3.6,d:4,x:-6.6,y:14.4,z:2.6,c:black}),
      box({w:3.8,h:3.6,d:4,x:6.6,y:14.4,z:2.6,c:black}),
      // Head
      box({w:7.6,h:7.6,d:7.6,y:28,c:skin,frontInner:faceInner}),
      // Hair flow out the back of the helmet
      box({w:6.8,h:2.4,d:1.4,y:25.3,z:-4.2,c:hair}),
      // Helmet shell (top + back half), leaves the face open for the cage
      box({w:8.4,h:2.6,d:8.4,y:31.3,c:helmet}),
      box({w:8.4,h:4.6,d:2.4,y:28.2,z:-3.2,c:helmet}),
      box({w:1,h:4.8,d:5.6,x:-4.2,y:27.9,z:.6,c:helmet}),
      box({w:1,h:4.8,d:5.6,x:4.2,y:27.9,z:.6,c:helmet}),
      // Cage
      "<div class='av-b' style='transform:translate3d(0,-27.4em,4.3em)'>"+face('av-cage',7.8,6.4,'none',cageBg)+"</div>",
      // Stick: shaft from the right glove to the ice, blade forward
      box({w:.7,h:15.6,d:.7,x:5.4,y:7.6,z:5.2,c:'#2B2B2B',rot:'rotateX(-24deg) rotateZ(-8deg)'}),
      box({w:4.4,h:1.2,d:.6,x:2.9,y:.6,z:8.2,c:'#2B2B2B'})
    ];
    return "<div class='av-wrap' aria-hidden='true'><div class='av-scene'>"+parts.join('')+"</div></div>";
  }

  // Look for a player: own saved look on this device, else the default with
  // their number. The server-backed look replaces this in the Phase 1 build.
  function lookFor(p,slug){
    var look={}; for(var k in DEFAULT_LOOK) look[k]=DEFAULT_LOOK[k];
    look.num=(p&&p.num)||'';
    try{
      var all=JSON.parse(localStorage.getItem('thwapLooks')||'{}');
      var mine=all[String(slug||'').toLowerCase()];
      if(mine) for(var m in mine) if(m!=='num') look[m]=mine[m];
    }catch(_){}
    return look;
  }

  // --- Styles -----------------------------------------------------------------
  var css=
    ".av-wrap{position:absolute;inset:0;z-index:2;pointer-events:none;perspective:60em;perspective-origin:50% 30%;"+
      "font-size:min(9px,2.2vw)}"+
    ".av-scene{position:absolute;left:50%;bottom:9%;width:0;height:0;transform-style:preserve-3d;"+
      "transform:rotateX(-10deg) rotateY(-25deg)}"+
    ".av-b{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d}"+
    ".av-f{position:absolute;left:0;top:0;backface-visibility:hidden;box-shadow:inset 0 0 0 .06em rgba(0,0,0,.35)}"+
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

  window.thwapAvatar={ on:on, html:html, lookFor:lookFor, SKIN:SKIN, HAIR:HAIR, JERSEY:JERSEY, DEFAULT_LOOK:DEFAULT_LOOK };
})();
