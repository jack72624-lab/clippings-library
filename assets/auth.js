/* ============================================================
   Clippings 閱讀庫 · 雲端同步（登入 + Firestore 劃線同步）
   由 reader.js 自動注入，全站每頁都載入。

   設計要點：
   - 未登入 / 匿名訪客：只顯示右上角「登入」鈕，完全不載 Firebase → 公開站維持純靜態、
     產出檔案裡零私人資料。
   - 登入用 Email + 密碼（standalone PWA 最穩：無彈窗、無轉址、直接 API）。
   - 登入後：把「.readable 的 innerHTML 快照」存到 Firestore
     users/{uid}/highlights/{entryId}，跨裝置同步（沿用 reader.js 既有的劃線引擎、不改寫）。
   - 真私密靠 Firestore 安全規則（只允許本人 uid 讀寫），不是前端遮罩。
   - 衝突處理：last-write-wins，用 client 時間戳 ts 比新舊，避免蓋掉較新的離線編輯。
   ============================================================ */
(function(){
  if(window.CloudSync) return;                 // 防重複注入
  var SDK='https://www.gstatic.com/firebasejs/11.3.1/';
  var CFG={
    apiKey:"AIzaSyCsxIndvdEQ6KxSAeJf2h_OTDAhAjT2vYs",
    authDomain:"my-clippings-library.firebaseapp.com",
    projectId:"my-clippings-library",
    storageBucket:"my-clippings-library.firebasestorage.app",
    messagingSenderId:"680914797594",
    appId:"1:680914797594:web:f60ae59671e02306647da3"
  };
  var FLAG='cliplib:auth';        // 本機旗標：登入成功就設。用它決定按鈕文字、以及要不要在 reader 頁自動還原 session。

  var fb=null;      // Firebase 模組 + 實例集合（延遲載入）
  var user=null;    // 已登入的 firebase user
  var reader=null;  // reader.js 註冊的當前文章
  var pushTimer=null, pendingPush=null;

  /* ---------- 對外 API（reader.js 用）---------- */
  window.CloudSync={
    // reader.js 載完當前文章後呼叫；若已登入就立刻拉遠端
    onEntryReady:function(r){ reader=r; if(user) pullCurrent(); },
    // reader.js 每次 save() 呼叫；debounce 後寫 Firestore（未登入則只暫存、不寫）
    push:function(html){ pendingPush=html; if(!user) return; clearTimeout(pushTimer); pushTimer=setTimeout(flushPush,1200); }
  };

  function hasHL(html){ return /<mark[^>]*class="hl/i.test(html||''); }

  /* ---------- UI：右上角登入鈕 ---------- */
  var btn;
  function makeBtn(){
    btn=document.createElement('button');
    btn.type='button'; btn.className='authbtn caps'; btn.textContent='登入';
    btn.addEventListener('click',onBtn);
    var tb=document.querySelector('.topbar');
    if(tb){
      var r=tb.querySelector('.r');
      if(!r){ r=document.createElement('span'); r.className='r grot'; tb.appendChild(r); }
      r.appendChild(btn);
    }else{
      btn.classList.add('authbtn-float'); document.body.appendChild(btn);
    }
    reflect();
  }
  function reflect(){ if(btn) btn.textContent = localStorage.getItem(FLAG) ? '登出' : '登入'; }

  /* ---------- UI：登入框（Morris 風、延遲建立）---------- */
  var modal, emailIn, pwIn, errLine, goBtn;
  function buildModal(){
    if(modal) return;
    modal=document.createElement('div'); modal.className='authmodal';
    modal.innerHTML=
      '<div class="am-card">'
      +'<div class="am-t caps">登入閱讀庫</div>'
      +'<div class="am-s">登入後你的劃線會同步、跨裝置跟著走。只有你自己看得到。</div>'
      +'<label class="am-l">Email<input type="email" autocomplete="username" class="am-i" data-f="email"></label>'
      +'<label class="am-l">密碼<input type="password" autocomplete="current-password" class="am-i" data-f="pw"></label>'
      +'<div class="am-err" data-f="err"></div>'
      +'<div class="am-row"><button type="button" class="am-cancel" data-f="cancel">取消</button>'
      +'<button type="button" class="am-go" data-f="go">登入</button></div>'
      +'</div>';
    document.body.appendChild(modal);
    emailIn=modal.querySelector('[data-f="email"]');
    pwIn=modal.querySelector('[data-f="pw"]');
    errLine=modal.querySelector('[data-f="err"]');
    goBtn=modal.querySelector('[data-f="go"]');
    modal.querySelector('[data-f="cancel"]').addEventListener('click',closeModal);
    goBtn.addEventListener('click',doLogin);
    modal.addEventListener('click',function(e){ if(e.target===modal) closeModal(); });
    pwIn.addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });
  }
  function openModal(){ buildModal(); errLine.textContent=''; modal.classList.add('open'); setTimeout(function(){emailIn.focus();},30); }
  function closeModal(){ if(modal) modal.classList.remove('open'); }

  function onBtn(){ if(localStorage.getItem(FLAG)) doLogout(); else openModal(); }

  /* ---------- Firebase 延遲載入 + auth ---------- */
  function ensureFb(){
    if(fb) return Promise.resolve(fb);
    return Promise.all([
      import(SDK+'firebase-app.js'),
      import(SDK+'firebase-auth.js'),
      import(SDK+'firebase-firestore.js')
    ]).then(function(mods){
      var appMod=mods[0], authMod=mods[1], fsMod=mods[2];
      var app=appMod.initializeApp(CFG);
      var auth=authMod.getAuth(app);
      var db=fsMod.getFirestore(app);
      fb={app:app,auth:auth,db:db};
      // 攤平常用函式，方便下面呼叫
      ['signInWithEmailAndPassword','signOut','onAuthStateChanged','setPersistence','browserLocalPersistence'].forEach(function(k){ fb[k]=authMod[k]; });
      ['doc','getDoc','setDoc','serverTimestamp'].forEach(function(k){ fb[k]=fsMod[k]; });
      try{ fb.setPersistence(auth, fb.browserLocalPersistence); }catch(_e){}
      fb.onAuthStateChanged(auth, function(u){
        user=u||null;
        if(user) localStorage.setItem(FLAG,'1'); else localStorage.removeItem(FLAG);
        reflect();
        if(user && reader) pullCurrent();
      });
      return fb;
    });
  }

  function doLogin(){
    errLine.textContent='';
    var em=(emailIn.value||'').trim(), pw=pwIn.value||'';
    if(!em||!pw){ errLine.textContent='請填 Email 和密碼。'; return; }
    goBtn.disabled=true; goBtn.textContent='登入中…';
    ensureFb().then(function(){
      return fb.signInWithEmailAndPassword(fb.auth, em, pw);
    }).then(function(){
      closeModal();
    }).catch(function(err){
      errLine.textContent=friendlyErr(err);
    }).then(function(){
      goBtn.disabled=false; goBtn.textContent='登入';
    });
  }
  function doLogout(){
    ensureFb().then(function(){ return fb.signOut(fb.auth); }).catch(function(){})
      .then(function(){ localStorage.removeItem(FLAG); user=null; reflect(); });
  }
  function friendlyErr(err){
    var c=(err&&err.code)||'';
    if(c.indexOf('invalid-credential')>-1||c.indexOf('wrong-password')>-1||c.indexOf('user-not-found')>-1) return 'Email 或密碼不對。';
    if(c.indexOf('too-many-requests')>-1) return '嘗試太多次，稍後再試。';
    if(c.indexOf('network')>-1) return '連不上網路，稍後再試。';
    return '登入失敗：'+(c||'未知錯誤');
  }

  /* ---------- Firestore 劃線同步 ---------- */
  function ref(){ return fb.doc(fb.db,'users',user.uid,'highlights',reader.entryId); }
  function pullCurrent(){
    if(!reader) return;
    ensureFb().then(function(){
      if(!user||!reader) return null;
      return fb.getDoc(ref());
    }).then(function(snap){
      if(!snap) return;
      var localTs=reader.localTs();
      if(snap.exists()){
        var d=snap.data()||{};
        if(d.hlver && d.hlver!==reader.hlver) return;         // 版本不符＝文章改過，遠端視為過時，不套
        var remoteTs=d.ts||0;
        if(remoteTs>localTs && d.html){ reader.applyRemote(d.html, remoteTs); }   // 遠端較新 → 套遠端
        else if(localTs>remoteTs && localTs){ flushPush(); }                      // 本機較新 → 推上去
      }else if(localTs || hasHL(reader.getHTML())){
        flushPush();                                           // 遠端沒有、本機有劃線 → 推上去
      }
    }).catch(function(){});
  }
  function flushPush(){
    if(!user||!reader) return;
    var html = pendingPush!=null ? pendingPush : reader.getHTML();
    pendingPush=null;
    ensureFb().then(function(){
      if(!user||!reader) return;
      return fb.setDoc(ref(), { html:html, hlver:reader.hlver, ts:Date.now(), updatedAt:fb.serverTimestamp() });
    }).catch(function(){});
  }

  /* ---------- 啟動 ---------- */
  function boot(){
    makeBtn();
    if(window.__cliplibReader && !reader) reader=window.__cliplibReader;
    // 只有「登入過 ＋ 這頁有劃線引擎」才自動載 Firebase 還原 session、同步；
    // 匿名頁 / 未登入 → 不載 Firebase，維持純靜態。
    if(localStorage.getItem(FLAG) && reader){ ensureFb(); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
