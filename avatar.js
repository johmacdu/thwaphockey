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

  // --- Launch switch -------------------------------------------------------------
  // LIVE is THE switch. false: the character only shows on a device that opted in
  // with ?avatar=1 (preview). true: every player gets the character and Edit
  // player; player photos stop being fetched or shown, and photo upload is gone.
  // Flipping this one line is the whole launch.
  var LIVE=true;

  // --- Preview flag (only matters while LIVE is false) ----------------------------
  try{
    var q=(location.search||'').match(/[?&]avatar=([01])/);
    if(q){ if(q[1]==='1') localStorage.setItem('thwapAvatarPreview','1'); else localStorage.removeItem('thwapAvatarPreview'); }
  }catch(_){}
  function on(){ if(LIVE) return true; try{ return localStorage.getItem('thwapAvatarPreview')==='1'; }catch(_){ return false; } }

  // --- Palette (placeholder colors until the art kit lands) -------------------
  // Skin: a fair->deep ramp. s1-s6 are the originals (do not renumber -- stored
  // looks reference them); s7-s11 fill the gaps and extend the range.
  var SKIN={ s1:'#F4D3B5', s2:'#E6B793', s3:'#C99470', s4:'#A26E4B', s5:'#7A4E32', s6:'#4E3121',
    s7:'#F0C9A8', s8:'#D8A87E', s9:'#B07E54', s10:'#8A5A38', s11:'#2F1D12' };
  // Hair colors: the common natural shades (single-word keys so the label reads
  // cleanly next to the swatch).
  var HAIR={ black:'#1E1A18', brown:'#5A3A22', auburn:'#8A3B1E', blonde:'#D9B163', red:'#B5522A', grey:'#9A9A9A',
    cocoa:'#3B2515', chestnut:'#8B5A2B', sandy:'#AF8C56', platinum:'#ECE0B8', white:'#EDEDED' };
  var JERSEY={
    red:  { body:'#C8102E', stripe:'#111111', trim:'#FFFFFF', num:'#FFFFFF' },
    black:{ body:'#151515', stripe:'#C8102E', trim:'#FFFFFF', num:'#FFFFFF' },
    white:{ body:'#F2F2F2', stripe:'#C8102E', trim:'#111111', num:'#C8102E' },
    forest:{ body:'#1F5A3A', stripe:'#F2F2F2', trim:'#111111', num:'#FFFFFF' },
    legend:{ body:'#D4A72C', stripe:'#111111', trim:'#FFFFFF', num:'#111111' },
    pond:{ body:'#8CC8EA', stripe:'#F2F2F2', trim:'#16365C', num:'#16365C' },
    warmup:{ body:'#5B6670', stripe:'#C8102E', trim:'#111111', num:'#FFFFFF' }
  };
  var GLOVES={ black:'#141414', red:'#C8102E', white:'#EDEDED', ice:'#BFE6F2',
    rangers:'linear-gradient(0deg,#C8102E 0 34%,#141414 34% 100%)' }; // team set: red cuffs
  // Team set (Phase 4): stick tape, helmet decal and socks.
  var TAPE={ white:'#E8E8E8', rangers:'repeating-linear-gradient(90deg,#C8102E 0 .35em,#111111 .35em .7em)' };
  var SOCKS_RANGERS='repeating-linear-gradient(0deg,#111111 0 18%,#F2F2F2 18% 22%,#C8102E 22% 40%,#F2F2F2 40% 44%)'; // bold hoops
  var STICK={ classic:'#2B2B2B', wood:'#B07A45', red:'#C8102E', gold:'#D4A72C' };
  var HELMET={ chrome:'#B8C2CC', red:'#C8102E' };
  var CAGE={ steel:'#C9CED3', black:'#1A1A1A' };
  // hand/facing are free preference slots (server catalog: hand-*, facing-*).
  // grip is how the stick is held (oneHand/twoHand) -- a render default, not a
  // catalog slot, kept separate from the server's unlockable 'pose' (stances).
  var DEFAULT_LOOK={ tape:'white', decal:'none', socks:'match', skin:'s3', hair:'brown', hairstyle:'flow', jersey:'red', helmet:'team', cage:'steel', gloves:'black', stick:'classic', num:'', hand:'right', facing:'left', grip:'oneHand' };

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
      return out; },
    // Big round volume at the back and sides.
    afro:function(c){ return [
      box({w:9,h:5.2,d:2.4,y:24.6,z:-4.7,c:c}),
      box({w:2,h:5,d:4.6,x:-4.7,y:25,z:-.2,c:c}), box({w:2,h:5,d:4.6,x:4.7,y:25,z:-.2,c:c}),
      box({w:7.2,h:1.6,d:1.2,y:21.6,z:-4.5,c:c}) ]; },
    // A bun high on the back of the head, thin hair at the nape and sides.
    bun:function(c){ return [
      box({w:3.2,h:3.2,d:2.8,y:29.2,z:-5,c:c}),
      box({w:6.8,h:1.4,d:1,y:25.3,z:-4.1,c:c}),
      box({w:.6,h:1.8,d:2.4,x:-4,y:25.3,z:1,c:c}), box({w:.6,h:1.8,d:2.4,x:4,y:25.3,z:1,c:c}) ]; },
    // Two tied bunches out the sides.
    pigtails:function(c){ return [
      box({w:6.8,h:1.4,d:1,y:25.3,z:-4.1,c:c}),
      box({w:1.8,h:1.8,d:1.8,x:-4.6,y:26.4,z:-.6,c:c}), box({w:1.5,h:3.8,d:1.5,x:-5,y:23.6,z:-.6,c:c}),
      box({w:1.8,h:1.8,d:1.8,x:4.6,y:26.4,z:-.6,c:c}), box({w:1.5,h:3.8,d:1.5,x:5,y:23.6,z:-.6,c:c}) ]; }
  };
  function hairBoxes(style,c){ return (HAIR_STYLES[style]||HAIR_STYLES[DEFAULT_LOOK.hairstyle])(c).join(''); }

  // --- Stances (Phase 3) ---------------------------------------------------------
  // A stance is joint points, not art: elbows, stick (knob -> heel -> toe, the
  // hands ride the shaft at bot), knees and ankles, plus how far the upper body
  // leans forward (lean, degrees), sinks toward the ice (drop, em) and tilts the
  // head (head, degrees; negative = chin up). Points are for a right-handed shot;
  // lefties mirror across x. Keys are the catalog ids without 'pose-' (the ids
  // predate the names: pose-dangle is 'Toe drag', pose-stickhandling is 'Dangle').
  // 'ready' has no entry on purpose: it is the card's standing grip, unchanged.
  var POSES={
    // Dangle: very wide and low, stick reaching far out to the forehand side,
    // puck on the blade. The shape that reads: arms and stick out to one side.
    stickhandling:{ lean:18, drop:1.8, bot:.36,
      elTop:[-1.6,15,4.4], elBot:[6.6,12.6,.6],
      knob:[1.4,12.8,4.4], heel:[9.4,0.7,-7.2], toe:[10.2,0.8,-4.4], puck:[7.6,.5,-5.6],
      kneeL:[-3.8,5.2,2.2], ankL:[-4.4,2.4,.6], kneeR:[3.8,5.2,2.2], ankR:[4.4,2.4,.6], skL:-12, skR:12 },
    // Toe drag: body tips over the bent backhand leg, the other leg kicked
    // straight out, puck pulled back beside the back skate on the blade's toe.
    dangle:{ lean:14, drop:1.4, roll:-14, bot:.36,
      elTop:[-5.6,14.8,4], elBot:[1.6,13,6.4],
      knob:[-1,12.6,6.4], heel:[-9.8,0.7,-1.6], toe:[-7.6,0.8,1], puck:[-9,.5,.2],
      kneeL:[-3.4,5,2], ankL:[-3.8,2.4,.4], kneeR:[5,6.4,.8], ankR:[8.4,2.4,.4], skR:20 },
    // Snipe: shot follow-through, blade up high, back leg extended.
    shooting:{ lean:8, drop:0, bot:.32,
      elTop:[-4.4,18.6,3.6], elBot:[3.6,19,6.4],
      knob:[-1.8,16.4,5.2], heel:[4.6,21.6,9.6], toe:[6.4,22.8,10.4],
      kneeL:[-2.2,6.4,2.8], ankL:[-2.2,2.4,1.8], kneeR:[2.4,6.6,-1], ankR:[2.6,2.6,-3] },
    // Tape to tape: standing tall after the pass, arms straight out, stick pointing
    // at the target, the puck already sliding away across the ice.
    passing:{ lean:4, drop:0, bot:.3,
      elTop:[-2.6,18.4,6.4], elBot:[2.4,17.2,8],
      knob:[0.6,16.8,8.4], heel:[-6.2,7,8.4], toe:[-9,7.6,8.8], puck:[-9.4,.5,1.8],
      kneeL:[-2.2,6.4,2.4], ankL:[-2.2,2.4,1.4], kneeR:[2.4,6.4,.4], ankR:[2.6,2.4,-1] },
    // Head up: skating stride, one hand pushing the puck ahead, the free arm
    // pointing out and up the ice at the play (across the card, not at the
    // viewer, so it reads at roster size), chin well up.
    reading:{ lean:6, drop:.4, head:-26, bot:.36,
      elTop:[-4.6,17,4.4], elBot:[8,21.4,1.8], handBot:[11.4,24.6,2.8],
      knob:[-2.4,13.6,5.6], heel:[-1.6,0.7,3.4], toe:[-4.2,0.8,4], puck:[-3.4,.5,2.2],
      kneeL:[-2.2,6,2.6], ankL:[-2.2,2.4,1.2], kneeR:[2.4,6.8,-2.4], ankR:[2.8,7.4,-6.4], skR:-30 },
    // Power (dryland): deep squat, stick held level across the body, arms out front.
    power:{ lean:12, drop:2.2,
      elTop:[-5.6,16.4,5.2], elBot:[5.6,16.4,5.2], handTop:[-4,15.6,8.4], handBot:[4,15.6,8.4],
      knob:[-6.4,15.6,8.4], heel:[6.4,15.6,8.4], toe:[6.6,13.6,8.4],
      kneeL:[-3.2,5,3], ankL:[-3.4,2.4,.6], kneeR:[3.2,5,3], ankR:[3.4,2.4,.6] },
    // Big save: butterfly. Knees on the ice, pads flared, glove up, paddle down.
    butterfly:{ lean:4, drop:5.4,
      elTop:[-6.6,13.4,3.4], handTop:[-7,16.4,5.6], elBot:[6.6,12.4,3.6], handBot:[4,9,6.6],
      knob:[4,9.4,6.4], heel:[1.6,0.7,11], toe:[-1.8,0.8,11.4],
      kneeL:[-3,1.3,3], ankL:[-7.4,1.1,-1], kneeR:[3,1.3,3], ankR:[7.4,1.1,-1], skL:70, skR:-70 }
  };
  function lerp(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }

  // --- Celebrations (Phase 3) ------------------------------------------------------
  // A celebration is a few stance keyframes the rig blends between: no art, and
  // every gear item works in it. READY is the card's standing grip as joint data,
  // so a celebration can start from it. Keys are [time 0..1, joints].
  var READY={ lean:0, drop:0, head:0, roll:0,
    elTop:[-4.8,18,3.6], handTop:[-2.3,13.8,5.4], elBot:[5.3,17.4,1.4], handBot:[4.8,12.8,1.8],
    knob:[-2.6,14.6,5.1], heel:[0.6,0.7,9.5], toe:[0.6,0.8,12.7],
    kneeL:[-2.1,6.2,1.5], ankL:[-2.1,2.4,.6], kneeR:[2.1,6.2,1.5], ankR:[2.1,2.4,.6], skL:0, skR:0 };
  function frame(over){ var f={}; for(var k in READY) f[k]=READY[k]; for(var m in over) f[m]=over[m]; return f; }
  var SLIDE_POSE={ lean:-8, drop:4.2, head:-10,
    elTop:[-6,14.2,3.4], handTop:[-5.6,11,6], knob:[-5.8,11.8,5.8], heel:[-2,0.7,9], toe:[-2,0.8,12],
    elBot:[6.4,18.6,1.4], handBot:[6.6,23.6,2.4],
    kneeL:[-2.4,5.4,4.6], ankL:[-2.4,2.4,4.4], kneeR:[2.4,1.3,-.4], ankR:[2.4,1.1,-4.6] };
  // Knee slide finish: both arms up, the stick raised high in the top hand.
  function ARMS_UP(p){
    p.elBot=[6.6,21,1.6]; p.handBot=[6.8,27,2.4];
    p.elTop=[-6.4,20.6,1.6]; p.handTop=[-7,26,2.4];
    p.knob=[-7.2,26.8,2.4]; p.heel=[-14.6,30,3]; p.toe=[-16,28.6,4.6];
  }
  var STICK_UP={ lean:-4, head:-8, elTop:[-4.6,19.4,4.4], handTop:[-2.6,20.6,6.4], elBot:[4.4,19,4.6], handBot:[0.6,22.4,7.2],
    knob:[-3,21,6], heel:[3.4,27.2,8.4], toe:[5.4,28,9] };
  var STICK_TAP={ lean:10, drop:.6, elTop:[-4,16,4.6], handTop:[-1.4,12.8,6], elBot:[4,14.6,4.2], handBot:[0.6,9.4,7.2],
    knob:[-1.6,13.4,5.6], heel:[2.8,0.7,10], toe:[2.8,0.8,13] };
  var CELLYS={
    // THWAP!: a quick crouch, then a big fist pump with the knee up; the word pops.
    fistpump:{ ms:900, word:'THWAP!', wordAt:.5, keys:[
      [0, READY],
      [.32, frame({ lean:18, drop:1.6, elBot:[5.6,14.4,3.4], handBot:[4.6,15.8,6],
        kneeL:[-2.4,5.4,2.6], kneeR:[2.4,5.4,2.6] })],
      [.55, frame({ lean:-6, head:-14, elBot:[6.6,25.2,1.6], handBot:[6.2,31,2.6],
        kneeR:[2.4,9.4,4.6], ankR:[2.4,5.6,3] })],
      [1, frame({ lean:-4, head:-12, elBot:[6.6,24.8,1.6], handBot:[6.2,30.4,2.6],
        kneeR:[2.4,9,4.4], ankR:[2.4,5.4,2.8] })] ]},
    // Knee slide: skate in, drop to one knee and slide across, fist up.
    // Stick tap (team set): raise the stick, then tap it on the ice twice.
    sticktap:{ ms:1200, keys:[
      [0, READY],
      [.28, frame(STICK_UP)],
      [.45, frame(STICK_TAP)],
      [.62, frame(STICK_UP)],
      [.8, frame(STICK_TAP)],
      [1, frame(STICK_TAP)] ]},
    kneeslide:{ ms:1300, slide:[-10,2.5], keys:[
      [0, READY],
      [.28, frame(SLIDE_POSE)],
      [.7, frame((function(){ var p={}; for(var k in SLIDE_POSE) p[k]=SLIDE_POSE[k];
        p.lean=-14; p.head=-14; ARMS_UP(p); return p; })())],
      [1, frame((function(){ var p={}; for(var k in SLIDE_POSE) p[k]=SLIDE_POSE[k];
        p.lean=-14; p.head=-14; ARMS_UP(p); return p; })())] ]}
  };
  function ease(t){ return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; }
  function mix(a,b,t){ var o={}; for(var k in a){ var x=a[k], y=b[k];
    o[k]=Array.isArray(x)?lerp(x,y,t):(typeof x==='number'?x+((y||0)-x)*t:x); } return o; }
  function cellyAt(c,t){
    var ks=c.keys;
    for(var i=1;i<ks.length;i++) if(t<=ks[i][0]){ var a=ks[i-1], b=ks[i]; return mix(a[1],b[1],ease((t-a[0])/((b[0]-a[0])||1))); }
    return ks[ks.length-1][1];
  }
  function cellyKey(id){ return String(id||'').replace(/^celebration-/,''); }
  function reducedMotion(){ try{ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(_){ return false; } }
  // Play a celebration. draw(markup, slideEm) writes one frame wherever it plays
  // (the My Player stage, the New gear message). Reduced motion draws only the
  // final pose. done() runs after the end pose has held for a moment. Returns stop().
  function playCelly(id,look,draw,done){
    var c=CELLYS[cellyKey(id)];
    if(!c){ if(done) done(); return function(){}; }
    function paint(t){
      var l={}; for(var k in look) l[k]=look[k]; l.poseData=cellyAt(c,t);
      var sx=c.slide?c.slide[0]+(c.slide[1]-c.slide[0])*(1-Math.pow(1-t,3)):0;
      // The word pops in over the first 15% after it appears (scaled in the frame,
      // since every frame is a fresh draw), with a small overshoot.
      var w='';
      if(c.word && t>=c.wordAt){ var wt=Math.min(1,(t-c.wordAt)/.15), sc=wt<1?(.4+.85*wt):1;
        w="<span class='av-word' aria-hidden='true' style='transform:scale("+sc.toFixed(3)+")'>"+c.word+"</span>"; }
      draw(html(l)+w, sx);
    }
    var stopped=false, timer=null;
    function stop(){ stopped=true; clearTimeout(timer); }
    if(reducedMotion()){ paint(1); timer=setTimeout(function(){ if(!stopped && done) done(); },1200); return stop; }
    var raf=window.requestAnimationFrame||function(f){ return setTimeout(function(){ f(Date.now()); },16); };
    var t0=null;
    function step(now){
      if(stopped) return;
      if(t0==null) t0=now;
      var t=Math.min(1,(now-t0)/c.ms); paint(t);
      if(t<1) raf(step); else timer=setTimeout(function(){ if(!stopped && done) done(); },700);
    }
    raf(step);
    return stop;
  }

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
    var black='#141414', steel=CAGE[look.cage]||CAGE.steel;
    var helmet=HELMET[look.helmet]||(look.jersey==='white'?'#F2F2F2':'#141414');
    var gloveC=GLOVES[look.gloves]||black;
    var stickC=STICK[look.stick]||'#2B2B2B';

    // Jersey front/back with two arm-height stripes; number on the back.
    var torsoBg='linear-gradient(0deg,'+J.stripe+' 0 9%,'+J.trim+' 9% 12%,'+J.body+' 12% 100%)';
    var sleeveBg='linear-gradient(0deg,'+J.body+' 0 38%,'+J.trim+' 38% 44%,'+J.stripe+' 44% 58%,'+J.trim+' 58% 64%,'+J.body+' 64% 100%)';
    var sockBg=look.socks==='rangers'?SOCKS_RANGERS:'linear-gradient(0deg,'+J.body+' 0 40%,'+J.stripe+' 40% 55%,'+J.trim+' 55% 62%,'+J.body+' 62% 100%)';
    var tapeC=TAPE[look.tape]||TAPE.white;
    var decal=look.decal==='rangers';
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
    // The coach-granted C or A, high on the chest above the number (Phase 4).
    var L8=String(look.letter||'').toUpperCase();
    // Outlined like a stitched letter; the outline uses the stripe color unless it
    // matches the letter (white jersey: red on red), then the trim color.
    var lo=(J.stripe===J.num)?J.trim:J.stripe;
    if(L8==='C'||L8==='A') chestNum="<span class='av-letter' style='color:"+J.num+";text-shadow:.08em .08em 0 "+lo+",-.08em -.08em 0 "+lo+",.08em -.08em 0 "+lo+",-.08em .08em 0 "+lo+"'>"+L8+"</span>"+chestNum;

    // Face: simple blocky eyes and brows, focused, not cute.
    var faceInner="<i class='av-brow l'></i><i class='av-brow r'></i><i class='av-eye l'></i><i class='av-eye r'></i><i class='av-mouth'></i>";
    // Cage: a steel grid on a see-through face.
    var cageBg='repeating-linear-gradient(90deg,'+steel+' 0 .22em,transparent .22em 1.3em),repeating-linear-gradient(0deg,'+steel+' 0 .22em,transparent .22em 1.3em)';

    // Handedness: lefty puts the right hand on top of the stick; righty the left.
    // Mirror every arm/stick point across x; the blade follows to the matching side.
    var lefty=(look.hand==='left');
    function M(p){ return lefty?[-p[0],p[1],p[2]]:p; }

    // A celebration frame passes its blended joints as poseData; otherwise the
    // named stance. Ready (no entry) keeps the standing grip below, unchanged.
    var P=(look.poseData && typeof look.poseData==='object')?look.poseData:(POSES[look.pose]||null);
    var lean=P?(P.lean||0):0, drop=P?(P.drop||0):0, headTilt=P?(P.head||0):0;
    // roll: sideways lean at the waist (degrees, positive tips toward +x), mirrored for lefties.
    var roll=P?((P.roll||0)*(look.hand==='left'?-1:1)):0;
    // Where a point on the upper body ends up after it leans forward around the
    // waist (y 14.6) and sinks by drop. Used for the shoulders, so the arms stay
    // attached while the torso group leans.
    var ls=Math.sin(lean*Math.PI/180), lc=Math.cos(lean*Math.PI/180);
    var rs=Math.sin(roll*Math.PI/180), rc=Math.cos(roll*Math.PI/180);
    function up(p){
      var dy=p[1]-14.6, dz=p[2];
      var y1=dy*lc-dz*ls, z1=dy*ls+dz*lc;             // forward lean
      return [p[0]*rc+y1*rs, 14.6-p[0]*rs+y1*rc-drop, z1];   // then sideways roll
    }
    var shTop=M(up([-4.6,22.4,1])), shBot=M(up([4.6,22.4,1]));       // shoulders
    // Arm + stick points per pose. elTop/elBot are elbows.
    var elTop,elBot,handTop,handBot,knob,ice,bladeToe;
    if(P){
      knob=M(P.knob); ice=M(P.heel); bladeToe=M(P.toe);
      elTop=M(P.elTop); elBot=M(P.elBot);
      // Hands ride the shaft unless the stance places them (goalie, overhead press).
      handTop=P.handTop?M(P.handTop):lerp(knob,ice,.07);
      handBot=P.handBot?M(P.handBot):lerp(knob,ice,P.bot);
    } else if(look.grip==='twoHand'){
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
    if(P){ kneeL=M(P.kneeL); ankL=M(P.ankL); kneeR=M(P.kneeR); ankR=M(P.ankR); }
    // Skates sit under the ankles; a stance can turn one out (stride push, butterfly).
    function skate(ank,turn){
      var dy=Math.max(ank[1]-2.4,-.6), rot=turn?'rotateY('+(lefty?-turn:turn)+'deg)':'';
      return box({w:.5,h:.6,d:5.4,x:ank[0],y:.3+dy,z:ank[2],c:steel,rot:rot})+
        box({w:3,h:1.6,d:5,x:ank[0],y:1.4+dy,z:ank[2],c:black,faces:skateFaces,rot:rot});
    }
    var skL=P?(P.skL||0):0, skR=P?(P.skR||0):0;
    // Thighs run hip -> knee under the pants, so a bent or spread knee never
    // leaves a gap between the pant hem and the knee pad.
    var hipY=10.6-drop;
    var thighL=P?limb([kneeL[0]<0?-2.1:2.1,hipY,0],kneeL,3.6,black,pantsFaces):'';
    var thighR=P?limb([kneeR[0]<0?-2.1:2.1,hipY,0],kneeR,3.6,black,pantsFaces):'';

    // Stick: a flat blade along the ice keeps the original boxes (Ready). Any other
    // blade (raised, angled, closed) is a limb from heel to toe, tape at the heel.
    var flatBlade=(ice[0]===bladeToe[0] && ice[1]<1);
    // Team-set tape also wraps the top of the shaft (grip tape), where the card
    // camera can see it; blade tape alone sits at the card's bottom edge.
    var grip=(look.tape==='rangers')?limb(lerp(knob,ice,.1),lerp(knob,ice,.36),1.45,tapeC):'';
    var stickParts=flatBlade?[
      limb(knob,ice,1.3,stickC),
      box({w:1.5,h:1.6,d:1.6,x:ice[0],y:2.2,z:ice[2]-0.4,c:tapeC}),
      box({w:1.4,h:2.2,d:(bladeToe[2]-ice[2]),x:ice[0],y:1.3,z:(ice[2]+bladeToe[2])/2,c:stickC})
    ]:[
      limb(knob,ice,1.3,stickC),
      limb(lerp(knob,ice,.9),ice,1.5,tapeC),
      limb(ice,bladeToe,1.6,stickC)
    ];
    var puck=(P&&P.puck)?(function(p){ p=M(p); return box({w:3,h:1,d:3,x:p[0],y:p[1],z:p[2],c:'#111111'}); })(P.puck):'';

    // Upper body (torso + head) as one group that leans at the waist and sinks by
    // drop; the head group inside it tilts at the neck. CSS y runs down, so a
    // forward lean is a negative rotateX.
    var upperTf='translate3d(0,'+(drop-14.6)+'em,0) rotateZ('+roll+'deg) rotateX('+(-lean)+'deg) translate3d(0,14.6em,0)';
    var headTf='translate3d(0,-24.2em,0) rotateX('+(-headTilt)+'deg) translate3d(0,24.2em,0)';

    var parts=[
      // Skates: blade + boot
      skate(ankL,skL), skate(ankR,skR),
      thighL, thighR,
      // Shins (socks over shin guards), knee -> ankle: the bent knee shows here.
      limb(kneeL,ankL,3.4,J.body,{front:sockTx,back:sockTx,side:sockTx,top:sockTx}),
      limb(kneeR,ankR,3.4,J.body,{front:sockTx,back:sockTx,side:sockTx,top:sockTx}),
      // Knee caps (shin-guard pads) at the bend, bulging forward past the pant hem.
      box({w:3.6,h:2.8,d:3.8,x:kneeL[0],y:kneeL[1],z:kneeL[2]+.3,c:J.body,faces:{front:sockTx,back:sockTx,side:sockTx,top:sockTx,bottom:sockTx}}),
      box({w:3.6,h:2.8,d:3.8,x:kneeR[0],y:kneeR[1],z:kneeR[2]+.3,c:J.body,faces:{front:sockTx,back:sockTx,side:sockTx,top:sockTx,bottom:sockTx}}),
      // Hockey pants (breezers) to the knees: bulky, cover hips + thighs.
      box({w:9,h:8,d:5.2,y:11-drop,c:black,faces:pantsFaces}),
      // Upper body group: torso, head, hair, helmet, cage (leans with the stance).
      "<div class='av-b av-upper' style='transform:"+upperTf+"'>",
      // Torso (jersey over shoulder pads)
      box({w:9.6,h:9.4,d:5.4,y:19.3,c:J.body,faces:{front:jTex,back:jTex,side:jTex,top:jTex},frontInner:chestNum,backInner:backNum}),
      "<div class='av-b av-head' style='transform:"+headTf+"'>",
      // Head
      box({w:7.6,h:7.6,d:7.6,y:28,c:skin,frontInner:faceInner}),
      // Hair: style is a few boxes around the helmet (see hairBoxes).
      hairBoxes(look.hairstyle||DEFAULT_LOOK.hairstyle, hair),
      // Helmet shell (top + back half), leaves the face open for the cage
      box({w:8.4,h:2.6,d:8.4,y:31.3,c:helmet,faces:helTop}),
      box({w:8.4,h:4.6,d:2.4,y:28.2,z:-3.2,c:helmet,faces:helFaces,backInner:decal?"<span class='av-decal'>R</span>":''}),
      // Team-set decal: a Rangers R badge on each side of the helmet too.
      decal?box({w:.14,h:2.1,d:2.1,x:-4.78,y:28.4,z:.2,c:'#C8102E'})+box({w:.14,h:2.1,d:2.1,x:4.78,y:28.4,z:.2,c:'#C8102E'}):'',
      box({w:1,h:4.8,d:5.6,x:-4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      box({w:1,h:4.8,d:5.6,x:4.2,y:27.9,z:.6,c:helmet,faces:helFaces}),
      // Cage
      "<div class='av-b' style='transform:translate3d(0,-27.4em,4.3em)'>"+face('av-cage',7.8,6.4,'none',cageBg)+"</div>",
      "</div></div>",
      // Arms: upper arm (shoulder->elbow) + forearm (elbow->hand), bending onto the
      // stick so the character actually holds it (both hands land on the grip).
      limb(shTop,elTop,3.4,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(elTop,handTop,3.2,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(shBot,elBot,3.4,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      limb(elBot,handBot,3.2,J.body,{front:sleeveTx,back:sleeveTx,side:sleeveTx,top:sleeveTx}),
      // Gloves at the two grip points
      box({w:3.8,h:3.4,d:3.8,x:handTop[0],y:handTop[1],z:handTop[2],c:gloveC,faces:gloveFaces}),
      box({w:3.8,h:3.4,d:3.8,x:handBot[0],y:handBot[1],z:handBot[2],c:gloveC,faces:gloveFaces}),
      // Stick (shaft, white tape at the heel, blade). Recolored by the unlocked
      // stick (stickC: classic / wood / gold).
      stickParts.join('')+grip,
      puck
    ];
    // Facing: left 3/4 is the default; right mirrors it, center faces head-on. Set
    // as a CSS var so the builder's spin and the mini previews still win.
    var faceY=(look.facing==='right')?25:((look.facing==='center')?0:-25);
    return "<div class='av-wrap' aria-hidden='true'><div class='av-scene' style='--av-face:"+faceY+"deg'>"+parts.join('')+"</div></div>";
  }

  // Look for a player. Order: the server roster looks (fetched below, cached on
  // the device so the next load paints right away), then this device's saved
  // look, then the default. The number always comes from the roster.
  var teamLooks=null, teamLetters={};
  try{ teamLooks=JSON.parse(localStorage.getItem('thwapLooksCache')||'null'); }catch(_){}
  try{ teamLetters=JSON.parse(localStorage.getItem('thwapLettersCache')||'{}')||{}; }catch(_){}
  function letterOf(id){ return teamLetters[String(id||'').toLowerCase()]||null; }
  // A player who has never built a character still gets one on their card: a
  // starter look picked from their name, so the roster is not a row of twins.
  // Hair style, hair color and the three free Rangers jerseys vary (all free;
  // the jersey is what reads from the front, under the helmet). Skin tone stays
  // the default: guessing a real kid's skin tone is not ours to do. The kid
  // replaces all of it in the first-run builder.
  var STARTER_HAIR=['brown','black','cocoa','chestnut','blonde','sandy','auburn'];
  var STARTER_JERSEY=['red','black','white'];
  function starterLook(id){
    var h=0; for(var i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0;
    var styles=Object.keys(HAIR_STYLES);
    return { hairstyle:styles[h%styles.length], hair:STARTER_HAIR[Math.floor(h/styles.length)%STARTER_HAIR.length],
      jersey:STARTER_JERSEY[Math.floor(h/(styles.length*STARTER_HAIR.length))%STARTER_JERSEY.length] };
  }
  function lookFor(p,slug){
    var look={}; for(var k in DEFAULT_LOOK) look[k]=DEFAULT_LOOK[k];
    var id=String(slug||'').toLowerCase();
    var src=null;
    if(teamLooks && teamLooks[id]) src=norm(teamLooks[id]);
    if(!src){ try{ src=(JSON.parse(localStorage.getItem('thwapLooks')||'{}'))[id]||null; }catch(_){} }
    if(!src) src=starterLook(id);
    for(var m in src) if(m!=='num' && m!=='letter') look[m]=src[m];
    look.num=(p&&p.num)||'';
    look.letter=letterOf(id); // the coach decides the letter, never the saved look
    return look;
  }
  function refreshTeamLooks(){
    if(!on() || typeof fetch!=='function') return;
    try{
      fetch('/api/board?action=looks',{credentials:'same-origin'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){
        if(!j || !j.looks) return;
        var letters=j.letters||{};
        var changed=JSON.stringify(j.looks)!==JSON.stringify(teamLooks||null) || JSON.stringify(letters)!==JSON.stringify(teamLetters);
        teamLooks=j.looks; teamLetters=letters;
        try{ localStorage.setItem('thwapLooksCache',JSON.stringify(j.looks)); localStorage.setItem('thwapLettersCache',JSON.stringify(letters)); }catch(_){}
        try{ document.dispatchEvent(new CustomEvent('thwap:looks')); }catch(_){}
        // A teammate built or changed their player since the cache: redraw the roster.
        if(changed){ try{ if(window.thwapRepaintRoster) window.thwapRepaintRoster(); }catch(_){} }
      }).catch(function(){});
    }catch(_){}
  }
  refreshTeamLooks();

  // Live: player photos are retired, so drop the copies kept on this device.
  // (Server copies are deleted separately, from the admin page, on Woody's go-ahead.)
  if(LIVE){
    try{
      var drop=[];
      for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(k && k.indexOf('thwapCardPhoto:')===0) drop.push(k); }
      drop.forEach(function(k){ localStorage.removeItem(k); });
    }catch(_){}
  }

  // --- Styles -----------------------------------------------------------------
  var css=
    ".av-wrap{position:absolute;inset:0;z-index:2;pointer-events:none;perspective:60em;perspective-origin:50% 30%;"+
      "font-size:min(9px,2.2vw);"+
      // Faint light edge around the whole character, so black gear (Rink Black
      // jersey, helmet, pants, stick) keeps its outline on the dark card plates
      // and in dark mode. Invisible on light backgrounds.
      "filter:drop-shadow(0 0 1px rgba(255,255,255,.85)) drop-shadow(0 0 1px rgba(255,255,255,.55))}"+
    ".av-scene{position:absolute;left:50%;bottom:9%;width:0;height:0;transform-style:preserve-3d;"+
      "transform:rotateX(-10deg) rotateY(var(--av-face,-25deg))}"+
    ".av-b{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d}"+
    ".av-f{position:absolute;left:0;top:0;backface-visibility:hidden;box-shadow:inset 0 0 0 .06em rgba(0,0,0,.35);background-size:100% 100%;image-rendering:pixelated}"+
    ".av-top{filter:brightness(1.18)}.av-right,.av-left{filter:brightness(.78)}.av-back{filter:brightness(.88)}.av-bottom{filter:brightness(.6)}"+
    ".av-cage{box-shadow:none;backface-visibility:visible;opacity:.95}"+
    ".av-num{position:absolute;left:0;right:0;top:36%;text-align:center;font:900 3.6em/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em}"+
    ".av-num-sm{font-size:2em;top:30%;left:auto;right:12%;text-align:right}"+
    ".av-letter{position:absolute;right:14%;top:3%;font:900 2.4em/1 system-ui,-apple-system,sans-serif}"+
    ".av-eye,.av-brow,.av-mouth{position:absolute;background:#141414;display:block}"+
    ".av-eye{width:1.2em;height:1.2em;top:3.4em}.av-eye.l{left:1.4em}.av-eye.r{right:1.4em}"+
    ".av-brow{width:1.9em;height:.45em;top:2.5em}.av-brow.l{left:1.1em;transform:rotate(8deg)}.av-brow.r{right:1.1em;transform:rotate(-8deg)}"+
    ".av-mouth{width:2.4em;height:.4em;left:2.6em;top:5.6em}"+
    ".av-decal{position:absolute;left:50%;top:18%;transform:translateX(-50%);width:1.5em;height:1.5em;box-sizing:border-box;border:.12em solid #fff;border-radius:.25em;background:#C8102E;color:#fff;font:900 1.6em/1.25 system-ui,-apple-system,sans-serif;text-align:center}"+
    // The celebration word (THWAP!) over the player, sized by its container.
    ".av-word{position:absolute;left:0;right:0;top:3%;z-index:3;text-align:center;font:900 2.8em/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em;color:var(--lime,#B9F06B);text-shadow:0 .06em 0 #15221B,0 0 .2em rgba(0,0,0,.35);pointer-events:none}";
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
  var GEAR_TABS=[['skin','Skin'],['hairstyle','Hair'],['hair','Hair color'],['jersey','Jersey',['jersey','socks']],['helmet','Helmet',['helmet','decal']],['cage','Cage'],['stripe','Stripe'],['gloves','Gloves'],['stick','Stick',['stick','tape']],['pose','Moves'],['celebration','Cellys'],['hand','Shot'],['facing','View']];
  var TIER_LABEL={ common:'', rare:'Pro', epic:'All-Star', legendary:'Legend', team:'Team' };
  // A tab can hold more than one slot (Stick holds the tape, Helmet the decal,
  // Jersey the socks), so the team-set slots need no tabs of their own.
  function slotsOf(tab){ for(var i=0;i<GEAR_TABS.length;i++) if(GEAR_TABS[i][0]===tab) return GEAR_TABS[i][2]||[tab]; return [tab]; }
  function tabFor(slot){ for(var i=0;i<GEAR_TABS.length;i++) if(slotsOf(GEAR_TABS[i][0]).indexOf(slot)>=0) return GEAR_TABS[i][0]; return slot; }
  var L={ data:null, look:null, saved:null, tab:'skin', trying:null, changed:false, me:null };

  function swatch(slot,short){
    var c='#888';
    if(slot==='skin') c=SKIN[short]; else if(slot==='hair') c=HAIR[short];
    else if(slot==='jersey') c=(JERSEY[short]||{}).body; else if(slot==='gloves') c=GLOVES[short];
    else if(slot==='stick') c=STICK[short]; else if(slot==='helmet') c=HELMET[short]||'#141414'; else if(slot==='cage') c=CAGE[short];
    else if(slot==='stripe') c=short==='none'?'transparent':'#C8102E';
    else if(slot==='tape') c=TAPE[short]; else if(slot==='decal') c=short==='rangers'?'#C8102E':'transparent';
    else if(slot==='socks') c=short==='rangers'?SOCKS_RANGERS:((JERSEY[norm(L.look||{}).jersey]||JERSEY.red).body);
    return c||'#888';
  }
  function ruleText(it){
    var r=it.rule||{};
    if(r.type==='activities') return 'Finish '+r.n+' drills';
    if(r.type==='days') return 'Train '+r.n+' days';
    if(r.type==='disc') return 'Finish '+r.n+' '+({stick:'Hands',shoot:'Shooting',dryland:'Dryland',netplay:'Net play',iq:'Hockey IQ',pass:'Passing'}[r.disc]||r.disc)+' drills';
    if(r.type==='window') return 'Train '+r.n+' days over winter break';
    if(r.type==='coach') return 'From your coach';
    if(r.type==='team') return r.n===1?'1 team goal week':r.n+' team goal weeks';
    return '';
  }
  function have(it){
    var p=(L.data&&L.data.progress)||{activities:0,trainingDays:0,disciplines:{}}, r=it.rule||{};
    if(r.type==='activities') return p.activities;
    if(r.type==='days') return p.trainingDays;
    if(r.type==='disc') return (p.disciplines||{})[r.disc]||0;
    if(r.type==='window') return (p.windows||{})[it.id]||0;
    if(r.type==='team') return p.teamHits||0;
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
  // Moves tiles show the player's own whole body in that stance, so the kid
  // sees the move on their player before they wear (or try on) it.
  function miniPose(pose){
    var look=norm(L.look||{}); look.pose=pose; look.num='';
    return "<span class='lk-mini pose' aria-hidden='true'>"+html(look)+"</span>";
  }
  // The tile/toast picture for any item: hair from behind, hand/facing from the
  // front, stances full body, everything else a color swatch.
  // Celebration tiles show the player's end pose (THWAP! fist up, the slide);
  // 'None yet' shows the player in their own stance.
  function miniCelly(key){
    var look=norm(L.look||{}); look.num='';
    var c=CELLYS[key]; if(c) look.poseData=cellyAt(c,1);
    return "<span class='lk-mini pose' aria-hidden='true'>"+html(look)+"</span>";
  }
  function itemPic(slot,short){
    if(slot==='hairstyle') return miniHead(short);
    if(slot==='hand'||slot==='facing') return miniOpt(slot,short);
    if(slot==='pose') return miniPose(short);
    if(slot==='celebration') return miniCelly(short);
    return "<span class='lk-sw' style='background:"+swatch(slot,short)+"'></span>";
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
      ".lk-stagewrap{position:relative;margin:0 16px}"+
      ".lk-play{position:absolute;right:12px;bottom:12px;min-height:48px;padding:0 18px;border-radius:24px;border:0;background:var(--text,#15221B);color:var(--bg,#F3F7F4);font:inherit;font-weight:900;font-size:16px;cursor:pointer}.lk-play[hidden]{display:none}"+
      ".lk-toast .av-word{display:none}"+
      ".lk-stage{position:relative;height:min(46vh,380px);margin:0;border-radius:16px;background:var(--soft,#E7EEE8);overflow:hidden;touch-action:none}"+
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
      // Stance tiles: the whole body, small enough to fit the tile.
      ".lk-mini.pose{width:64px;height:84px}.lk-mini.pose .av-wrap{font-size:2px}"+
      ".lk-mini.pose .av-scene{bottom:6px;transform:rotateX(-8deg) rotateY(var(--av-face,-25deg))}"+
      ".lk-toast .lk-mini{flex:none;width:44px;height:52px}.lk-toast .lk-mini.pose .av-wrap{font-size:1.3px}"+
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
      ".lk-toast .lk-sw{flex:none}.lk-letter-sw{display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;background:#C8102E;color:#fff}.lk-toast small{display:block;font-weight:700;font-size:12px;color:var(--muted,#5F6F64)}"+
      "@media (prefers-reduced-motion:no-preference){.lk-stage .av-scene{transition:transform .25s ease}"+
        ".lk-toast{animation:lkUp .3s ease-out}@keyframes lkUp{from{transform:translate(-50%,24px);opacity:0}to{transform:translate(-50%,0);opacity:1}}"+
        ".av-reveal .av-scene{animation:avDrop .35s cubic-bezier(.2,.9,.3,1.2)}@keyframes avDrop{from{translate:0 -6em;opacity:0}to{translate:0 0;opacity:1}}}";
  }

  // The celebration showing on the stage: the one being tried on, else the worn one.
  function stageCelly(){
    var look=L.trying?L.trying.look:(L.look||{});
    var id=look.celebration; return (id && CELLYS[cellyKey(id)])?id:null;
  }
  function playOnStage(id){
    var st=document.querySelector('.lk-stage'); if(!st||!id) return;
    if(L.playing){ L.playing(); L.playing=null; }
    var r=norm(L.trying?L.trying.look:L.look); r.num=L.num||'';
    L.playing=playCelly(id,r,function(m,sx){
      st.innerHTML=m;
      var sc=st.querySelector('.av-scene');
      if(sc){ sc.style.transform='rotateX(-10deg) rotateY('+L.spin+'deg)'; sc.style.translate=sx?(sx+'em 0'):''; }
    },function(){ L.playing=null; paintStage(); });
  }
  function ensureLockerCss(){
    if(!document.getElementById('lk-css')){ var s=document.createElement('style'); s.id='lk-css'; s.textContent=lockerCss(); document.head.appendChild(s); }
  }
  function paintStage(){
    var st=document.querySelector('.lk-stage'); if(!st) return;
    var play=document.querySelector('.lk-play');
    if(play) play.hidden=!(L.build==null && L.tab==='celebration' && stageCelly());
    // A celebration is playing: let it finish (it repaints when done); only the note updates.
    if(!L.playing){
      var look=L.trying?L.trying.look:L.look;
      var r=norm(look); r.num=L.num||''; r.letter=(L.data&&L.data.letter)||null;
      st.innerHTML=html(r);
      var sc=st.querySelector('.av-scene'); if(sc) sc.style.transform='rotateX(-10deg) rotateY('+L.spin+'deg)';
    }
    var note=document.querySelector('.lk-note');
    if(note){
      if(L.trying){ var it=L.trying.item, h=have(it), n=(it.rule||{}).n||0;
        note.textContent=(it.rule&&it.rule.type==='team')
          ? it.label+'. Unlocks when the Rangers hit the weekly team goal'+(n>1?' '+n+' times':'')+'. So far: '+Math.min(h,n)+'.'
          : it.label+'. '+ruleText(it)+' to unlock. You\u2019re at '+Math.min(h,n)+'.'; }
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
    // Opened on a later tab (e.g. from a New move! message): keep the selected
    // tab in view instead of leaving the row scrolled to Skin.
    var sel=t.querySelector('[aria-selected=true]');
    if(sel && sel.scrollIntoView){ try{ sel.scrollIntoView({block:'nearest',inline:'nearest'}); }catch(_){} }
  }
  function paintGrid(){
    var g=document.querySelector('.lk-grid'); if(!g||!L.data) return;
    var tabSlots=slotsOf(L.tab);
    var items=L.data.items.filter(function(it){ return tabSlots.indexOf(it.slot)>=0; });
    g.innerHTML=items.map(function(it){
      var short=it.id.slice(it.slot.length+1), own=owned(it.id), on=L.look[it.slot]===it.id;
      var sub=own?(TIER_LABEL[it.tier]||''):ruleText(it);
      var lbl=it.slot==='skin'?'Tone '+short.slice(1):(it.slot==='hair'?short.charAt(0).toUpperCase()+short.slice(1):it.label);
      return "<button type='button' class='lk-item"+(own?'':' locked')+"' data-id='"+esc(it.id)+"' aria-pressed='"+on+"'"+
        " aria-label='"+esc(lbl+(own?'':', locked. '+ruleText(it)+' to unlock'))+"'>"+
        (own?'':"<i class='lk-lock' aria-hidden='true'></i>")+(own&&isNew(it.id)?"<i class='lk-new'>New</i>":"")+
        itemPic(it.slot,short)+
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
    if(tab){ if(L.playing){ L.playing(); L.playing=null; } L.tab=tab.getAttribute('data-tab'); L.trying=null; L.spin=spinFor(L.tab); paintTabs(); paintGrid(); paintStage(); return; }
    if(e.target.closest('.lk-play')){ playOnStage(stageCelly()); return; }
    var b=e.target.closest('.lk-item'); if(!b||!L.data) return;
    var id=b.getAttribute('data-id'), it=null;
    for(var i=0;i<L.data.items.length;i++) if(L.data.items[i].id===id) it=L.data.items[i];
    if(!it) return;
    // Tapping a celebration plays it (even a locked one, as a try-on), so the
    // kid sees exactly what they are wearing or working toward.
    var celly=(it.slot==='celebration' && CELLYS[cellyKey(id)])?id:null;
    if(!owned(id)){
      var tryLook={}; for(var k in L.look) tryLook[k]=L.look[k]; tryLook[it.slot]=id;
      L.trying={item:it,look:tryLook}; if(L.playing){ L.playing(); L.playing=null; } paintStage(); if(celly) playOnStage(celly); return;
    }
    if(L.trying && L.playing){ L.playing(); L.playing=null; }
    L.trying=null;
    if(L.look[it.slot]===id){ paintStage(); if(celly) playOnStage(celly); return; }
    if(celly){ setTimeout(function(){ playOnStage(celly); },0); }
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
    if(L.playing){ L.playing(); L.playing=null; }
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
    ensureLockerCss();
    L={ onClose:opts.onClose||null, data:null, look:null, tab:opts.tab||'skin', trying:null, changed:false, me:null, spin:-25, status:'', num:'', build:null };
    var el=document.createElement('div'); el.className='lk'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','My Player');
    el.innerHTML="<div class='lk-head'><h2>My Player</h2><button type='button' class='lk-x' aria-label='Close'>&#10005;</button></div>"+
      "<div class='lk-stagewrap'><div class='lk-stage' aria-label='Your player. Drag to spin.'></div><button type='button' class='lk-play' hidden>&#9654; Play</button></div><div class='lk-note' aria-live='polite'></div>"+
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
  // Milestone moment: when the kid has a celebration (or just earned one), the
  // message shows their own player doing it, wearing the new item. It never
  // blocks a tap; reduced motion shows the end pose.
  function showToast(it,count,look,teamWeek){
    var old=document.querySelector('.lk-toast'); if(old) old.remove();
    var short=it.id.slice(it.slot.length+1);
    var my=norm(look||{}); my[it.slot]=it.id; my.num='';
    var celly=it.slot==='celebration'?it.id:my.celebration;
    if(!CELLYS[cellyKey(celly)]) celly=null;
    var kind=it.slot==='pose'?'move':(it.slot==='celebration'?'celly':'gear');
    var b=document.createElement('button'); b.type='button'; b.className='lk-toast'; b.setAttribute('role','status');
    var pic0=celly?"<span class='lk-mini pose lk-tcelly' aria-hidden='true'></span>":itemPic(it.slot,short);
    if(it.rule && it.rule.type==='team'){
      // The team did it: everyone gets it, so say who earned it and what this kid added.
      var mine=teamWeek&&typeof teamWeek.mine==='number'?teamWeek.mine:null;
      var add=mine>0?('You added '+mine+' drill'+(mine===1?'':'s')+'.'):'Train this week to help the team get the next one.';
      b.innerHTML=pic0+"<span>The Rangers did it!<small>New team item: "+esc(it.label)+(count>1?' and '+(count-1)+' more':'')+". "+add+"</small></span>";
    } else {
      b.innerHTML=pic0+"<span>New "+kind+"! "+esc(it.label)+
        (count>1?' and '+(count-1)+' more':'')+"<small>Tap to try it on</small></span>";
    }
    if(celly){ var pic=b.querySelector('.lk-tcelly');
      playCelly(celly,my,function(m,sx){ pic.innerHTML=m; var sc=pic.querySelector('.av-scene'); if(sc) sc.style.translate=sx?(sx+'em 0'):''; }); }
    b.addEventListener('click',function(){ b.remove(); var tb=tabFor(it.slot); if(window.thwapOpenMyPlayer) window.thwapOpenMyPlayer({tab:tb}); else openLocker({tab:tb}); });
    document.body.appendChild(b);
    try{ if(window.thwapSfx) window.thwapSfx('unlock'); }catch(_){}
    try{ if(window.thwapHaptic) window.thwapHaptic('done'); }catch(_){}
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ if(b.parentNode) b.remove(); },5000);
  }
  // The coach gave this player the C or an A: a one-time message on this device.
  function showLetterToast(letter){
    var old=document.querySelector('.lk-toast'); if(old) old.remove();
    var b=document.createElement('button'); b.type='button'; b.className='lk-toast'; b.setAttribute('role','status');
    b.innerHTML="<span class='lk-sw lk-letter-sw' aria-hidden='true'>"+letter+"</span><span>Coach gave you the "+letter+"!"+
      "<small>"+(letter==='C'?'You\u2019re the captain.':'You\u2019re an assistant captain.')+" It\u2019s on your jersey now.</small></span>";
    b.addEventListener('click',function(){ b.remove(); });
    document.body.appendChild(b);
    try{ if(window.thwapSfx) window.thwapSfx('unlock'); }catch(_){}
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
      var prevLetter=null; try{ prevLetter=localStorage.getItem('thwapLetterSeen'); }catch(_){}
      var curLetter=j.letter||'';
      if(curLetter!==(prevLetter||'')){
        try{ localStorage.setItem('thwapLetterSeen',curLetter); }catch(_){}
        if(curLetter && !document.querySelector('.lk')){ ensureLockerCss(); showLetterToast(curLetter); return j; }
      }
      // Only announce items a kid can actually see and wear: slots with a tab
      // in My Player. Celebrations have no tab until they can play, so they
      // stay unseen (not announced, not recorded) and announce when it ships.
      // Stances got the Moves tab, so moves held back earlier announce now.
      var shown={}; GEAR_TABS.forEach(function(t){ slotsOf(t[0]).forEach(function(sl){ shown[sl]=1; }); });
      var ready=(j.unlocked||[]).filter(function(id){ var it=itemName(j,id); return !it || shown[it.slot]; });
      var seen=readList('thwapUnlockSeen');
      if(!seen){ writeList('thwapUnlockSeen',ready); return j; } // first look: past training is the builder's job
      var unseen=ready.filter(function(id){ return seen.indexOf(id)<0; });
      // Free starting items are never "earned", so they join silently.
      var fresh=unseen.filter(function(id){ var it=itemName(j,id); return it && it.rule && it.rule.type!=='start'; });
      if(unseen.length) writeList('thwapUnlockSeen',seen.concat(unseen));
      if(fresh.length){
        writeList('thwapUnlockNew',(readList('thwapUnlockNew')||[]).concat(fresh));
        var first=itemName(j,fresh[0]);
        if(first && !document.querySelector('.lk')) showToast(first,fresh.length,j.look,j.teamWeek);
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
    ensureLockerCss();
    if((readList('thwapUnlockNew')||[]).length) markDot();
    window.addEventListener('load',function(){ if((readList('thwapUnlockNew')||[]).length) markDot(); });
    hookMarkDone(); window.addEventListener('load',hookMarkDone);
    // Never open My Player on its own: the app always lands on home. A kid who
    // has never saved a look gets the builder when they tap Edit player (see
    // openLocker). This check only records which unlocks are already seen.
    if(location.hash!=='#myplayer') checkUnlocks();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootLocker); else bootLocker();

  window.thwapAvatar={ on:on, live:LIVE, html:html, lookFor:lookFor, refreshTeamLooks:refreshTeamLooks, openLocker:openLocker, checkUnlocks:checkUnlocks, norm:norm, SKIN:SKIN, HAIR:HAIR, JERSEY:JERSEY, DEFAULT_LOOK:DEFAULT_LOOK, POSES:['ready'].concat(Object.keys(POSES)), CELLYS:Object.keys(CELLYS), playCelly:playCelly, letterOf:letterOf };
})();
