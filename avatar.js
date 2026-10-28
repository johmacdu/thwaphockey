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
  // hand/facing are free preference slots (server catalog: hand-*, facing-*).
  // grip is how the stick is held (oneHand/twoHand) -- a render default, not a
  // catalog slot, kept separate from the server's unlockable 'pose' (stances).
  var DEFAULT_LOOK={ skin:'s3', hair:'brown', hairstyle:'flow', jersey:'red', helmet:'team', gloves:'black', stick:'classic', num:'', hand:'right', facing:'left', grip:'oneHand' };

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

  // A limb as a box from point p1 to point p2 (hip->knee, shoulder->elbow, ...),
  // square section of side t. Poses become points, so elbows and knees bend on
  // their own and handedness is just an x-mirror of the points.
  function limb(p1,p2,t,c,faces){
    var dx=p2[0]-p1[0], dy=p2[1]-p1[1], dz=p2[2]-p1[2];
    var L=Math.sqrt(dx*dx+dy*dy+dz*dz)||0.0001;
    var ang=Math.acos(dy/L)*180/Math.PI;
    var rot='rotate3d('+(-dz)+',0,'+dx+','+ang+'deg)';
    return box({w:t,h:L,d:t,x:(p1[0]+p2[0])/2,y:(p1[1]+p2[1])/2,z:(p1[2]+p2[2])/2,c:c,faces:faces,rot:rot});
  }

  // --- Hair styles (Minnesota hockey hair) --------------------------------------
  // The head box spans y 24.2-31.8, z -3.8..3.8; the helmet's side pieces sit at
  // x +/-4.2 and its back piece at z -2..-4.4 down to y 25.9. Hair shows below
  // and around the helmet: out the back, and at the sides so it reads from the
  // front too. Every style is plain boxes, so it works in every future pose.
  var HAIR_STYLES={
    buzz:function(c){ return [
      box({w:.5,h:1.4,d:1.2,x:-3.95,y:25.4,z:1.6,c:c}), box({w:.5,h:1.4,d:1.2,x:3.95,y:25.4,z:1.6,c:c}) ]; },
    short:function(c){ return [
      box({w:6.8,h:1.4,d:1,y:25.3,z:-4.1,c:c}),
      box({w:.6,h:1.8,d:2.4,x:-4,y:25.3,z:1,c:c}), box({w:.6,h:1.8,d:2.4,x:4,y:25.3,z:1,c:c}) ]; },
    flow:function(c){ return [
      box({w:7.4,h:3.4,d:1.4,y:24.4,z:-4.5,c:c,rot:'rotateX(-14deg)'}),
      box({w:.8,h:2.4,d:3,x:-4.3,y:24.7,z:-.6,c:c}), box({w:.8,h:2.4,d:3,x:4.3,y:24.7,z:-.6,c:c}) ]; },
    lettuce:function(c){ return [
      box({w:8.4,h:4.6,d:1.8,y:23.8,z:-4.9,c:c,rot:'rotateX(-26deg)'}),
      box({w:1.1,h:2.8,d:3.4,x:-4.6,y:24.3,z:-.8,c:c,rot:'rotateZ(18deg)'}),
      box({w:1.1,h:2.8,d:3.4,x:4.6,y:24.3,z:-.8,c:c,rot:'rotateZ(-18deg)'}) ]; },
    // Long styles stop at y ~20.6, just above the back number (top:36%), so the
    // number stays readable on the back of the card.
    mullet:function(c){ return [
      box({w:5.4,h:5.6,d:1.2,y:23.2,z:-4.2,c:c}),
      box({w:.5,h:1.4,d:1.2,x:-3.95,y:25.4,z:1.6,c:c}), box({w:.5,h:1.4,d:1.2,x:3.95,y:25.4,z:1.6,c:c}) ]; },
    wings:function(c){ return [
      box({w:6.8,h:1.6,d:1.2,y:25.2,z:-4.2,c:c}),
      box({w:1.4,h:1.4,d:3.4,x:-4.9,y:25,z:-.4,c:c,rot:'rotateZ(38deg)'}),
      box({w:1.4,h:1.4,d:3.4,x:4.9,y:25,z:-.4,c:c,rot:'rotateZ(-38deg)'}) ]; },
    curls:function(c){ var out=[];
      [-2.6,-.9,.9,2.6].forEach(function(x,i){ out.push(box({w:1.7,h:1.7,d:1.7,x:x,y:24.9-(i%2)*.7,z:-4.5,c:c})); });
      [-1,1].forEach(function(s){ out.push(box({w:1.5,h:1.5,d:1.5,x:4.4*s,y:25.1,z:.4,c:c})); out.push(box({w:1.5,h:1.5,d:1.5,x:4.4*s,y:24.6,z:-1.8,c:c})); });
      return out; },
    ponytail:function(c){ return [
      box({w:2.2,h:1.8,d:1.6,y:26.2,z:-4.8,c:c}),
      box({w:1.6,h:4.8,d:1.4,y:23.2,z:-5.2,c:c,rot:'rotateX(8deg)'}),
      box({w:.6,h:1.8,d:2.4,x:-4,y:25.3,z:1,c:c}), box({w:.6,h:1.8,d:2.4,x:4,y:25.3,z:1,c:c}) ]; },
    braids:function(c){ return [
      box({w:1.1,h:5.2,d:1.1,x:-1.7,y:23.3,z:-4.4,c:c}), box({w:1.1,h:5.2,d:1.1,x:1.7,y:23.3,z:-4.4,c:c}),
      box({w:.6,h:1.8,d:2.4,x:-4,y:25.3,z:1,c:c}), box({w:.6,h:1.8,d:2.4,x:4,y:25.3,z:1,c:c}) ]; },
    locs:function(c){ var out=[];
      [-2.6,-1.3,0,1.3,2.6].forEach(function(x,i){ out.push(box({w:.85,h:5-(i%2)*.7,d:.85,x:x,y:23.3+(i%2)*.35,z:-4.4,c:c})); });
      [-1,1].forEach(function(s){ out.push(box({w:.8,h:4,d:.8,x:4.3*s,y:23.8,z:-.8,c:c})); out.push(box({w:.8,h:3.4,d:.8,x:4.3*s,y:24.1,z:.8,c:c})); });
      return out; }
  };
  function hairBoxes(style,c){ return (HAIR_STYLES[style]||HAIR_STYLES[DEFAULT_LOOK.hairstyle])(c).join(''); }

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
    // Pixel weave: a transparent 2x2-checker tile over every fill, so sleeves, socks,
    // pants, gloves and skates read as the same style-A fabric as the jersey (whose
    // tile bakes the weave in). It rides on top of the colorway gradients and solids,
    // so all five jersey colors still work.
    function gr(fill){ return 'url(avatar-tex/grain.png),'+fill; }
    var sleeveTx=gr(sleeveBg), sockTx=gr(sockBg);
    var pantsFaces={front:gr(black),back:gr(black),side:gr(black),top:gr(black),bottom:gr(black)};
    var gloveFaces={front:gr(gloveC),back:gr(gloveC),side:gr(gloveC),top:gr(gloveC),bottom:gr(gloveC)};
    var skateFaces={front:gr(black),back:gr(black),side:gr(black),top:gr(black),bottom:gr(black)};
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

    // Handedness: lefty puts the right hand on top of the stick; righty the left.
    // Mirror every arm/stick point across x; the blade follows to the matching side.
    var lefty=(look.hand==='left');
    function M(p){ return lefty?[-p[0],p[1],p[2]]:p; }

    var shTop=M([-4.6,22.4,1]), shBot=M([4.6,22.4,1]);       // shoulders
    // Arm + stick points per pose. elTop/elBot are elbows (= Phase-3 elbow joints).
    var elTop,elBot,handTop,handBot,knob,ice,bladeToe;
    if(look.grip==='twoHand'){
      // Two-handed ready grip: both hands in front, top hand on the knob, bottom a
      // forearm down the shaft, blade flat on the ice.
      elTop=M([-3.5,16.5,3.6]); elBot=M([4,14.6,4.2]);
      handTop=M([0.4,12.5,6]); handBot=M([1.2,9,7]);
      knob=M([0.1,13.7,5.7]); ice=M([3.2,0.7,9.6]); bladeToe=M([3.2,0.8,12.8]);
    } else {
      // One-handed knob hold (card default): top hand on the knob, stick angled down
      // to the ice in front; the other arm hangs relaxed at the side.
      elTop=M([-4.8,18,3.6]); handTop=M([-2.3,13.8,5.4]);
      knob=M([-2.6,14.6,5.1]); ice=M([0.6,0.7,9.5]); bladeToe=M([0.6,0.8,12.7]);
      elBot=M([5.3,17.4,1.4]); handBot=M([4.8,12.8,1.8]);   // arm hangs at the side
    }

    // Legs: hockey pants (breezers) cover hips + thighs to the knee, so only the
    // shin (sock) shows below. Knee pushed forward for an athletic stance; the knee
    // is a real joint now (Phase-3 ready), capped by the shin-guard pad.
    var kneeBend=1.5;
    var kneeL=[-2.1,6.2,kneeBend], ankL=[-2.1,2.4,.6];
    var kneeR=[2.1,6.2,kneeBend], ankR=[2.1,2.4,.6];

    var parts=[
      // Skates: blade + boot
      box({w:.5,h:.6,d:5.4,x:-2.1,y:.3,z:.6,c:steel}),
      box({w:.5,h:.6,d:5.4,x:2.1,y:.3,z:.6,c:steel}),
      box({w:3,h:1.6,d:5,x:-2.1,y:1.4,z:.6,c:black,faces:skateFaces}),
      box({w:3,h:1.6,d:5,x:2.1,y:1.4,z:.6,c:black,faces:skateFaces}),
      // Shins (socks over shin guards), knee -> ankle: the bent knee shows here.
      limb(kneeL,ankL,3.4,J.body,{front:sockTx,back:sockTx,side:sockTx,top:sockTx}),
      limb(kneeR,ankR,3.4,J.body,{front:sockTx,back:sockTx,side:sockTx,top:sockTx}),
      // Knee caps (shin-guard pads) at the bend, bulging forward past the pant hem.
      box({w:3.6,h:2.8,d:3.8,x:kneeL[0],y:kneeL[1],z:kneeL[2]+.3,c:J.body,faces:{front:sockTx,back:sockTx,side:sockTx,top:sockTx,bottom:sockTx}}),
      box({w:3.6,h:2.8,d:3.8,x:kneeR[0],y:kneeR[1],z:kneeR[2]+.3,c:J.body,faces:{front:sockTx,back:sockTx,side:sockTx,top:sockTx,bottom:sockTx}}),
      // Hockey pants (breezers) to the knees: bulky, cover hips + thighs.
      box({w:9,h:8,d:5.2,y:11,c:black,faces:pantsFaces}),
      // Torso (jersey over shoulder pads)
      box({w:9.6,h:9.4,d:5.4,y:19.3,c:J.body,faces:{front:jTex,back:jTex,side:jTex,top:jTex},frontInner:chestNum,backInner:backNum}),
      // Arms: upper arm (shoulder->elbow) + forearm (elbow->hand), bending onto the
      // stick so the character actually holds it (both hands land on the grip).
      limb(shTop,elTop,3.4,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(elTop,handTop,3.2,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(shBot,elBot,3.4,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(elBot,handBot,3.2,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      // Gloves at the two grip points
      box({w:3.8,h:3.4,d:3.8,x:handTop[0],y:handTop[1],z:handTop[2],c:gloveC,faces:gloveFaces}),
      box({w:3.8,h:3.4,d:3.8,x:handBot[0],y:handBot[1],z:handBot[2],c:gloveC,faces:gloveFaces}),
      // Head
      box({w:7.6,h:7.6,d:7.6,y:28,c:skin,frontInner:faceInner}),
      // Hair: style is a few boxes around the helmet (see hairBoxes).
      hairBoxes(look.hairstyle||DEFAULT_LOOK.hairstyle, hair),
      // Helmet shell (top + back half), leaves the face open for the cage
      box({w:8.4,h:2.6,d:8.4,y:31.3,c:helmet,faces:helTop}),
      box({w:8.4,h:4.6,d:2.4,y:28.2,z:-3.2,c:helmet,faces:helFaces}),
      box({w:1,h:4.8,d:5.6,x:-4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      box({w:1,h:4.8,d:5.6,x:4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      // Cage
      "<div class='av-b' style='transform:translate3d(0,-27.4em,4.3em)'>"+face('av-cage',7.8,6.4,'none',cageBg)+"</div>",
      // Stick (knob -> ice shaft, white tape at the heel, blade along the ice to the
      // toe). Recolored by the unlocked stick (stickC: classic / wood / gold).
      limb(knob,ice,1.3,stickC),
      box({w:1.5,h:1.6,d:1.6,x:ice[0],y:2.2,z:ice[2]-0.4,c:'#E8E8E8'}),
      box({w:1.4,h:2.2,d:(bladeToe[2]-ice[2]),x:ice[0],y:1.3,z:(ice[2]+bladeToe[2])/2,c:stickC})
    ];
    // Facing: left 3/4 is the default; right mirrors it, center faces head-on. Set
    // as a CSS var so the builder's spin and the mini previews still win.
    var faceY=(look.facing==='right')?25:((look.facing==='center')?0:-25);
    return "<div class='av-wrap' aria-hidden='true'><div class='av-scene' style='--av-face:"+faceY+"deg'>"+parts.join('')+"</div></div>";
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
      "transform:rotateX(-10deg) rotateY(var(--av-face,-25deg))}"+
    ".av-b{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d}"+
    ".av-f{position:absolute;left:0;top:0;backface-visibility:hidden;box-shadow:inset 0 0 0 .06em rgba(0,0,0,.35);background-size:100% 100%;image-rendering:pixelated}"+
    ".av-top{filter:brightness(1.18)}.av-right,.av-left{filter:brightness(.78)}.av-back{filter:brightness(.88)}.av-bottom{filter:brightness(.6)}"+
    ".av-cage{box-shadow:none;backface-visibility:visible;opacity:.95}"+
    ".av-num{position:absolute;left:0;right:0;top:36%;text-align:center;font:900 3.6em/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em}"+
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


  // --- My Player (Phase 1: Gear) ---------------------------------------------
  // Opens from the My Player button on the player's own card. Tap an owned item: it goes on the
  // character and saves to the server. Tap a locked item: try it on, with the
  // progress line; nothing is saved. Unlocks come from the server only.
  var GEAR_TABS=[['skin','Skin'],['hairstyle','Hair'],['hair','Hair color'],['jersey','Jersey'],['helmet','Helmet'],['stripe','Stripe'],['gloves','Gloves'],['stick','Stick'],['hand','Shot'],['facing','View']];
  var TIER_LABEL={ common:'', rare:'Pro', epic:'All-Star', legendary:'Legend' };
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
    if(r.type==='activities') return 'Finish '+r.n+' drills';
    if(r.type==='days') return 'Train '+r.n+' days';
    if(r.type==='disc') return 'Finish '+r.n+' '+({stick:'Hands',shoot:'Shooting',dryland:'Dryland',netplay:'Net play',iq:'Hockey IQ',pass:'Passing'}[r.disc]||r.disc)+' drills';
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
  // Hair style tiles show a small back view of the player's own head with that
  // style, in their own hair color, so the kid sees exactly what they will get.
  function miniHead(style){
    var look=norm(L.look||{}); look.hairstyle=style; look.num='';
    return "<span class='lk-mini' aria-hidden='true'>"+html(look)+"</span>";
  }
  // Preview a free preference (hand/facing) on the player, seen from the front
  // (not the hair back-view) so the stick side and the facing read.
  function miniOpt(slot,val){
    var look=norm(L.look||{}); look[slot]=val; look.num='';
    return "<span class='lk-mini face' aria-hidden='true'>"+html(look)+"</span>";
  }

  // First-run builder: three steps, everything pre-picked, so a kid can tap Done.
  var BUILD_STEPS=[['skin','Pick your skin tone'],['hairstyle','Pick your hockey hair'],['hair','Pick your hair color'],['jersey','Pick your jersey'],['hand','Which way do you shoot?'],['facing','Which way to face?']];
  // Hair is easiest to judge from behind, so those tabs turn the player around.
  // Facing turns the player to the picked side so the stage shows the real view.
  function faceSpin(f){ return f==='right'?25:(f==='center'?0:-25); }
  function spinFor(tab){ return (tab==='hair'||tab==='hairstyle')?150:(tab==='facing'?faceSpin(norm(L.look||{}).facing):-25); }
  // Unlock tracking on this device: ids already shown, and ids still marked New.
  function readList(k){ try{ var v=JSON.parse(localStorage.getItem(k)||'null'); return Array.isArray(v)?v:null; }catch(_){ return null; } }
  function writeList(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(_){} }
  function isNew(id){ var n=readList('thwapUnlockNew')||[]; return n.indexOf(id)>=0; }

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
      ".lk-mini{position:relative;display:block;width:64px;height:52px;overflow:hidden;pointer-events:none}"+
      ".lk-mini .av-wrap{font-size:3.2px;perspective:none}"+
      ".lk-mini .av-scene{bottom:-58px;transform:rotateX(-8deg) rotateY(150deg)}"+
      ".lk-mini.face .av-scene{transform:rotateX(-8deg) rotateY(var(--av-face,-25deg))}"+
      ".lk-lbl{font-size:13px;font-weight:800;text-align:center;line-height:1.15}"+
      ".lk-sub{font-size:11px;color:var(--muted,#5F6F64);text-align:center;line-height:1.2}"+
      ".lk-item.locked .lk-sw{opacity:.45}"+
      ".lk-lock{position:absolute;top:6px;right:6px;width:18px;height:18px;background:var(--twi-lock) center/contain no-repeat}"+
      ".lk-tier{font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5F6F64)}"+
      ".lk-btn{position:fixed;left:12px;bottom:84px;z-index:50;min-height:48px;padding:0 16px;border-radius:24px;border:1px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);font-weight:900;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18)}"+
      ".lk-msg{padding:32px 16px;text-align:center;color:var(--muted,#5F6F64)}"+
      ".lk-step{padding:12px 16px 4px;font-size:16px;font-weight:900}.lk-step small{display:block;font-size:13px;font-weight:700;color:var(--muted,#5F6F64)}"+
      ".lk-foot{padding:8px 16px 16px;display:flex;gap:8px}"+
      ".lk-go{flex:1;min-height:52px;border-radius:26px;border:0;background:var(--text,#15221B);color:var(--bg,#F3F7F4);font-weight:900;font-size:17px;cursor:pointer}"+
      ".lk-back{min-height:52px;padding:0 20px;border-radius:26px;border:1px solid var(--line,#DCE5DE);background:var(--card,#fff);color:var(--text,#15221B);font-weight:800;cursor:pointer}"+
      ".lk-new{position:absolute;top:6px;left:6px;font-size:10px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:8px;background:var(--lime,#B9F06B);color:#15221B}"+
      ".lk-dot{display:inline-block;vertical-align:middle;width:10px;height:10px;border-radius:50%;background:var(--lime,#B9F06B);margin-left:8px;box-shadow:0 0 0 2px var(--card,#fff)}"+
      ".lk-toast{position:fixed;left:50%;bottom:24px;z-index:10000;transform:translateX(-50%);min-height:56px;max-width:min(92vw,420px);display:flex;align-items:center;gap:12px;padding:8px 18px 8px 10px;border-radius:28px;border:2px solid var(--lime,#B9F06B);background:var(--card,#fff);color:var(--text,#15221B);font:inherit;font-weight:900;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25)}"+
      ".lk-toast .lk-sw{flex:none}.lk-toast small{display:block;font-weight:700;font-size:12px;color:var(--muted,#5F6F64)}"+
      "@media (prefers-reduced-motion:no-preference){.lk-stage .av-scene{transition:transform .25s ease}"+
        ".lk-toast{animation:lkUp .3s ease-out}@keyframes lkUp{from{transform:translate(-50%,24px);opacity:0}to{transform:translate(-50%,0);opacity:1}}"+
        ".av-reveal .av-scene{animation:avDrop .35s cubic-bezier(.2,.9,.3,1.2)}@keyframes avDrop{from{translate:0 -6em;opacity:0}to{translate:0 0;opacity:1}}}";
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
        note.textContent=it.label+'. '+ruleText(it)+' to unlock. You\u2019re at '+Math.min(h,n)+'.'; }
      else note.textContent=L.status||'';
    }
  }
  function paintTabs(){
    var t=document.querySelector('[data-lk=tabs]'); if(!t) return;
    var foot=document.querySelector('.lk-foot');
    if(L.build!=null){
      var st=BUILD_STEPS[L.build];
      t.className='lk-step'; t.removeAttribute('role');
      t.innerHTML="<small>Step "+(L.build+1)+" of "+BUILD_STEPS.length+"</small>"+st[1];
      if(foot){ foot.hidden=false; foot.innerHTML=(L.build>0?"<button type='button' class='lk-back' data-build='back'>Back</button>":"")+
        "<button type='button' class='lk-go' data-build='next'>"+(L.build===BUILD_STEPS.length-1?'Done':'Next')+"</button>"; }
      return;
    }
    t.className='lk-tabs'; t.setAttribute('role','tablist');
    if(foot){ foot.hidden=true; foot.innerHTML=''; }
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
        " aria-label='"+esc(lbl+(own?'':', locked. '+ruleText(it)+' to unlock'))+"'>"+
        (own?'':"<i class='lk-lock' aria-hidden='true'></i>")+(own&&isNew(it.id)?"<i class='lk-new'>New</i>":"")+
        (it.slot==='hairstyle'?miniHead(short):(it.slot==='hand'||it.slot==='facing')?miniOpt(it.slot,short):"<span class='lk-sw' style='background:"+swatch(it.slot,short)+"'></span>")+
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
    var nav=e.target.closest('[data-build]');
    if(nav){
      if(nav.getAttribute('data-build')==='back'){ L.build=Math.max(0,L.build-1); }
      else if(L.build<BUILD_STEPS.length-1){ L.build++; }
      else { finishBuild(); return; }
      L.tab=BUILD_STEPS[L.build][0]; L.trying=null; L.spin=spinFor(L.tab); paintTabs(); paintGrid(); paintStage(); return;
    }
    var tab=e.target.closest('.lk-tab');
    if(tab){ L.tab=tab.getAttribute('data-tab'); L.trying=null; L.spin=spinFor(L.tab); paintTabs(); paintGrid(); paintStage(); return; }
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
    L.look[it.slot]=id; paintGrid();
    if(it.slot==='facing') L.spin=faceSpin(id.slice(it.slot.length+1)); // turn the stage to the picked view
    if(L.build!=null){ paintStage(); return; } // the builder saves once, on Done
    save(prev);
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

  function finishBuild(){
    var prev={}; for(var k in L.look) prev[k]=L.look[k];
    save(prev).then(function(){
      if(!L.changed) return; // save failed; the note says so and the kid can retry
      try{ sessionStorage.setItem('thwapReveal','1'); }catch(_){}
      closeLocker();
    });
  }

  function closeLocker(){
    var el=document.querySelector('.lk'); if(el) el.remove();
    document.removeEventListener('keydown',onKey);
    if(location.hash==='#myplayer'){ try{ history.replaceState(null,'',location.pathname+location.search); }catch(_){} }
    if(L.changed){
      // Every card on the page (home, deck, roster) reads the look when it is
      // drawn. Opened from the card: redraw that card now and refresh the rest
      // when the card closes. Opened anywhere else: reload once.
      window.__thwapLookChanged=true;
      if(L.onClose){ try{ L.onClose(); }catch(_){} } else location.reload();
    }
  }
  function onKey(e){ if(e.key==='Escape') closeLocker(); }

  function openLocker(opts){
    opts=opts||{};
    if(document.querySelector('.lk')) return;
    if(!document.getElementById('lk-css')){ var s=document.createElement('style'); s.id='lk-css'; s.textContent=lockerCss(); document.head.appendChild(s); }
    L={ onClose:opts.onClose||null, data:null, look:null, tab:opts.tab||'skin', trying:null, changed:false, me:null, spin:-25, status:'', num:'', build:null };
    var el=document.createElement('div'); el.className='lk'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','My Player');
    el.innerHTML="<div class='lk-head'><h2>My Player</h2><button type='button' class='lk-x' aria-label='Close'>&#10005;</button></div>"+
      "<div class='lk-stage' aria-label='Your player. Drag to spin.'></div><div class='lk-note' aria-live='polite'></div>"+
      "<div class='lk-tabs' role='tablist' data-lk='tabs'></div><div class='lk-grid'><div class='lk-msg'>Getting your player...</div></div><div class='lk-foot' hidden></div>";
    document.body.appendChild(el);
    el.querySelector('.lk-x').addEventListener('click',closeLocker);
    el.addEventListener('click',onTap);
    bindSpin(el.querySelector('.lk-stage'));
    document.addEventListener('keydown',onKey);
    fetch('/api/board?action=look',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():Promise.reject(r.status); }).then(function(j){
      L.data=j; L.look=j.look; L.me=j.id;
      try{ var rp=(window.THWAP_ROSTER||{}); var info=rp[j.id]||rp[j.id&&j.id.charAt(0).toUpperCase()+j.id.slice(1)]; if(info&&info.num) L.num=info.num; }catch(_){}
      var nx=(j.next||[])[0];
      L.status=nx?('Next up: '+nx.label+'. '+nx.left+' to go.'):'';
      if(!j.saved || opts.builder){ L.build=0; L.tab=BUILD_STEPS[0][0]; L.status=''; }
      L.spin=spinFor(L.tab); // open at the right angle (hair from behind, facing to its side)
      if(!readList('thwapUnlockSeen')) writeList('thwapUnlockSeen',j.unlocked||[]);
      paintTabs(); paintGrid(); paintStage();
      // New tags show once: opening the My Player counts as seeing them.
      writeList('thwapUnlockNew',[]); clearDot();
    }).catch(function(code){
      var g=el.querySelector('.lk-grid'); if(g) g.innerHTML="<div class='lk-msg'>"+(code===401?'Sign in to build your player.':'Your player didn\u2019t load. Try again in a minute.')+"</div>";
      L.look={}; paintStage();
    });
  }

  // --- Unlock moment ---------------------------------------------------------
  // After a drill is marked done, ask the server what is unlocked now. Anything
  // not seen on this device before gets a short "New gear!" moment that never
  // blocks the next tap, a New tag in the My Player, and a dot on its button.
  var toastTimer=null;
  function itemName(j,id){ for(var i=0;i<(j.items||[]).length;i++) if(j.items[i].id===id) return j.items[i]; return null; }
  function showToast(it,count){
    var old=document.querySelector('.lk-toast'); if(old) old.remove();
    var short=it.id.slice(it.slot.length+1);
    var b=document.createElement('button'); b.type='button'; b.className='lk-toast'; b.setAttribute('role','status');
    b.innerHTML="<span class='lk-sw' style='background:"+swatch(it.slot,short)+"'></span><span>New gear! "+esc(it.label)+
      (count>1?' and '+(count-1)+' more':'')+"<small>Tap to try it on</small></span>";
    b.addEventListener('click',function(){ b.remove(); if(window.thwapOpenMyPlayer) window.thwapOpenMyPlayer({tab:it.slot}); else openLocker({tab:it.slot}); });
    document.body.appendChild(b);
    try{ if(window.thwapSfx) window.thwapSfx('cardOpen'); }catch(_){}
    try{ if(window.thwapHaptic) window.thwapHaptic('done'); }catch(_){}
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ if(b.parentNode) b.remove(); },5000);
  }
  // Dot on the card's Edit player button while new gear is waiting.
  var DOT_TARGETS='#cardImageBtn';
  function markDot(){
    var els=document.querySelectorAll(DOT_TARGETS);
    for(var i=0;i<els.length;i++){ var btn=els[i];
      if(!btn.querySelector('.lk-dot')){ var d=document.createElement('i'); d.className='lk-dot'; d.setAttribute('aria-label','new gear'); btn.appendChild(d); } }
  }
  function clearDot(){ var ds=document.querySelectorAll('.lk-dot'); for(var i=0;i<ds.length;i++) ds[i].remove(); }
  function checkUnlocks(){
    if(!on() || typeof fetch!=='function') return Promise.resolve(null);
    return fetch('/api/board?action=look',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
      if(!j) return null;
      var seen=readList('thwapUnlockSeen');
      if(!seen){ writeList('thwapUnlockSeen',j.unlocked||[]); return j; } // first look: past training is the builder's job
      var unseen=(j.unlocked||[]).filter(function(id){ return seen.indexOf(id)<0; });
      // Free starting items are never "earned", so they join silently.
      var fresh=unseen.filter(function(id){ var it=itemName(j,id); return it && it.rule && it.rule.type!=='start'; });
      if(unseen.length) writeList('thwapUnlockSeen',seen.concat(unseen));
      if(fresh.length){
        writeList('thwapUnlockNew',(readList('thwapUnlockNew')||[]).concat(fresh));
        var first=itemName(j,fresh[0]);
        if(first && !document.querySelector('.lk')) showToast(first,fresh.length);
      }
      if((readList('thwapUnlockNew')||[]).length) markDot();
      return j;
    }).catch(function(){ return null; });
  }
  function hookMarkDone(){
    var orig=window.thwapMarkDone;
    if(typeof orig!=='function' || orig.__avHooked) return;
    var wrapped=function(discipline,drillId,undo){
      var p=orig.apply(this,arguments);
      if(!undo) Promise.resolve(p).then(function(r){ if(!r || r.ok!==false) setTimeout(checkUnlocks,300); });
      return p;
    };
    wrapped.__avHooked=true;
    window.thwapMarkDone=wrapped;
  }

  // Entry points: the My Player button on the player's own card (index.html),
  // the New gear toast, the first-run builder, and #myplayer for testing.
  function bootLocker(){
    if(!on()) return;
    try{ if(sessionStorage.getItem('thwapReveal')){ sessionStorage.removeItem('thwapReveal');
      document.body.classList.add('av-reveal'); setTimeout(function(){ document.body.classList.remove('av-reveal'); },800);
      try{ if(window.thwapSfx) window.thwapSfx('cardOpen'); }catch(_){} } }catch(_){}
    if(location.hash==='#myplayer') openLocker();
    window.addEventListener('hashchange',function(){ if(location.hash==='#myplayer') openLocker(); });
    // The entry point is the player's own card (My Player button), not a
    // floating button. Styles are needed up front for the dot and the toast.
    if(!document.getElementById('lk-css')){ var s=document.createElement('style'); s.id='lk-css'; s.textContent=lockerCss(); document.head.appendChild(s); }
    if((readList('thwapUnlockNew')||[]).length) markDot();
    window.addEventListener('load',function(){ if((readList('thwapUnlockNew')||[]).length) markDot(); });
    hookMarkDone(); window.addEventListener('load',hookMarkDone);
    // First visit: open the builder once if this player has never saved a look.
    if(location.hash!=='#myplayer'){
      checkUnlocks().then(function(j){
        var offered=false; try{ offered=!!localStorage.getItem('thwapBuilderOffered'); }catch(_){}
        if(j && !j.saved && !offered){ try{ localStorage.setItem('thwapBuilderOffered','1'); }catch(_){} if(window.thwapOpenMyPlayer) window.thwapOpenMyPlayer({builder:true}); else openLocker({builder:true}); }
      });
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootLocker); else bootLocker();

  window.thwapAvatar={ on:on, html:html, lookFor:lookFor, refreshTeamLooks:refreshTeamLooks, openLocker:openLocker, checkUnlocks:checkUnlocks, norm:norm, SKIN:SKIN, HAIR:HAIR, JERSEY:JERSEY, DEFAULT_LOOK:DEFAULT_LOOK };
})();
