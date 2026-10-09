(function () {
  'use strict';

  var CFG = window.ANIBHI_REPO;
  var API = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo;
  var RAW = 'https://raw.githubusercontent.com/' + CFG.owner + '/' + CFG.repo + '/' + CFG.branch + '/';
  var KEY = 'anibhi-admin-token';
  var MAX_SIDE = 1600;

  var token = '';
  var site = null;
  var products = [];
  var editing = null;   // product being edited, or null when adding
  var photos = [];      // [{src, path} | {src, file}] for the open form

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
  function slug(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 40) || 'item';
  }
  function rid() { return Math.random().toString(36).slice(2, 8); }
  function store(get, val) {
    try {
      if (get) return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
      localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
      if (val) ($('remember').checked ? localStorage : sessionStorage).setItem(KEY, val);
    } catch (e) { return ''; }
  }

  function say(msg, kind, where) {
    var s = $(where || 'status');
    s.hidden = !msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
    s.textContent = msg || '';
    if (msg && !where) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ---------- GitHub API ----------
  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 404 && opts.allow404) return null;
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var m = j.message || ('GitHub error ' + r.status);
          if (r.status === 401) m = 'GitHub did not accept this access key. It may have expired; create a new one.';
          if (r.status === 403 || (r.status === 404 && !opts.allow404)) m = 'This access key cannot change ' + CFG.owner + '/' + CFG.repo + '. Check that it has Contents: Read and write on that repository.';
          if (r.status === 409) m = 'Someone else saved at the same moment. Please try again.';
          var e = new Error(m); e.status = r.status; throw e;
        });
      }
      return r.status === 204 ? null : r.json();
    });
  }
  function b64encodeText(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeText(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function readJSON(path) {
    return gh('/contents/' + path + '?ref=' + CFG.branch, { allow404: true }).then(function (f) {
      return f ? { sha: f.sha, data: JSON.parse(b64decodeText(f.content)) } : { sha: null, data: null };
    });
  }
  // Always fetch the latest sha just before writing, so two saves never clobber each other silently.
  function writeJSON(path, data, message) {
    return readJSON(path).then(function (cur) {
      return gh('/contents/' + path, {
        method: 'PUT',
        body: { message: message, content: b64encodeText(JSON.stringify(data, null, 2) + '\n'), branch: CFG.branch, sha: cur.sha || undefined }
      });
    });
  }
  function putBinary(path, b64, message) {
    return gh('/contents/' + path, { method: 'PUT', body: { message: message, content: b64, branch: CFG.branch } });
  }
  function deleteFile(path, message) {
    return gh('/contents/' + path + '?ref=' + CFG.branch, { allow404: true }).then(function (f) {
      if (!f) return null;
      return gh('/contents/' + path, { method: 'DELETE', body: { message: message, sha: f.sha, branch: CFG.branch } });
    });
  }

  // ---------- Images ----------
  function resize(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) return reject(new Error('Could not process ' + file.name));
          var fr = new FileReader();
          fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
          fr.onerror = function () { reject(fr.error); };
          fr.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error(file.name + ' is not a photo this browser can open. Try a JPG or PNG.')); };
      img.src = url;
    });
  }
  // Freshly uploaded photos take a minute to reach the live site, so fall back to GitHub's copy.
  function imgWithFallback(path, alt) {
    var i = el('img', { src: path, alt: alt || '', loading: 'lazy' });
    i.onerror = function () { if (i.src.indexOf(RAW) !== 0) i.src = RAW + path; };
    return i;
  }

  // ---------- Sign in ----------
  function signIn(t) {
    token = t.trim();
    if (!token) return say('Paste your access key first.', 'bad', 'signin-status');
    busy($('signin-btn'), true, 'Signing in…');
    say('', null, 'signin-status');
    gh('').then(function (repo) {
      if (repo.permissions && !repo.permissions.push) throw new Error('This access key can read but not change the site. Give it Contents: Read and write.');
      return Promise.all([readJSON('data/site.json'), readJSON('data/products.json')]);
    }).then(function (r) {
      site = r[0].data || { categories: [] };
      site.categories = site.categories || [];
      products = r[1].data || [];
      store(false, token);
      $('signin').hidden = true;
      $('dash').hidden = false;
      $('signout').hidden = false;
      renderAll();
    }).catch(function (e) {
      token = '';
      say(e.message, 'bad', 'signin-status');
    }).then(function () { busy($('signin-btn'), false); });
  }
  $('signin-btn').addEventListener('click', function () { signIn($('token').value); });
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(this.value); });
  $('signout').addEventListener('click', function () { store(false, ''); location.reload(); });
  $('repo-name').textContent = CFG.repo;

  // ---------- Tabs ----------
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-tab]').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      document.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== b.getAttribute('data-tab'); });
      say('');
    });
  });

  function renderAll() { renderProducts(); renderCats(); fillBusiness(); }
  function catName(id) {
    var c = site.categories.find(function (c) { return c.id === id; });
    return c ? c.name : 'No category';
  }
  var LIVE = ' Your live site updates in about a minute.';

  // ---------- Products ----------
  function renderProducts() {
    var list = $('plist');
    list.textContent = '';
    $('pcount').textContent = '(' + products.length + ')';
    if (!products.length) list.appendChild(el('p', { class: 'muted', text: 'No products yet. Tap "Add product" to upload your first saree.' }));
    products.forEach(function (p, idx) {
      var thumb = p.images && p.images[0] ? imgWithFallback(p.images[0], '') : el('img', { alt: '' });
      var info = [catName(p.category), p.price, p.soldOut ? 'Sold out' : '', p.hidden ? 'Hidden' : ''].filter(Boolean).join(' · ');
      var edit = el('button', { class: 'btn small alt', type: 'button', text: 'Edit' });
      var up = el('button', { class: 'btn small alt', type: 'button', text: '↑', 'aria-label': 'Move up' });
      var del = el('button', { class: 'btn small bad', type: 'button', text: 'Delete' });
      edit.addEventListener('click', function () { openForm(p); });
      up.addEventListener('click', function () { moveUp(idx, up); });
      up.disabled = idx === 0;
      del.addEventListener('click', function () { confirmDelete(p, del); });
      list.appendChild(el('div', { class: 'item' + (p.hidden ? ' hiddenp' : '') }, [
        thumb,
        el('div', { class: 't' }, [el('b', { text: p.name }), el('span', { text: info })]),
        el('div', { class: 'actions' }, [up, edit, del])
      ]));
    });
  }

  function moveUp(idx, btn) {
    var moved = products.slice();
    var x = moved.splice(idx, 1)[0];
    moved.splice(idx - 1, 0, x);
    busy(btn, true, '…');
    writeJSON('data/products.json', moved, 'Reorder products').then(function () {
      products = moved; renderProducts(); say('Order saved.' + LIVE, 'ok');
    }).catch(function (e) { busy(btn, false); say(e.message, 'bad'); });
  }

  // Deleting asks twice in the page itself; browser confirm dialogs are not reliable everywhere.
  function confirmDelete(p, btn) {
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to delete';
      setTimeout(function () { btn.dataset.armed = ''; btn.textContent = 'Delete'; }, 4000);
      return;
    }
    busy(btn, true, 'Deleting…');
    var next = products.filter(function (x) { return x.id !== p.id; });
    writeJSON('data/products.json', next, 'Delete product: ' + p.name).then(function () {
      products = next;
      renderProducts();
      say('Deleted "' + p.name + '".' + LIVE, 'ok');
      return (p.images || []).reduce(function (chain, path) {
        return chain.then(function () { return deleteFile(path, 'Delete photo for ' + p.name).catch(function () {}); });
      }, Promise.resolve());
    }).catch(function (e) { busy(btn, false); say(e.message, 'bad'); });
  }

  function fillCatSelect(selected) {
    var s = $('p-cat');
    s.textContent = '';
    site.categories.forEach(function (c) { s.appendChild(el('option', { value: c.id, text: c.name })); });
    if (selected) s.value = selected;
  }

  function openForm(p) {
    editing = p || null;
    $('pform-title').textContent = p ? 'Edit product' : 'Add product';
    fillCatSelect(p && p.category);
    $('p-name').value = p ? p.name : '';
    $('p-price').value = p ? (p.price || '') : '';
    $('p-desc').value = p ? (p.description || '') : '';
    $('p-sold').checked = !!(p && p.soldOut);
    $('p-hide').checked = !!(p && p.hidden);
    photos = p ? (p.images || []).map(function (path) { return { path: path }; }) : [];
    renderPhotos();
    $('pform').hidden = false;
    say('');
    $('pform').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('p-name').focus({ preventScroll: true });
  }
  function closeForm() { $('pform').hidden = true; editing = null; photos = []; $('p-files').value = ''; }
  $('add-product').addEventListener('click', function () {
    if (!site.categories.length) return say('Add a category first, in the Categories tab.', 'bad');
    openForm(null);
  });
  $('p-cancel').addEventListener('click', closeForm);

  function renderPhotos() {
    var box = $('p-photos');
    box.textContent = '';
    photos.forEach(function (ph, i) {
      var img = ph.file ? el('img', { src: ph.src, alt: '' }) : imgWithFallback(ph.path, '');
      var cover = el('button', { type: 'button', text: 'Cover' });
      var rm = el('button', { type: 'button', text: 'Remove' });
      cover.disabled = i === 0;
      cover.addEventListener('click', function () { photos.unshift(photos.splice(i, 1)[0]); renderPhotos(); });
      rm.addEventListener('click', function () { photos.splice(i, 1); renderPhotos(); });
      box.appendChild(el('div', { class: 'photo' }, [img, i === 0 ? el('span', { class: 'cover', text: 'COVER' }) : null, el('div', { class: 'pa' }, [cover, rm])]));
    });
  }
  function addFiles(files) {
    Array.prototype.forEach.call(files, function (f) {
      if (!/^image\//.test(f.type)) return;
      photos.push({ file: f, src: URL.createObjectURL(f) });
    });
    renderPhotos();
  }
  $('p-files').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });

  $('pform').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('p-name').value.trim();
    if (!name) return say('Give the product a name.', 'bad');
    if (!photos.length) return say('Add at least one photo.', 'bad');
    var btn = $('p-save');
    busy(btn, true, 'Uploading photos…');
    var id = editing ? editing.id : slug(name) + '-' + rid();
    var newCount = photos.filter(function (p) { return p.file; }).length;
    var done = 0;

    // Upload new photos one by one (GitHub rejects parallel writes to the same branch).
    var chain = Promise.resolve();
    var paths = [];
    photos.forEach(function (ph, i) {
      chain = chain.then(function () {
        if (!ph.file) { paths[i] = ph.path; return; }
        btn.textContent = 'Uploading photo ' + (++done) + ' of ' + newCount + '…';
        var path = 'images/' + id + '-' + rid() + '.jpg';
        return resize(ph.file).then(function (b64) {
          return putBinary(path, b64, 'Add photo for ' + name);
        }).then(function () { paths[i] = path; ph.path = path; delete ph.file; });
      });
    });

    chain.then(function () {
      btn.textContent = 'Saving…';
      var item = {
        id: id,
        name: name,
        category: $('p-cat').value,
        price: $('p-price').value.trim(),
        description: $('p-desc').value.trim(),
        images: paths,
        soldOut: $('p-sold').checked,
        hidden: $('p-hide').checked,
        updated: new Date().toISOString().slice(0, 10)
      };
      var removed = editing ? (editing.images || []).filter(function (p) { return paths.indexOf(p) < 0; }) : [];
      var next = editing
        ? products.map(function (p) { return p.id === id ? item : p; })
        : [item].concat(products);
      return writeJSON('data/products.json', next, (editing ? 'Update' : 'Add') + ' product: ' + name).then(function () {
        products = next;
        closeForm();
        renderProducts();
        say('Saved "' + name + '".' + LIVE, 'ok');
        return removed.reduce(function (c, path) {
          return c.then(function () { return deleteFile(path, 'Remove photo from ' + name).catch(function () {}); });
        }, Promise.resolve());
      });
    }).catch(function (err) {
      say(err.message + ' Nothing you entered was lost; tap Save again.', 'bad');
    }).then(function () { busy(btn, false); btn.textContent = 'Save product'; });
  });

  // ---------- Categories ----------
  var draftCats = [];
  function renderCats() {
    draftCats = site.categories.map(function (c) { return { id: c.id, name: c.name }; });
    drawCats();
  }
  function drawCats() {
    var list = $('clist');
    list.textContent = '';
    draftCats.forEach(function (c, i) {
      var used = products.filter(function (p) { return p.category === c.id; }).length;
      var inp = el('input', { type: 'text', value: c.name, 'aria-label': 'Category name' });
      inp.addEventListener('input', function () { c.name = inp.value; });
      var count = el('span', { class: 'muted', text: used + ' product' + (used === 1 ? '' : 's') });
      var del = el('button', { class: 'btn small bad', type: 'button', text: 'Delete' });
      del.disabled = used > 0;
      if (used) del.title = 'Move or delete its products first';
      del.addEventListener('click', function () { draftCats.splice(i, 1); drawCats(); });
      list.appendChild(el('div', { class: 'cat-row' }, [inp, count, del]));
    });
  }
  $('c-add').addEventListener('click', function () {
    var name = $('c-new').value.trim();
    if (!name) return;
    var id = slug(name);
    while (draftCats.some(function (c) { return c.id === id; })) id = slug(name) + '-' + rid();
    draftCats.push({ id: id, name: name });
    $('c-new').value = '';
    drawCats();
  });
  $('c-new').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('c-add').click(); } });
  $('c-save').addEventListener('click', function () {
    var cats = draftCats.filter(function (c) { return c.name.trim(); }).map(function (c) { return { id: c.id, name: c.name.trim() }; });
    saveSite({ categories: cats }, 'Update categories', $('c-save'));
  });

  // ---------- Business details ----------
  function fillBusiness() {
    $('b-tagline').value = site.tagline || '';
    $('b-headline').value = site.headline || '';
    $('b-intro').value = site.intro || '';
    $('b-about').value = site.about || '';
    $('b-wa').value = site.whatsapp ? '+' + site.whatsapp : '';
    $('b-ig').value = site.instagram || '';
    $('b-phones').value = (site.phones || []).join('\n');
    $('b-addr').value = site.address || '';
  }
  $('bform').addEventListener('submit', function (e) {
    e.preventDefault();
    var wa = $('b-wa').value.replace(/\D/g, '');
    if (wa.length === 10) wa = '91' + wa;
    if (wa && wa.length < 11) return say('Enter the WhatsApp number with country code, like +91 91222 12333.', 'bad');
    saveSite({
      tagline: $('b-tagline').value.trim(),
      headline: $('b-headline').value.trim(),
      intro: $('b-intro').value.trim(),
      about: $('b-about').value.trim(),
      whatsapp: wa,
      instagram: $('b-ig').value.trim().replace(/^@/, ''),
      phones: $('b-phones').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      address: $('b-addr').value.trim()
    }, 'Update business details', $('b-save'));
  });

  function saveSite(changes, message, btn) {
    busy(btn, true);
    readJSON('data/site.json').then(function (cur) {
      var next = Object.assign({}, cur.data || site, changes);
      return writeJSON('data/site.json', next, message).then(function () { site = next; });
    }).then(function () {
      renderCats(); fillBusiness();
      say('Saved.' + LIVE, 'ok');
    }).catch(function (e) { say(e.message, 'bad'); })
      .then(function () { busy(btn, false); });
  }

  // Resume a saved session.
  var saved = store(true);
  if (saved) { $('token').value = saved; signIn(saved); }
})();
