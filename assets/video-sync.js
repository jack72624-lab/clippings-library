/* ============================================================
   Clippings 閱讀庫 · 影片同步（video-sync）v2 — 段落帶影片
   單／多影片共用一套。純 vanilla。搭配 video-sync.css。

   啟用（擇一）：
     <body data-video="YT_ID">                          單影片
     <body data-videos='[{"id":"…","label":"…"},…]'>    多影片（不限數量）

   跟讀段：<h2 data-follow data-t="起秒" [data-v="影片索引0起"] [data-end="訖秒"] data-label="…">
   時間碼：<a class="tc" data-t="秒" [data-v] href="…v=ID&t=Ns">

   行為：
     · 跟讀「開」＝段落帶影片（捲動驅動）：你讀到哪段 → 影片跳到它的
       data-v / data-t，播到 data-end 就停；往下滑到下一段 → 換播它的片段（跨影片自動換）。
       data-end 省略時，自動取「同一影片的下一段 data-t」為訖（＝該章節長度）——
       所以舊單片 entry（只有 data-follow data-t）零改檔就自動 retrofit。
     · 跟讀「關」＝自由播放：不限片段、不隨捲動跳；多片可用切換列、段落 ▶ 手動跳。
     · 手機（無嵌入播放器）：段落 ▶ 直接開 YouTube 到該秒。

   對齊 reader.js 畫重點雷區：影片與控制列都在 .readable 外；跟讀只用 class ＋
   Web Animations（不動 .readable innerHTML → 不會漏進畫重點快照）。
   ============================================================ */
(function(){
  var body=document.body, VIDEOS=[];
  try{ if(body.dataset.videos) VIDEOS=JSON.parse(body.dataset.videos); }catch(e){ VIDEOS=[]; }
  if((!VIDEOS||!VIDEOS.length) && body.dataset.video){ VIDEOS=[{id:body.dataset.video.trim(), label:'影片'}]; }
  if(!VIDEOS.length) return;                          // 沒有影片來源 → 不啟用
  var MULTI = VIDEOS.length>1;

  var A       = document.querySelector('.readable');
  var vnow    = document.getElementById('vnow');
  var fbtn    = document.getElementById('followBtn');
  var vtoggle = document.getElementById('vtoggle');
  var vswitch = document.getElementById('vswitch');

  var player=null, apiReady=false, playerBuilt=false, pendingBuild=false, ytReady=false;
  var curV=0, curVLoaded=0, followOn=false, activeEl=null, pendingSeek=null, clipEnd=null, seekTimer=null, raf=0;

  function fmt(s){ s=Math.max(0,Math.round(s)); var m=Math.floor(s/60), ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
  function setNow(h){ if(vnow) vnow.innerHTML=h; }
  function shortLabel(l){ return (l||'').split('·')[0].trim() || l; }

  /* 切換列：只有多影片才需要（單片藏起）*/
  if(vswitch && MULTI){
    vswitch.innerHTML = VIDEOS.map(function(v,i){
      return '<button type="button" data-v="'+i+'" aria-current="'+(i===0)+'">'+shortLabel(v.label)+'</button>';
    }).join('');
    vswitch.addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return;
      playClip(+b.dataset.v,0,null);
      setNow('▶ <b>'+shortLabel(VIDEOS[+b.dataset.v].label)+'</b> · 自由播');
    });
  } else if(vswitch){ vswitch.style.display='none'; }
  function markTabs(){ if(!vswitch||!MULTI) return; [].forEach.call(vswitch.children,function(b,i){ b.setAttribute('aria-current', String(i===curV)); }); }

  /* 延後建立 player：等影片帶顯示、容器全尺寸才建（→ 清晰預覽圖，同 v1）*/
  function buildPlayer(){
    if(playerBuilt) return;
    if(!apiReady){ pendingBuild=true; return; }
    playerBuilt=true;
    player=new YT.Player('ytPlayer',{
      videoId:VIDEOS[curV].id,
      playerVars:{playsinline:1,rel:0,modestbranding:1},
      events:{ 'onReady':function(){ ytReady=true; curVLoaded=curV; if(pendingSeek!=null){ player.seekTo(pendingSeek,true); player.playVideo(); pendingSeek=null; } } }
    });
  }
  window.onYouTubeIframeAPIReady=function(){ apiReady=true; if(pendingBuild) buildPlayer(); };

  function openVideo(){
    if(!body.classList.contains('vmode')){
      body.classList.add('vmode');
      if(vtoggle) vtoggle.innerHTML='<span class="pl">✕</span> 收起影片';
    }
    buildPlayer();
  }

  /* 播某片段：換片＋跳起點；end 非空 → 記錄訖點供 tick 暫停 */
  function playClip(v, start, end){
    v=+v||0; start=start||0;
    openVideo();
    clipEnd=(end!=null && end!=='') ? +end : null;
    curV=v; markTabs();
    if(!playerBuilt || !ytReady){ pendingSeek=start; buildPlayer(); return; }
    if(v!==curVLoaded){ curVLoaded=v; player.loadVideoById({videoId:VIDEOS[v].id, startSeconds:start}); }
    else { player.seekTo(start,true); player.playVideo(); }
  }

  /* 跟讀段（有 data-t 的 [data-follow]，文件順序）*/
  function follows(){ return [].slice.call(A.querySelectorAll('[data-follow]')).filter(function(el){ return el.dataset.t!=null && el.dataset.t!==''; }); }
  /* 某段訖點：data-end 優先；否則同影片「下一段 data-t」（需 ＞起點）；否則 null（播到影片尾、不硬停）*/
  function endOf(el, list, i){
    if(el.dataset.end) return +el.dataset.end;
    var v=+el.dataset.v||0, start=parseInt(el.dataset.t,10)||0;
    for(var j=i+1;j<list.length;j++){
      if((+list[j].dataset.v||0)===v){ var nt=parseInt(list[j].dataset.t,10)||0; return nt>start?nt:null; }
    }
    return null;
  }

  function stickyOffset(){
    var tb=document.querySelector('.topbar'), vp=document.querySelector('.vpanel');
    var vh=(vp&&vp.offsetParent!==null)?vp.offsetHeight:0;   // 手機 vpanel display:none → 0
    return (tb?tb.offsetHeight:0)+vh+16;
  }
  /* scroll-spy：目前「正在讀」那段＝閱讀線以上最後一段 */
  function currentEl(){
    var line=stickyOffset()+48, arr=follows(), found=null;
    for(var i=0;i<arr.length;i++){ if(arr[i].getBoundingClientRect().top<=line) found=arr[i]; else break; }
    return found || (arr.length?arr[0]:null);
  }
  /* 啟用某段：換片段（debounce 180ms，快速滑過不抽搐）
     只用 Web Animations 閃一下 ＋ #vnow 讀出「正在讀哪段」，不加 class 到 .readable
     → 不會漏進 reader.js 的畫重點快照（對齊 video-sync 雷區）。*/
  function activate(el){
    if(!el || el===activeEl) return;
    var arr=follows(), i=arr.indexOf(el); if(i<0) return;
    activeEl=el;
    var v=+el.dataset.v||0, start=parseInt(el.dataset.t,10)||0, end=endOf(el,arr,i), label=el.dataset.label||'';
    setNow('▶ <b>'+fmt(start)+(end!=null?('–'+fmt(end)):'')+'</b> · '+label+(MULTI?('（'+shortLabel(VIDEOS[v].label)+'）'):''));
    if(el.animate) el.animate([{backgroundColor:'#f4e5a1'},{backgroundColor:'transparent'}],{duration:850,easing:'ease-out'});
    clearTimeout(seekTimer); seekTimer=setTimeout(function(){ playClip(v,start,end); },180);
  }

  /* 捲動驅動（只跟讀開時）*/
  window.addEventListener('scroll',function(){
    if(!followOn||raf) return;
    raf=requestAnimationFrame(function(){ raf=0; activate(currentEl()); });
  },{passive:true});

  /* 片段播到訖點 → 暫停（靜靜停住，不 loop）*/
  setInterval(function(){
    if(!followOn||!ytReady||!player||!player.getCurrentTime||clipEnd==null) return;
    if(player.getCurrentTime()>=clipEnd-0.15) player.pauseVideo();
  },250);

  /* 點段落 ▶：手動跳到該段起點自由播（不鎖訖點）；手機讓 <a> 原生開 YouTube */
  if(A){
    A.addEventListener('click',function(e){
      var c=e.target.closest('.tc'); if(!c||!A.contains(c)) return;
      if(window.matchMedia('(max-width:880px)').matches) return;
      e.preventDefault();
      playClip(+c.dataset.v||0, parseInt(c.dataset.t,10)||0, null);
      setNow('▶ 已跳到 <b>'+fmt(parseInt(c.dataset.t,10)||0)+'</b>（自由播）');
    });
  }

  /* 跟讀開關 */
  if(fbtn){
    fbtn.addEventListener('click',function(){
      followOn=!followOn;
      fbtn.classList.toggle('on',followOn);
      fbtn.textContent=followOn?'跟讀：開':'跟讀：關';
      if(followOn){ openVideo(); activeEl=null; setNow('跟讀開 · 影片只播你正在讀那段，往下滑換下一段'); activate(currentEl()); }
      else { clipEnd=null; setNow('跟讀關 · 影片自由播放'+(MULTI?'；上方可切換影片':'')+'，點段落 ▶ 手動跳'); }
    });
  }

  /* 看影片 / 收起影片 */
  function stopPlayback(){
    /* 趁 iframe 還可見先停（display:none 後 postMessage 有時送不進去 → 背景還有聲音）。
       pauseVideo 主停、stopVideo 保險；不看 ytReady，用 try/catch 硬打。*/
    if(player){
      try{ if(player.pauseVideo) player.pauseVideo(); }catch(e){}
      try{ if(player.stopVideo)  player.stopVideo();  }catch(e){}
    }
    if(followOn){
      followOn=false;
      if(fbtn){ fbtn.classList.remove('on'); fbtn.textContent='跟讀：關'; }
      clipEnd=null;
      setNow('點段落旁的 ▶ 時間碼跳到影片那一段');
    }
  }
  if(vtoggle){
    vtoggle.addEventListener('click',function(){
      var willShow = !body.classList.contains('vmode');
      if(!willShow) stopPlayback();          // 收起＝先把影片停掉（趁還可見）
      body.classList.toggle('vmode');
      vtoggle.innerHTML = willShow ? '<span class="pl">✕</span> 收起影片' : '<span class="pl">▶</span> 看影片';
      if(willShow) buildPlayer();
    });
  }
})();
