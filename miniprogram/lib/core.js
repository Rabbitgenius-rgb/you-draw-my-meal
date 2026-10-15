(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.MealArt = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'draw-my-meal-v1';
  const PAPER = '#fffcf5';
  const COLORS = ['#342a25', '#d94335', '#f2b630', '#64836a', '#648ca5', '#9b7399'];
  const LEGACY_STORES = [
    { id: 'demo-anfu', name: '安福路示例店', area: '上海 · 徐汇区', note: '演示门店，非实时数据' },
    { id: 'demo-riverside', name: '滨江示例店', area: '上海 · 浦东新区', note: '演示门店，非实时数据' }
  ];
  const LEGACY_MEALS = [
    { id: 'burger', name: '板烧鸡腿堡', alias: ['汉堡', '鸡腿堡', '板烧', '板烧鸡腿堡'], tag: '今天的主角', image: 'burger.png', stores: ['demo-anfu', 'demo-riverside'] },
    { id: 'fries', name: '薯条', alias: ['薯条', '炸薯条', '中薯', '大薯', '小薯'], tag: '快乐一小把', image: 'fries.png', stores: ['demo-anfu', 'demo-riverside'] },
    { id: 'cola', name: '可口可乐', alias: ['可乐', '可口可乐', '饮料', '快乐水'], tag: '来点气泡', image: 'cola.png', stores: ['demo-anfu', 'demo-riverside'] },
    { id: 'nuggets', name: '麦乐鸡', alias: ['麦乐鸡', '鸡块', '炸鸡块', '麦乐鸡块'], tag: '蘸一下更好吃', image: 'nuggets.png', stores: ['demo-anfu'] }
  ];
  let catalog = { stores:[], menus:{} };
  const meal = id => Object.values(catalog.menus).flat().find(m => m.id === id);
  const store = id => catalog.stores.find(s => s.id === id);
  const menu = storeId => catalog.menus[storeId] || [];
  function setCatalog(value) { catalog = value && Array.isArray(value.stores) && value.menus && typeof value.menus === 'object' ? value : {stores:[],menus:{}}; }
  function initialState() { return { version:2, storeId:'', mode:'solo', artworks:[], catalog:{stores:[],menus:{}} }; }
  function withMenu(state, selectedStore, meals) {
    const previous = state.catalog || initialState().catalog;
    return Object.assign({},state,{version:2,storeId:selectedStore.id,catalog:{
      stores:previous.stores.filter(s=>s.id!==selectedStore.id).concat([selectedStore]),
      menus:Object.assign({},previous.menus,{[selectedStore.id]:meals})
    }});
  }
  function artStore(art) { return art.storeSnapshot || store(art.storeId) || {id:art.storeId,name:'历史门店'}; }
  function artMeal(art) { return art.mealSnapshot || meal(art.mealId) || {id:art.mealId,name:'历史餐品',alias:[]}; }
  function imageUrl(m) { return m && /^https:\/\//.test(m.image || '') ? m.image : m && /^(burger|fries|cola|nuggets)\.png$/.test(m.image || '') ? '/assets/'+m.image : ''; }
  function readState(adapter) {
    try {
      const raw = adapter.getItem(STORAGE_KEY);
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!value || ![1,2].includes(value.version) || !Array.isArray(value.artworks)) {setCatalog(null);return initialState();}
      setCatalog(value.version===2 ? value.catalog : null);
      return { version:2, catalog, storeId:store(value.storeId) ? value.storeId : '',
        mode: value.mode === 'duo' ? 'duo' : 'solo',
        artworks:value.artworks.filter(a=>a && typeof a.id==='string' && typeof a.storeId==='string' && typeof a.mealId==='string' && Array.isArray(a.strokes))
          .map(a=>Object.assign({},a,{isPublic:a.isPublic===true,
            storeSnapshot:a.storeSnapshot || store(a.storeId) || Object.assign({source:'demo'},LEGACY_STORES.find(s=>s.id===a.storeId) || {id:a.storeId,name:'历史门店'}),
            mealSnapshot:a.mealSnapshot || meal(a.mealId) || Object.assign({source:'demo'},LEGACY_MEALS.find(m=>m.id===a.mealId) || {id:a.mealId,name:'历史餐品',alias:[]})})) };
    } catch (_) {setCatalog(null);return initialState();}
  }
  function persist(adapter, state) { adapter.setItem(STORAGE_KEY, JSON.stringify(state));setCatalog(state.catalog); }
  function makeArtwork(options) {
    if (!meal(options.mealId) || !store(options.storeId) || !menu(options.storeId).some(m => m.id === options.mealId)) throw new Error('请选择当前门店的餐品');
    const isImage = options.kind === 'image';
    if (isImage && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(options.imageSource || '')) throw new Error('请选择有效的 PNG 或 JPG 图片');
    if (!isImage && (!Array.isArray(options.strokes) || !options.strokes.some(s => !s.erase && s.points && s.points.length))) throw new Error('先在画布上留下一笔吧');
    return {
      id: options.id || 'art-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      storeId: options.storeId, mealId: options.mealId, mode: options.mode === 'duo' ? 'duo' : 'solo',
      storeSnapshot:JSON.parse(JSON.stringify(options.storeSnapshot || store(options.storeId))),
      mealSnapshot:JSON.parse(JSON.stringify(options.mealSnapshot || meal(options.mealId))),
      title: (String(options.title || '').trim() || '今天的' + meal(options.mealId).name).slice(0, 30),
      createdAt: options.createdAt || new Date().toISOString(),
      strokes: isImage ? [] : JSON.parse(JSON.stringify(options.strokes)), thumbnail: isImage ? '' : options.thumbnail || '',
      ...(isImage ? {kind:'image',imageSource:options.imageSource,titleEmbedded:options.titleEmbedded === true} : {}),
      isPublic: false, consentAt: null
    };
  }
  function setPublic(artworks, id, allow, now) {
    return artworks.map(a => a.id === id ? Object.assign({}, a, { isPublic: allow === true, consentAt: allow === true ? (now || new Date().toISOString()) : null }) : a);
  }
  function eligible(artworks, storeId, mealId) {
    if (!menu(storeId).some(m => m.id === mealId)) return [];
    return artworks.filter(a => a.isPublic === true && !!a.consentAt && a.storeId === storeId && a.mealId === mealId);
  }
  function pickArtwork(artworks, storeId, mealId, previousId, random) {
    const all = eligible(artworks, storeId, mealId);
    const choices = all.length > 1 ? all.filter(a => a.id !== previousId) : all;
    return choices.length ? choices[Math.min(choices.length - 1, Math.floor((random || Math.random)() * choices.length))] : null;
  }
  function galleryArtworks(artworks, storeId, mealId, order, random) {
    const items = eligible(artworks, storeId, mealId).slice();
    if (order === 'random') {
      const rng = random || Math.random;
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.max(0, Math.min(i, Math.floor(rng() * (i + 1))));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    }
    return items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
  }
  function isCorrect(text, mealId, snapshot) {
    const m = snapshot || meal(mealId);
    const normalize = s => String(s).trim().replace(/[\s，。！!？?、]/g, '').toLowerCase();
    return !!m && [m.name].concat(m.alias || []).some(alias => normalize(alias) === normalize(text));
  }
  function dateLabel(value) {
    const date = new Date(value);
    return (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }
  function drawStrokes(ctx, strokes, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    strokes.forEach(stroke => {
      if (!stroke.points || !stroke.points.length) return;
      ctx.strokeStyle = stroke.erase ? PAPER : stroke.color;
      ctx.fillStyle = stroke.erase ? PAPER : stroke.color;
      ctx.lineWidth = stroke.width * width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const points = stroke.points;
      if (points.length === 1) {
        ctx.beginPath(); ctx.arc(points[0].x * width, points[0].y * height, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(points[0].x * width, points[0].y * height);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * width, points[i].y * height);
        ctx.stroke();
      }
    });
  }
  return { STORAGE_KEY, PAPER, COLORS, meal, store, menu, setCatalog, withMenu, artStore, artMeal, imageUrl, initialState, readState, persist, makeArtwork, setPublic, eligible, pickArtwork, galleryArtworks, isCorrect, dateLabel, drawStrokes };
});
