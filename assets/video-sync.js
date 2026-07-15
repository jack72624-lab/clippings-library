/* ============================================================
   Clippings 閱讀庫 · 影片同步（video-sync）
   影片型 entry 專用。搭配 video-sync.css。純 vanilla。
   用法：<body data-video="YT_ID"> ＋ 段落掛 <a class="tc" data-t="秒"> ＋
        跟讀段落掛 <h2 data-follow data-t="秒" data-label="標題">。
   兩種同步：① 點 chip → 影片跳（桌機頁內 seek / 手機開 YouTube 原片）
            ② 跟讀 → 影片播到哪,對應段落閃一下＋捲到面前（Web Animations,不動 innerHTML）
   ============================================================ */
(function(){
  var VID=(document.body.dataset.video||'').trim();
  if(!VID) return;                                   // 沒有影片來源 → 不啟用
  var player=null, ytReady=false, followOn=false, curIdx=-1, userLock=0;
  var playerBuilt=false, apiReady=false, pendingBuild=false, pendingSeek=null;
  var A=document.querySelector('.readable');
  var vnow=document.getElementById('vnow');
  var fbtn=document.getElementById('followBtn');
  var vtoggle=document.getElementById('vtoggle');

  function fmt(s){ s=Math.max(0,Math.round(s)); var m=Math.floor(s/60), ss=s%60; return m+':'+(ss<10?'0':'')+ss; }
  function setNow(html){ if(vnow) vnow.innerHTML=html; }
  // 延後建立 player：等使用者第一次「看影片」、容器已全尺寸顯示才建
  // → YouTube 才會給對應大尺寸的清晰預覽圖（先前在 display:none 時建,只拿到超低解析縮圖被撐大→模糊）
  function buildPlayer(){
    if(playerBuilt) return;
    if(!apiReady){ pendingBuild=true; return; }     // API 還沒載好 → 等 onYouTubeIframeAPIReady 回來再建
    playerBuilt=true;
    player=new YT.Player('ytPlayer',{
      videoId:VID,
      playerVars:{playsinline:1,rel:0,modestbranding:1},
      events:{ 'onReady':function(){
        ytReady=true;
        if(pendingSeek!=null){ player.seekTo(pendingSeek,true); player.playVideo(); pendingSeek=null; }
      } }
    });
  }
  function seekTo(t){
    if(ytReady&&player){ player.seekTo(t,true); player.playVideo(); }
    else { pendingSeek=t; buildPlayer(); }           // 還沒建好 → 記住秒數,建好即跳
  }
  function openVideo(){                               // 開影片模式（純文章 → 顯示置頂影片帶）
    if(!document.body.classList.contains('vmode')){
      document.body.classList.add('vmode');
      if(vtoggle) vtoggle.innerHTML='<span class="pl">✕</span> 收起影片';
    }
    buildPlayer();                                     // 首次顯示才建 player → 全尺寸容器 → 清晰預覽圖
  }

  /* 前向：點時間碼 chip → 影片跳過去。事件委派掛在 .readable 容器上，
     所以就算之後畫重點還原 innerHTML，chip 的點擊照樣有效（同 reader.js 對 .term 的處理精神）。*/
  if(A){
    A.addEventListener('click',function(e){
      var c=e.target.closest('.tc'); if(!c||!A.contains(c)) return;
      // 手機（無嵌入播放器）：不攔截,讓 <a> 直接開 YouTube 原片到該秒數
      if(window.matchMedia('(max-width:880px)').matches) return;
      // 桌機：攔截,改成頁內 seek；影片還沒開就順手幫你開起來
      e.preventDefault();
      openVideo();
      var t=parseInt(c.dataset.t,10)||0;
      userLock=performance.now()+1600;                // 剛手動跳 → 短暫不讓跟讀搶著捲
      seekTo(t);
      setNow('已跳到 <b>'+fmt(t)+'</b> · 播放中');
    });
  }

  /* YouTube IFrame API 載好 → 只記旗標,不馬上建 player（延後到影片帶顯示時才建,避免模糊預覽圖）*/
  window.onYouTubeIframeAPIReady=function(){ apiReady=true; if(pendingBuild) buildPlayer(); };

  /* 跟讀開關 */
  if(fbtn){
    fbtn.addEventListener('click',function(){
      followOn=!followOn;
      fbtn.classList.toggle('on',followOn);
      fbtn.textContent=followOn?'跟讀：開':'跟讀：關';
      if(followOn){ openVideo(); setNow('跟讀開啟 · 播放影片，段落會自動亮＋捲到你面前'); curIdx=-1; tick(); }
      else{ curIdx=-1; setNow('跟讀關閉 · 點段落旁的 ▶ 時間碼自己跳'); }
    });
  }

  /* 看影片 / 收起影片：預設純文章,按了才顯示置頂影片帶 */
  if(vtoggle){
    vtoggle.addEventListener('click',function(){
      var on=document.body.classList.toggle('vmode');
      vtoggle.innerHTML=on?'<span class="pl">✕</span> 收起影片':'<span class="pl">▶</span> 看影片';
      if(on) buildPlayer();
    });
  }

  function anchors(){
    return [].slice.call(A.querySelectorAll('[data-follow]')).map(function(el){
      return { el:el, t:parseInt(el.dataset.t,10)||0, label:el.dataset.label||'' };
    }).sort(function(a,b){ return a.t-b.t; });
  }
  function stickyOffset(){
    var tb=document.querySelector('.topbar'), vp=document.querySelector('.vpanel');
    // 桌機：影片置頂 sticky,要扣掉它的高度；手機 vpanel 是 display:none（offsetParent=null）→ 0
    var vh=(vp&&vp.offsetParent!==null)?vp.offsetHeight:0;
    return (tb?tb.offsetHeight:0)+vh+16;
  }
  /* 反向：影片播到哪 → 對應段落閃一下＋捲過去。
     高亮只用 Web Animations（不動 innerHTML → 不會漏進畫重點快照）。*/
  function tick(){
    if(!ytReady||!followOn||!player||!player.getCurrentTime) return;
    var t=player.getCurrentTime(), arr=anchors(), idx=-1;
    for(var i=0;i<arr.length;i++){ if(arr[i].t<=t+0.3) idx=i; else break; }
    if(idx<0) idx=0;
    if(idx!==curIdx){
      curIdx=idx; var a=arr[idx];
      setNow('▶ <b>'+fmt(a.t)+'</b> · '+a.label);
      if(a.el.animate) a.el.animate([{backgroundColor:'#f4e5a1'},{backgroundColor:'transparent'}],{duration:850,easing:'ease-out'});
      if(performance.now()>userLock){
        var y=a.el.getBoundingClientRect().top+window.scrollY-stickyOffset();
        window.scrollTo({top:y,behavior:'smooth'});
      }
    }
  }
  setInterval(tick,300);

  /* 使用者自己捲 → 暫時鎖住自動捲，避免打架 */
  window.addEventListener('scroll',function(){ userLock=performance.now()+1100; },{passive:true});
})();
