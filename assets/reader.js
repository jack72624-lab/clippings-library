/* ============================================================
   Clippings 閱讀庫 · 閱讀器
   術語 tooltip · 選字螢光筆 · 註記 · 重點面板 · localStorage 存取 · 匯出
   純 vanilla，無框架。畫重點以「快照 .readable innerHTML」持久化（線框夠用）。
   ============================================================ */
(function(){
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* ---------- 取景器游標 ---------- */
  if(fine && !reduce){
    const vf=document.createElement('div'); vf.id='vf'; document.body.appendChild(vf);
    let tx=innerWidth/2,ty=innerHeight/2,cx=tx,cy=ty;
    addEventListener('mousemove',e=>{tx=e.clientX;ty=e.clientY},{passive:true});
    (function l(){cx+=(tx-cx)*.18;cy+=(ty-cy)*.18;vf.style.transform=`translate(${cx}px,${cy}px)`;requestAnimationFrame(l)})();
    const grow=()=>vf.classList.add('big'), shrink=()=>vf.classList.remove('big');
    document.addEventListener('mouseover',e=>{ if(e.target.closest('a,button,.card,mark.hl,.term')) grow(); else shrink(); });
  }

  /* ---------- 進度條 + 進場 ---------- */
  const bar=document.querySelector('.progress .bar');
  if(bar) addEventListener('scroll',()=>{const m=document.documentElement.scrollHeight-innerHeight;bar.style.width=(Math.max(0,Math.min(1,scrollY/(m||1)))*100)+'%'},{passive:true});
  if(reduce){ document.querySelectorAll('.rise,.mask').forEach(el=>el.classList.add('in')); }
  else{
    requestAnimationFrame(()=>document.querySelectorAll('.art-hero .mask,.hub-hero .mask,.art-hero .rise,.hub-hero .rise').forEach((el,i)=>setTimeout(()=>el.classList.add('in'),80*i)));
    const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('.rise').forEach(el=>{ if(!el.closest('.art-hero,.hub-hero')) io.observe(el); });
  }


  /* ---------- 術語 tooltip ---------- */
  const tip=document.getElementById('tip');
  let rebindTerms=()=>{};              // 供螢光筆還原 innerHTML 後重新綁定 .term（見下方 BUG-1 修）
  if(tip){
    let pinned=false;
    const show=(el)=>{
      tip.innerHTML='<div class="tt">術語</div>'+el.dataset.def;
      tip.style.display='block';
      const r=el.getBoundingClientRect(), tw=tip.offsetWidth, th=tip.offsetHeight;
      let x=r.left+r.width/2-tw/2; x=Math.max(12,Math.min(innerWidth-tw-12,x));
      let y=r.top-th-12; if(y<12) y=r.bottom+12;
      tip.style.left=x+'px'; tip.style.top=y+'px';
    };
    const hide=()=>{ if(!pinned){ tip.style.display='none'; } };
    rebindTerms=()=>{ document.querySelectorAll('.term').forEach(el=>{
      if(fine){ el.addEventListener('mouseenter',()=>{pinned=false;show(el)}); el.addEventListener('mouseleave',hide); }
      el.addEventListener('click',e=>{ e.stopPropagation(); pinned=true; show(el); });
    }); };
    rebindTerms();
    document.addEventListener('click',()=>{ pinned=false; tip.style.display='none'; });
    addEventListener('scroll',()=>{ if(!pinned) tip.style.display='none'; },{passive:true});
  }

  /* ---------- 螢光筆（4 色 + 底線 + 可移除）---------- */
  const A=document.querySelector('.readable');
  if(!A) return;
  // 畫重點 key：全站版本 v4 + 每篇 data-entry。另帶「每篇獨立版本旋鈕」data-hlver：
  // 合併/大改某篇時只把該篇 <body data-hlver="2">，就只清那篇舊重點、其他文章不動。
  // 向後相容：沒設 hlver 或 hlver='1' 時 key 維持原樣（現有重點不會被 orphan）。
  const _hv=document.body.dataset.hlver;
  const KEY='cliplib:hl:v4:'+(document.body.dataset.entry||location.pathname)+(_hv&&_hv!=='1'?':'+_hv:'');
  const savedHL=localStorage.getItem(KEY);
  if(savedHL){ A.innerHTML=savedHL;
    const nested=A.querySelectorAll('mark.hl mark.hl');          // 一次性：把舊資料裡疊加的巢狀標記攤平
    if(nested.length){ nested.forEach(inner=>{ while(inner.firstChild) inner.parentNode.insertBefore(inner.firstChild,inner); inner.remove(); }); if(A.normalize) A.normalize(); localStorage.setItem(KEY, A.innerHTML); }
    rebindTerms();                                               // 還原 innerHTML 摧毀舊 .term 監聽器，重綁一次（BUG-1 修）
  }

  const hlbar=document.getElementById('hlbar');
  const noteBox=document.getElementById('noteBox');
  const DEF='y';                              // 預設螢光色
  let curRange=null, curMark=null, mode='new'; // mode: new=新選取 / edit=點既有標記

  function hideBar(){ if(hlbar){ hlbar.style.display='none'; hlbar.classList.remove('edit'); } mode='new'; curMark=null; curRange=null; }
  function posFloat(el,rect){
    el.style.display = (el.id==='hlbar') ? 'flex' : 'block';
    const w=el.offsetWidth,h=el.offsetHeight;
    let x=rect.left+rect.width/2-w/2; x=Math.max(10,Math.min(innerWidth-w-10,x));
    let y=rect.top-h-10; if(y<10) y=rect.bottom+10;
    el.style.left=x+'px'; el.style.top=y+'px';
  }

  // 新選取一段字 → 跳工具列
  function onSelect(e){
    if(e&&e.target&&e.target.closest&&e.target.closest('#hlbar,#noteBox,mark.hl')) return;
    setTimeout(()=>{
      const sel=getSelection();
      if(!sel.rangeCount||sel.isCollapsed) return;
      const range=sel.getRangeAt(0);
      if(String(range).trim().length<2||!A.contains(range.commonAncestorContainer)) return;
      mode='new'; curMark=null; curRange=range.cloneRange();
      if(hlbar){ hlbar.classList.remove('edit'); posFloat(hlbar, range.getBoundingClientRect()); }
    },10);
  }
  document.addEventListener('mouseup',onSelect);
  document.addEventListener('touchend',onSelect);

  // 產生標記（防疊加：攤平內含的舊標記 ＋ 拆掉外層舊標記，保證單層、絕不巢狀）
  function makeMark(kind){
    const m=document.createElement('mark'); m.className='hl hl-'+kind;
    m.appendChild(curRange.extractContents());
    m.querySelectorAll('mark.hl').forEach(inner=>{ while(inner.firstChild) inner.parentNode.insertBefore(inner.firstChild,inner); inner.remove(); });
    curRange.insertNode(m);
    let anc=m.parentNode;                         // 若新標記落在舊標記「內部」→ 拆外層，最後動作優先
    while(anc&&anc!==A){ const up=anc.parentNode;
      if(anc.matches&&anc.matches('mark.hl')){ while(anc.firstChild) up.insertBefore(anc.firstChild,anc); up.removeChild(anc); }
      anc=up; }
    if(A.normalize) A.normalize();
    return m;
  }
  function markKind(m){ const x=m.className.match(/\bhl-(y|g|b|r|under)\b/); return x?x[1]:'y'; }

  // 套一種標記（4 色之一或底線）：新選取→新建；點既有標記→同種再點=移除、不同種=換
  function applyKind(kind){
    if(mode==='edit'&&curMark){
      if(markKind(curMark)===kind){ removeMark(curMark); return; }   // 再選一次同一種 → 刪除
      const note=curMark.dataset.note; curMark.className='hl hl-'+kind; if(note) curMark.dataset.note=note;
      getSelection().removeAllRanges(); save(); bindMarks(); hideBar();
    } else if(curRange){
      try{ curMark=makeMark(kind); }catch(err){ curMark=null; }
      getSelection().removeAllRanges(); save(); bindMarks(); hideBar();
    }
  }
  function removeMark(m){
    if(!m) return;
    while(m.firstChild) m.parentNode.insertBefore(m.firstChild,m); m.remove();
    if(A.normalize) A.normalize();
    getSelection().removeAllRanges(); save(); bindMarks(); hideBar();
  }
  // 備注：新選取→建預設標記並開編輯框；點既有標記→開編輯（清空後存檔即刪除備注）
  function noteFlow(){
    if(mode==='edit'&&curMark){ openNote(curMark); return; }
    if(curRange){ try{ curMark=makeMark(DEF); }catch(err){ curMark=null; } getSelection().removeAllRanges(); save(); bindMarks(); if(curMark) openNote(curMark); }
  }

  if(hlbar){
    hlbar.querySelectorAll('.sw').forEach(b=>{ b.addEventListener('mousedown',e=>e.preventDefault()); b.addEventListener('click',()=>applyKind(b.dataset.color)); });
    hlbar.querySelectorAll('.tb').forEach(b=>{ b.addEventListener('mousedown',e=>e.preventDefault()); b.addEventListener('click',()=>{
      const a=b.dataset.act;
      if(a==='under') applyKind('under');
      else if(a==='note') noteFlow();
      else if(a==='remove') removeMark(curMark);
      else hideBar();
    }); });
  }

  // 點既有標記 → 編輯模式（可改色 / 加註 / 移除）
  function bindMarks(){
    A.querySelectorAll('mark.hl').forEach(m=>{ m.onclick=(e)=>{ e.stopPropagation(); mode='edit'; curMark=m; curRange=null; if(hlbar){ hlbar.classList.add('edit'); posFloat(hlbar, m.getBoundingClientRect()); } }; });
  }
  bindMarks();

  function openNote(m){
    curMark=m;
    if(hlbar) hlbar.style.display='none';
    const ta=noteBox.querySelector('textarea'); ta.value=m.dataset.note||'';
    noteBox.style.display='block'; posFloat(noteBox, m.getBoundingClientRect()); ta.focus();
  }
  if(noteBox){
    noteBox.querySelector('[data-nb="save"]').onclick=()=>{
      const v=noteBox.querySelector('textarea').value.trim();
      if(v) curMark.dataset.note=v; else curMark.removeAttribute('data-note');
      noteBox.style.display='none'; save(); bindMarks();
    };
    noteBox.querySelector('[data-nb="cancel"]').onclick=()=>{ noteBox.style.display='none'; };
  }

  // 點空白處 / 捲動 → 收起工具列與註記框
  document.addEventListener('mousedown',e=>{ if(e.target.closest('#hlbar,#noteBox,mark.hl')) return; hideBar(); if(noteBox) noteBox.style.display='none'; });
  addEventListener('scroll',()=>{ hideBar(); if(noteBox) noteBox.style.display='none'; },{passive:true});

  /* ---------- 存 + 重點面板 ---------- */
  const panel=document.getElementById('panel');
  const plist=panel&&panel.querySelector('.plist');
  const panelBtn=document.getElementById('panelBtn');

  function save(){ localStorage.setItem(KEY, A.innerHTML); renderPanel(); }

  function collect(){
    return [...A.querySelectorAll('mark.hl')].map(m=>({el:m,text:m.textContent.trim(),note:m.dataset.note||''}));
  }
  function renderPanel(){
    if(!plist) return;
    const items=collect();
    if(panelBtn) panelBtn.textContent='重點 '+items.length;
    if(!items.length){ plist.innerHTML='<div class="pempty">還沒有畫重點。<br>在內文選一段字，<br>用工具列上色或加註。</div>'; return; }
    plist.innerHTML=items.map((it,i)=>`<div class="pi" data-i="${i}"><div class="qt">${esc(it.text)}</div>${it.note?`<div class="nt">✎ ${esc(it.note)}</div>`:''}</div>`).join('');
    plist.querySelectorAll('.pi').forEach(pi=>{
      pi.onclick=()=>{ const it=items[+pi.dataset.i]; it.el.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'}); it.el.animate?it.el.animate([{filter:'brightness(.82)'},{filter:'none'}],{duration:700}):0; };
    });
  }
  function esc(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  if(panelBtn&&panel){
    panelBtn.onclick=()=>panel.classList.add('open');
    panel.querySelector('.x').onclick=()=>panel.classList.remove('open');
    panel.querySelector('[data-pf="export"]').onclick=()=>{
      const items=collect();
      const title=document.title.replace(/ · .*/,'');
      const md='# 重點筆記：'+title+'\n\n'+items.map(it=>'- '+it.text+(it.note?'\n  > '+it.note:'')).join('\n')+'\n';
      navigator.clipboard.writeText(md).then(()=>{ const b=panel.querySelector('[data-pf="export"]'); const t=b.textContent; b.textContent='已複製 Markdown'; setTimeout(()=>b.textContent=t,1600); });
    };
    panel.querySelector('[data-pf="clear"]').onclick=()=>{
      if(!confirm('清除這篇所有重點與註記？')) return;
      A.querySelectorAll('mark.hl').forEach(m=>{ while(m.firstChild) m.parentNode.insertBefore(m.firstChild,m); m.remove(); });
      save(); bindMarks();
    };
  }
  renderPanel();
})();
