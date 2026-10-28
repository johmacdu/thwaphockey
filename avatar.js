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
  // hand: 'right' (righty, left hand on top) | 'left' (lefty, right hand on top).
  // facing: 'left' (3/4, default) | 'right' (3/4 the other way) | 'center' (head-on).
  // hairStyle: 'flow' (default) | 'short' | 'long'.
  // pose: 'oneHand' (one hand on the knob -- the clean card default) | 'twoHand' (ready grip).
  var DEFAULT_LOOK={ skin:'s3', hair:'brown', jersey:'red', num:'', hand:'right', facing:'left', hairStyle:'flow', pose:'oneHand' };

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

  // Connect two points p1->p2 (each [x,y,z], y up) with a box whose long axis is
  // the line between them. Rotation is computed, so we pose by ENDPOINTS (shoulder
  // to hand, knob to ice) instead of guessing angles -- exact, and a mirror for
  // handedness is just negating x. (box() translates with -y, so CSS dir = [dx,-dY,dz].)
  function limb(p1,p2,thick,c,faces){
    var dx=p2[0]-p1[0], dY=p2[1]-p1[1], dz=p2[2]-p1[2];
    var L=Math.sqrt(dx*dx+dY*dY+dz*dz)||0.001;
    var ang=Math.acos(Math.max(-1,Math.min(1,dY/L)))*180/Math.PI;
    var rot='rotate3d('+(-dz).toFixed(3)+',0,'+dx.toFixed(3)+','+ang.toFixed(2)+'deg)';
    return box({w:thick,h:L,d:thick,x:(p1[0]+p2[0])/2,y:(p1[1]+p2[1])/2,z:(p1[2]+p2[2])/2,c:c,faces:faces,rot:rot});
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
    var black='#141414', helmet=look.jersey==='white'?'#F2F2F2':'#141414', steel='#C9CED3', stickWood='#C5863C';

    // Jersey stripes + fabric grain now live in the flat pixel tiles (avatar-tex/).
    // Phase 1 pixel textures (style A). Flat tiles -- the code still shades each
    // face (top lighter, sides darker), so these must stay flat (no baked lighting).
    var jkey=(JERSEY[look.jersey]?look.jersey:DEFAULT_LOOK.jersey);
    var jTex="url(avatar-tex/jersey-"+jkey+".png)";
    var slvTex="url(avatar-tex/sleeve-"+jkey+".png)";
    var sockTex="url(avatar-tex/sock-"+jkey+".png)";
    var helTex="url(avatar-tex/helmet.png)";
    var pantsTex="url(avatar-tex/pants.png)";
    var gloveTex="url(avatar-tex/glove.png)";
    var skateTex="url(avatar-tex/skate.png)";

    // Two-handed ready grip, posed by endpoints. Base layout is a RIGHTY shooter
    // (left hand on top); lefty mirrors x (-> right hand on top, blade flips side).
    var lefty=(look.hand==='left');
    function M(p){ return lefty?[-p[0],p[1],p[2]]:p; }
    var shTop=M([-4.6,22.4,1]), shBot=M([4.6,22.4,1]);       // shoulders
    // Arm + stick points per pose. elTop/elBot are elbows (= Phase-3 elbow joints).
    var elTop,elBot,handTop,handBot,knob,ice,bladeToe;
    if(look.pose==='twoHand'){
      // Two-handed ready grip: both hands in front, top hand on the knob, bottom a
      // forearm down the shaft (betterhockey.com), blade flat on the ice.
      elTop=M([-3.5,16.5,3.6]); elBot=M([4,14.6,4.2]);
      handTop=M([0.4,12.5,6]); handBot=M([1.2,9,7]);
      knob=M([0.1,13.7,5.7]); ice=M([3.2,0.7,9.6]); bladeToe=M([3.2,0.8,12.8]);
    } else {
      // One-handed knob hold (card default): top hand on the knob, stick angled down
      // to the ice in front; the other arm hangs relaxed at the side.
      elTop=M([-4.8,18,3.6]); handTop=M([-2.3,13.8,5.4]);
      knob=M([-2.6,14.6,5.1]); ice=M([0.6,0.7,9.5]); bladeToe=M([0.6,0.8,12.7]);
      elBot=M([5.3,17.4,1.4]); handBot=M([4.8,12.8,1.8]);   // right arm hangs at the side
    }
    // Legs: hip -> knee -> ankle, knee pushed forward for an athletic bend.
    // kneeBend is the forward (+z) offset; 0 = straight, bigger = deeper crouch.
    // These are symmetric (not handedness-mirrored). The knee = Phase-3 knee joint.
    var kneeBend=2;
    var hipL=[-2.1,10,0], kneeL=[-2.1,6,kneeBend], ankL=[-2.1,2.4,.6];
    var hipR=[2.1,10,0], kneeR=[2.1,6,kneeBend], ankR=[2.1,2.4,.6];
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
      box({w:3,h:1.6,d:5,x:-2.1,y:1.4,z:.6,c:black,faces:{front:skateTex,back:skateTex,side:skateTex,top:skateTex,bottom:skateTex}}),
      box({w:3,h:1.6,d:5,x:2.1,y:1.4,z:.6,c:black,faces:{front:skateTex,back:skateTex,side:skateTex,top:skateTex,bottom:skateTex}}),
      // Legs (socks over shin guards): thigh (hip->knee) + shin (knee->ankle) so the
      // knee bends into an athletic stance. Bend lives in the knee point above.
      limb(hipL,kneeL,3.5,J.body,{front:sockTex,back:sockTex,side:sockTex,top:sockTex}),
      limb(kneeL,ankL,3.4,J.body,{front:sockTex,back:sockTex,side:sockTex,top:sockTex}),
      limb(hipR,kneeR,3.5,J.body,{front:sockTex,back:sockTex,side:sockTex,top:sockTex}),
      limb(kneeR,ankR,3.4,J.body,{front:sockTex,back:sockTex,side:sockTex,top:sockTex}),
      // Knee caps (shin-guard kneepads): fill the joint gap at a deep bend and bulge
      // the pad forward, so a hard knee bend reads clean instead of as a stair-step.
      box({w:3.7,h:3,d:3.8,x:kneeL[0],y:kneeL[1],z:kneeL[2]+.3,c:J.body,faces:{front:sockTex,back:sockTex,side:sockTex,top:sockTex,bottom:sockTex}}),
      box({w:3.7,h:3,d:3.8,x:kneeR[0],y:kneeR[1],z:kneeR[2]+.3,c:J.body,faces:{front:sockTex,back:sockTex,side:sockTex,top:sockTex,bottom:sockTex}}),
      // Pants
      box({w:8.6,h:4.6,d:4.8,y:12.3,c:black,faces:{front:pantsTex,back:pantsTex,side:pantsTex,top:pantsTex,bottom:pantsTex}}),
      // Torso (jersey over shoulder pads)
      box({w:9.6,h:9.4,d:5.4,y:19.3,c:J.body,faces:{front:jTex,back:jTex,side:jTex,top:jTex},frontInner:chestNum,backInner:backNum}),
      // Arms: upper arm (shoulder->elbow) + forearm (elbow->hand) so they bend to
      // the stick naturally. Both hands land on the shaft (ready grip).
      limb(shTop,elTop,3.4,J.body,{front:slvTex,back:slvTex,side:slvTex,top:slvTex}),
      limb(elTop,handTop,3.2,J.body,{front:slvTex,back:slvTex,side:slvTex,top:slvTex}),
      limb(shBot,elBot,3.4,J.body,{front:slvTex,back:slvTex,side:slvTex,top:slvTex}),
      limb(elBot,handBot,3.2,J.body,{front:slvTex,back:slvTex,side:slvTex,top:slvTex}),
      // Gloves at the two grip points
      box({w:3.8,h:3.4,d:3.8,x:handTop[0],y:handTop[1],z:handTop[2],c:black,faces:{front:gloveTex,back:gloveTex,side:gloveTex,top:gloveTex,bottom:gloveTex}}),
      box({w:3.8,h:3.4,d:3.8,x:handBot[0],y:handBot[1],z:handBot[2],c:black,faces:{front:gloveTex,back:gloveTex,side:gloveTex,top:gloveTex,bottom:gloveTex}}),
      // Head
      box({w:7.6,h:7.6,d:7.6,y:28,c:skin,frontInner:faceInner}),
      // Hair style: what flows out the back of the helmet (flow / short / long)
      (look.hairStyle==='short'
        ? box({w:6.9,h:1.1,d:1,y:24.5,z:-4,c:hair})
        : look.hairStyle==='long'
        ? box({w:7,h:4.6,d:1.7,y:23.4,z:-4.4,c:hair})
        : box({w:6.8,h:2.4,d:1.4,y:25.3,z:-4.2,c:hair})),
      // Helmet shell (top + back half), leaves the face open for the cage
      box({w:8.4,h:2.6,d:8.4,y:31.3,c:helmet,faces:{front:helTex,back:helTex,side:helTex,top:helTex,bottom:helTex}}),
      box({w:8.4,h:4.6,d:2.4,y:28.2,z:-3.2,c:helmet,faces:{front:helTex,back:helTex,side:helTex,top:helTex,bottom:helTex}}),
      box({w:1,h:4.8,d:5.6,x:-4.2,y:27.9,z:.6,c:helmet,faces:{front:helTex,back:helTex,side:helTex,top:helTex,bottom:helTex}}),
      box({w:1,h:4.8,d:5.6,x:4.2,y:27.9,z:.6,c:helmet,faces:{front:helTex,back:helTex,side:helTex,top:helTex,bottom:helTex}}),
      // Cage
      "<div class='av-b' style='transform:translate3d(0,-27.4em,4.3em)'>"+face('av-cage',7.8,6.4,'none',cageBg)+"</div>",
      // Stick (knob -> ice shaft, white tape at the heel, blade along the ice to the
      // toe). BASE stick; unlocked sticks (chrome/gold/etc.) recolor these same boxes.
      limb(knob,ice,1.3,stickWood),
      box({w:1.5,h:1.6,d:1.6,x:ice[0],y:2.2,z:ice[2]-0.4,c:'#E8E8E8'}),
      box({w:1.4,h:2.2,d:(bladeToe[2]-ice[2]),x:ice[0],y:1.3,z:(ice[2]+bladeToe[2])/2,c:'#232323'})
    ];
    // Facing: rotate the whole scene. Left is the default 3/4 view.
    var faceY=(look.facing==='right')?25:((look.facing==='center')?0:-25);
    return "<div class='av-wrap' aria-hidden='true'><div class='av-scene' style='transform:rotateX(-10deg) rotateY("+faceY+"deg)'>"+parts.join('')+"</div></div>";
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

  window.thwapAvatar={ on:on, html:html, lookFor:lookFor, SKIN:SKIN, HAIR:HAIR, JERSEY:JERSEY, DEFAULT_LOOK:DEFAULT_LOOK };
})();
