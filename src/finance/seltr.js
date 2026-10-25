/* Hub: выделил слово или фразу на английской странице — перевод сразу сверху */
(function(){
  var bar,tm,seq=0,cache={};
  var css='.seltr{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);transform:translate(-50%,-160%);z-index:9997;max-width:min(680px,94vw);padding:10px 14px 10px 16px;border-radius:14px;border:1px solid var(--line,#D9D3C2);background:var(--surface,var(--bg,#FBF9F3));color:var(--fg,#25221C);box-shadow:0 10px 30px rgba(0,0,0,.28);font:500 15px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:flex-start;transition:transform .25s cubic-bezier(.2,.9,.25,1);zoom:var(--iz,1)}'+
  '.seltr.on{transform:translate(-50%,0)}.seltr small{display:block;color:var(--muted,#665F52);font-size:12px;margin-bottom:2px;word-break:break-word}.seltr b{font-weight:600}.seltr button{flex:none;border:0;background:none;color:var(--muted,#665F52);font-size:20px;line-height:1;cursor:pointer;padding:0 2px}'+
  '@media (prefers-reduced-motion:reduce){.seltr{transition:none}}';
  function el(){if(bar)return bar;var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);
    bar=document.createElement('div');bar.className='seltr';bar.setAttribute('role','status');bar.innerHTML='<div><small></small><b></b></div><button type="button" aria-label="Закрыть">×</button>';
    bar.querySelector('button').onclick=hide;document.body.appendChild(bar);return bar}
  function hide(){if(bar)bar.classList.remove('on')}
  function show(src,txt){var b=el();b.querySelector('small').textContent=src;b.querySelector('b').textContent=txt;b.classList.add('on')}
  function glossary(w){ // слова из таблиц Words (Term | Перевод) на странице
    w=w.toLowerCase();var rows=document.querySelectorAll('table tr'),i,c;
    for(i=0;i<rows.length;i++){c=rows[i].children;if(c.length>=2&&c[0].textContent.trim().toLowerCase()===w)return c[1].textContent.trim()}return ''}
  function tr(t){
    var id=++seq;if(cache[t]){show(t,cache[t]);return}
    var g=glossary(t);if(g){cache[t]=g;show(t,g);return}
    show(t,'…');
    fetch('https://api.mymemory.translated.net/get?langpair=en|ru&q='+encodeURIComponent(t)).then(function(r){return r.json()}).then(function(j){
      if(id!==seq)return;var x=j&&j.responseData&&j.responseData.translatedText;
      if(!x||/MYMEMORY WARNING|INVALID/i.test(x)){show(t,'Не удалось перевести (нет сети или лимит). Попробуй позже.');return}
      cache[t]=x;show(t,x)}).catch(function(){if(id===seq)show(t,'Не удалось перевести: нет сети.')})}
  function check(){
    var s=window.getSelection&&window.getSelection();if(!s||s.isCollapsed)return;
    var t=s.toString().replace(/\s+/g,' ').trim();
    if(t.length<2||t.length>400||!/[A-Za-z]/.test(t)||/[А-Яа-яЁё]{3,}/.test(t)&&!/[A-Za-z]{3,}/.test(t))return;
    var n=s.anchorNode;n=n&&(n.nodeType===1?n:n.parentNode);if(n&&n.closest&&n.closest('input,textarea,.seltr'))return;
    tr(t)}
  function later(){clearTimeout(tm);tm=setTimeout(check,350)}
  document.addEventListener('mouseup',later);document.addEventListener('keyup',function(e){if(e.shiftKey)later()});
  document.addEventListener('selectionchange',function(){var s=window.getSelection();if(s&&!s.isCollapsed&&('ontouchstart' in window))later()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')hide()});
})();
