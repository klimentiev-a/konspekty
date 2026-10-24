/* Two products only. Funds remain a section of StockAI, never a third stop. */
(()=>{
 'use strict';
 const products={bonds:{name:'Облигации',next:'stock'},stock:{name:'Акции',next:'bonds'}};
 const routes={bonds:'index.html?from=stocks',stock:'akcii.html#screener'};
 document.querySelectorAll('[data-product-picker]').forEach(root=>{
  const square=root.querySelector('.product-square'),name=root.querySelector('[data-product-name]');
  if(!square||!name)return;
  const sync=()=>{
   const current=root.dataset.productPicker==='bonds'?'bonds':'stock';
   const product=products[current],next=products[product.next];
   name.textContent=product.name;
   square.setAttribute('href',routes[product.next]);
   square.setAttribute('aria-label',`Переключить: ${next.name}`);
   square.setAttribute('title',`Переключить: ${next.name}`);
   
  };
  window.addEventListener('hashchange',sync);sync();
 });
})();
