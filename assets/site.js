(function () {
  'use strict';

  var site = null;
  var products = [];
  var activeCat = 'all';

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function waLink(msg) {
    var num = digits(site && site.whatsapp) || '919122212333';
    return 'https://wa.me/' + num + (msg ? '?text=' + encodeURIComponent(msg) : '');
  }
  function catName(id) {
    var c = (site.categories || []).find(function (c) { return c.id === id; });
    return c ? c.name : '';
  }
  // Data files are fetched fresh so new uploads show up without waiting on the browser cache.
  function getJSON(path) {
    return fetch(path + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  function applySite() {
    document.querySelectorAll('[data-bind]').forEach(function (n) {
      var v = site[n.getAttribute('data-bind')];
      if (v) n.textContent = v;
    });
    if (site.headline && site.headline !== 'Where heritage becomes luxury') $('headline').textContent = site.headline;
    document.querySelectorAll('[data-wa]').forEach(function (a) { a.href = waLink(a.getAttribute('data-wa')); });

    var phones = $('phones');
    phones.textContent = '';
    (site.phones || []).forEach(function (p) {
      var copy = el('button', { class: 'mini', type: 'button', text: 'Copy' });
      var num = el('span', { class: 'num', text: p });
      copy.addEventListener('click', function () { copyText(copy, num, p); });
      var wa = el('a', { class: 'mini solid', href: 'https://wa.me/' + digits(p), target: '_blank', rel: 'noopener', text: 'WhatsApp' });
      var call = el('a', { class: 'mini', href: 'tel:+' + digits(p), text: 'Call' });
      phones.appendChild(el('div', { class: 'phone' }, [num, el('span', { class: 'acts' }, [call, wa, copy])]));
    });
    $('addr').textContent = site.address || '';
    $('addr').hidden = !site.address;
    var handle = String(site.instagram || '').replace(/^@/, '');
    $('ig').hidden = !handle;
    $('ig').href = 'https://www.instagram.com/' + handle + '/';
    $('ig-handle').textContent = '@' + handle;

    var want = $('f-want');
    want.textContent = '';
    (site.categories || []).forEach(function (c) { want.appendChild(el('option', { text: c.name })); });
    want.appendChild(el('option', { text: 'Everything' }));
  }

  function copyText(btn, node, text) {
    var reset = function () { setTimeout(function () { btn.textContent = 'Copy'; }, 1600); };
    var fallback = function () {
      var r = document.createRange(); r.selectNodeContents(node);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      btn.textContent = 'Selected'; reset();
    };
    try { navigator.clipboard.writeText(text).then(function () { btn.textContent = 'Copied'; reset(); }, fallback); }
    catch (e) { fallback(); }
  }

  function renderChips() {
    var chips = $('chips');
    chips.textContent = '';
    var cats = [{ id: 'all', name: 'All' }].concat(site.categories || []);
    cats.forEach(function (c) {
      var n = c.id === 'all' ? products.length : products.filter(function (p) { return p.category === c.id; }).length;
      if (c.id !== 'all' && n === 0) return;
      var b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(activeCat === c.id) }, [
        document.createTextNode(c.name), el('small', { text: String(n) })
      ]);
      b.addEventListener('click', function () { activeCat = c.id; renderChips(); renderGrid(); });
      chips.appendChild(b);
    });
    chips.hidden = products.length === 0;
  }

  function renderGrid() {
    var grid = $('grid');
    grid.textContent = '';
    var list = products.filter(function (p) { return activeCat === 'all' || p.category === activeCat; });
    $('empty').hidden = products.length > 0;
    list.forEach(function (p) {
      var img = el('img', { src: (p.images && p.images[0]) || '', alt: p.name, loading: 'lazy' });
      var ph = el('div', { class: 'ph' }, [img, p.soldOut ? el('span', { class: 'badge', text: 'Sold out' }) : null]);
      var meta = el('div', { class: 'meta' }, [
        el('span', { class: 'cat', text: catName(p.category) }),
        el('h3', { text: p.name }),
        p.price ? el('span', { class: 'price', text: p.price }) : null
      ]);
      var card = el('button', { class: 'card', type: 'button', 'aria-label': p.name + ', see details' }, [ph, meta]);
      card.addEventListener('click', function () { openDetail(p); });
      grid.appendChild(card);
    });
  }

  function openDetail(p) {
    var imgs = p.images || [];
    var main = $('d-img');
    var thumbs = $('d-thumbs');
    function show(i) {
      main.src = imgs[i] || '';
      main.alt = p.name;
      Array.prototype.forEach.call(thumbs.children, function (t, j) { t.setAttribute('aria-current', String(i === j)); });
    }
    thumbs.textContent = '';
    if (imgs.length > 1) imgs.forEach(function (src, i) {
      var t = el('button', { type: 'button', 'aria-label': 'Photo ' + (i + 1) }, [el('img', { src: src, alt: '' })]);
      t.addEventListener('click', function () { show(i); });
      thumbs.appendChild(t);
    });
    show(0);
    $('d-cat').textContent = catName(p.category);
    $('d-name').textContent = p.name;
    $('d-price').textContent = (p.price || '') + (p.soldOut ? (p.price ? ' · ' : '') + 'Sold out' : '');
    $('d-desc').textContent = p.description || '';
    $('d-ask').href = waLink('Namaste Anibhi Textile, I am interested in "' + p.name + '" (' + catName(p.category) + '). Please share details.');
    var d = $('detail');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  $('detail-close').addEventListener('click', function () { $('detail').close(); });
  $('detail').addEventListener('click', function (e) { if (e.target === this) this.close(); });

  $('enquiry').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var lines = ['Namaste Anibhi Textile,'];
    if (f.name.value.trim()) lines.push('Name: ' + f.name.value.trim());
    if (f.city.value.trim()) lines.push('City: ' + f.city.value.trim());
    lines.push('Buying: ' + f.type.value);
    lines.push('Interested in: ' + f.want.value);
    if (f.msg.value.trim()) lines.push(f.msg.value.trim());
    window.open(waLink(lines.join('\n')), '_blank', 'noopener');
    $('toast').textContent = 'WhatsApp should open with your message ready to send.';
  });

  Promise.all([getJSON('data/site.json'), getJSON('data/products.json').catch(function () { return []; })])
    .then(function (r) {
      site = r[0];
      products = (r[1] || []).filter(function (p) { return !p.hidden; });
      applySite();
      renderChips();
      renderGrid();
    })
    .catch(function (err) { console.error(err); $('empty').hidden = false; });
})();
