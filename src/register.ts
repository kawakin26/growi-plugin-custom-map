import {
  getDefaultStockPage,
  getCadConvertApi,
  resolveCurrentPagePath,
  fetchSourceFiles,
  fetchRegisteredAssets,
  registerAsset,
  buildConvertPreviewUrl,
  normalizeForSearch,
  attachmentUrl,
  getAttachmentsForPage,
  attachmentName,
  type RegisteredAsset,
  type SourceFileEntry,
} from './common';

// ============================================================
// 図面登録(register)機能: ストックページ(既定 /media-library)上に
// フローティングボタンを出し、MAP 編集者が CAD 図面を「向きを確定して別名で
// 登録」できるようにする(方式Q)。登録済みの向きは焼き込み済み SVG として
// API に保存され、記法から登録名で参照できる。
//
// この機能はストックページでのみ表示する(MAP 編集者の作業ページ想定)。
// 回転角の変更はできず、変えたい場合は別名で再登録する。編集タブは削除のみ。
//
// CAD 変換 API(cadConvertApi)が未設定の場合は、そもそも登録できないため
// ボタンを出さない。
// ============================================================

const BTN_ID = 'growi-custom-map-register-fab';
const MODAL_ID = 'growi-custom-map-register-modal';

const ROTATE_OPTIONS = [0, 90, 180, 270];

// パス末尾スラッシュの有無を吸収して比較する。
const normPath = (p: string): string => p.replace(/\/+$/, '') || '/';

// 現在ページがストックページかどうかの判定結果(非同期解決した値のキャッシュ)。
// resolveCurrentPagePath は API 解決を含むため、解決できるまでは null。
let onStockCache: { forUrl: string; value: boolean } | null = null;
let resolving = false;

// 非同期でストックページ判定を更新し、変化があれば onUpdate を呼ぶ。
const refreshStockJudgement = (onUpdate: () => void): void => {
  if (typeof location === 'undefined') return;
  const url = location.pathname;
  if (onStockCache && onStockCache.forUrl === url) return; // 解決済み
  if (resolving) return;
  resolving = true;
  resolveCurrentPagePath()
    .then((path) => {
      const stock = getDefaultStockPage();
      const value = !!path && normPath(path) === normPath(stock);
      onStockCache = { forUrl: url, value };
      onUpdate();
    })
    .catch((e) => {
      console.warn('[custom-map-register] failed to resolve current page path', e);
      onStockCache = { forUrl: url, value: false };
    })
    .finally(() => { resolving = false; });
};

// 直近の判定結果(未解決なら false)。
const isOnStockPageCached = (): boolean => {
  if (typeof location === 'undefined') return false;
  if (onStockCache && onStockCache.forUrl === location.pathname) return onStockCache.value;
  return false;
};

// ------------------------------------------------------------
// トースト
// ------------------------------------------------------------
const showToast = (message: string, isError = false): void => {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
    background: isError ? 'rgba(176,0,32,0.92)' : 'rgba(0,0,0,0.85)', color: '#fff',
    padding: '10px 16px', borderRadius: '6px', fontSize: '13px', zIndex: '100001',
    maxWidth: '80vw', textAlign: 'center', pointerEvents: 'none',
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
};

// ------------------------------------------------------------
// モーダルの外枠
// ------------------------------------------------------------
const createModalShell = (
  title: string,
): { overlay: HTMLElement; body: HTMLElement; setBodyPadding: (v: string) => void } => {
  const old = document.getElementById(MODAL_ID);
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: '100000',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative', backgroundColor: '#fff', borderRadius: '8px',
    width: 'min(92vw, 900px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)', overflow: 'hidden',
  });
  card.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #e5e5e5', flex: '0 0 auto',
  });
  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, { fontWeight: 'bold', fontSize: '15px' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer',
    lineHeight: '1', color: '#666',
  });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  Object.assign(body.style, { padding: '16px', overflow: 'auto', flex: '1 1 auto' });

  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  return {
    overlay,
    body,
    setBodyPadding: (v: string) => { body.style.padding = v; },
  };
};

// ------------------------------------------------------------
// タブUI
// ------------------------------------------------------------
const openRegisterModal = (): void => {
  const { body } = createModalShell('地図アセットの登録（CAD・画像）');

  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex', gap: '8px', borderBottom: '1px solid #e5e5e5', marginBottom: '12px',
  });
  const content = document.createElement('div');

  const mkTab = (label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      background: 'none', border: 'none', borderBottom: '2px solid transparent',
      padding: '8px 12px', cursor: 'pointer', fontSize: '14px', color: '#555',
    });
    return b;
  };
  const tabNew = mkTab('図面を登録');
  const tabList = mkTab('登録済み一覧');

  const selectTab = (which: 'new' | 'list'): void => {
    for (const t of [tabNew, tabList]) {
      t.style.borderBottomColor = 'transparent';
      t.style.color = '#555';
      t.style.fontWeight = 'normal';
    }
    const active = which === 'new' ? tabNew : tabList;
    active.style.borderBottomColor = '#0d6efd';
    active.style.color = '#0d6efd';
    active.style.fontWeight = 'bold';
    content.innerHTML = '';
    if (which === 'new') renderNewTab(content);
    else renderListTab(content);
  };

  tabNew.addEventListener('click', () => selectTab('new'));
  tabList.addEventListener('click', () => selectTab('list'));

  tabBar.appendChild(tabNew);
  tabBar.appendChild(tabList);
  body.appendChild(tabBar);
  body.appendChild(content);

  selectTab('new');
};

// タブ1(図面を登録)の要素から、指定の元ファイルで登録フォームを開く。
// タブ2の「再登録」から呼ぶために、モジュールスコープに保持する。
let openRegisterFormWith: ((file: string, type?: 'cad' | 'image') => void) | null = null;

// ------------------------------------------------------------
// 新規登録タブ
// ------------------------------------------------------------
const renderNewTab = (container: HTMLElement): void => {
  const src = getDefaultStockPage();

  // タブ2の再登録から呼べるよう、登録フォームを開く関数を公開する。
  openRegisterFormWith = (file: string, type?: 'cad' | 'image') => renderRegisterForm(container, file, src, type);

  const info = document.createElement('div');
  info.innerHTML = `「${src}」内の CAD（.dxf / .jww）・画像（.png / .jpg 等）から選び、<b>別名で登録</b>します。`
    + '<br>CAD は向き（回転）を指定して焼き込み、画像は原本のまま保存します（画像の向きは事前に補正してください）。'
    + '<br>同じファイルを別名で何個でも登録でき、登録済みには <span style="color:#20a37a;font-weight:bold;">済</span> を表示します。';
  Object.assign(info.style, { fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: '1.6' });
  container.appendChild(info);

  // 検索ボックス
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'ファイル名で絞り込み...';
  Object.assign(search.style, {
    width: '100%', padding: '6px 8px', boxSizing: 'border-box', fontSize: '13px',
    marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px',
  });
  container.appendChild(search);

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '16px', textAlign: 'center' });
  container.appendChild(loading);

  const listWrap = document.createElement('div');
  Object.assign(listWrap.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
  container.appendChild(listWrap);

  fetchSourceFiles(src)
    .then((files) => {
      loading.remove();
      if (files.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = `「${src}」に登録できる CAD・画像が見つかりませんでした。`;
        Object.assign(empty.style, { color: '#666', padding: '16px', textAlign: 'center' });
        container.appendChild(empty);
        return;
      }

      const renderList = (filter: string): void => {
        listWrap.innerHTML = '';
        const kw = normalizeForSearch(filter.trim());
        const shown = files.filter((f) => !kw || normalizeForSearch(f.name).includes(kw));
        if (shown.length === 0) {
          const none = document.createElement('div');
          none.textContent = '該当するファイルがありません。';
          Object.assign(none.style, { color: '#888', padding: '12px', textAlign: 'center', fontSize: '12px' });
          listWrap.appendChild(none);
          return;
        }
        for (const f of shown) {
          listWrap.appendChild(buildCadRow(f, src, container));
        }
      };

      renderList('');
      search.addEventListener('input', () => renderList(search.value));
    })
    .catch((e) => {
      loading.remove();
      const err = document.createElement('div');
      err.textContent = `CAD 一覧の取得に失敗しました: ${e.message}`;
      Object.assign(err.style, { color: '#b00020', padding: '16px', textAlign: 'center', fontSize: '13px' });
      container.appendChild(err);
    });
};

// 登録候補一覧の1行(種別バッジ・登録状態で色分け・「済」バッジ)。
const buildCadRow = (f: SourceFileEntry, src: string, container: HTMLElement): HTMLElement => {
  const row = document.createElement('button');
  row.type = 'button';
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left',
    fontSize: '13px', padding: '10px 12px', cursor: 'pointer', borderRadius: '6px',
    // 登録済みは緑系、未登録はグレー系で色分け。
    border: f.registered ? '1px solid #7fceb3' : '1px solid #ddd',
    background: f.registered ? '#eef9f3' : '#fafafa',
  });

  // 種別バッジ(CAD / 画像)
  const typeBadge = document.createElement('span');
  const isCad = f.type === 'cad';
  typeBadge.textContent = isCad ? 'CAD' : '画像';
  Object.assign(typeBadge.style, {
    flex: '0 0 auto', fontSize: '10px', fontWeight: 'bold', color: '#fff',
    background: isCad ? '#5566cc' : '#c07820', borderRadius: '4px', padding: '2px 6px',
  });
  row.appendChild(typeBadge);

  const nameEl = document.createElement('span');
  nameEl.textContent = f.name;
  Object.assign(nameEl.style, { flex: '1 1 auto', wordBreak: 'break-all' });
  row.appendChild(nameEl);

  if (f.registered) {
    const badge = document.createElement('span');
    badge.textContent = `済 (${f.registeredAs.length})`;
    Object.assign(badge.style, {
      flex: '0 0 auto', fontSize: '11px', fontWeight: 'bold', color: '#fff',
      background: '#20a37a', borderRadius: '10px', padding: '2px 8px',
    });
    badge.title = `登録名: ${f.registeredAs.join(', ')}`;
    row.appendChild(badge);
  }

  row.addEventListener('click', () => renderRegisterForm(container, f.name, src, f.type));
  return row;
};

// 選んだファイルの登録フォーム。CAD は回転プレビュー＋回転指定、画像は
// 原本プレビュー＋回転なし。type 省略時は拡張子から判定する。
const CAD_EXT = ['.dxf', '.jww'];
const guessType = (file: string): 'cad' | 'image' => (
  CAD_EXT.some((e) => file.toLowerCase().endsWith(e)) ? 'cad' : 'image'
);

const renderRegisterForm = (
  container: HTMLElement,
  file: string,
  src: string,
  type: 'cad' | 'image' = guessType(file),
): void => {
  container.innerHTML = '';
  const isCad = type === 'cad';

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← 一覧に戻る';
  Object.assign(back.style, {
    background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px',
    padding: '6px 10px', cursor: 'pointer', fontSize: '12px', marginBottom: '10px',
  });
  back.addEventListener('click', () => { container.innerHTML = ''; renderNewTab(container); });
  container.appendChild(back);

  const title = document.createElement('div');
  title.textContent = `${isCad ? '元 CAD' : '元画像'}: ${file}`;
  Object.assign(title.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' });
  container.appendChild(title);

  // この元ファイルの既存登録があれば注記する(再登録時の重複認識ミス防止)。
  const existingNote = document.createElement('div');
  Object.assign(existingNote.style, {
    fontSize: '12px', color: '#20a37a', marginBottom: '8px', display: 'none',
  });
  container.appendChild(existingNote);
  fetchRegisteredAssets(src)
    .then((assets) => {
      const same = assets.filter((a) => a.srcFile === file);
      if (same.length > 0) {
        existingNote.style.display = 'block';
        existingNote.textContent = `このファイルは既に ${same.length} 件登録済みです（${
          same.map((a) => (isCad ? `${a.name}:${a.rotate}°` : a.name)).join(', ')
        }）。別名で追加登録できます。`;
      }
    })
    .catch(() => { /* 注記は任意なので失敗は無視 */ });

  let rotate = 0;
  // 登録名の初期候補。ユーザーが編集可能。
  const suggestName = (r: number): string => {
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    if (isCad) return r ? `${base}_r${r}${ext}` : `${base}_reg${ext}`;
    return `${base}_reg${ext}`;
  };

  // プレビュー
  const previewWrap = document.createElement('div');
  Object.assign(previewWrap.style, {
    width: '100%', height: '320px', background: '#eee', borderRadius: '6px',
    display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    marginBottom: '10px',
  });
  const preview = document.createElement('img');
  Object.assign(preview.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
  const previewNote = document.createElement('div');
  previewNote.textContent = 'プレビューを生成中...';
  Object.assign(previewNote.style, { color: '#888', fontSize: '12px' });
  previewWrap.appendChild(previewNote);
  container.appendChild(previewWrap);

  const showPreviewImg = (url: string): void => {
    preview.src = url;
    if (previewWrap.contains(previewNote)) previewWrap.removeChild(previewNote);
    if (!previewWrap.contains(preview)) previewWrap.appendChild(preview);
  };

  const updatePreview = (): void => {
    if (isCad) {
      // CAD は API 変換結果(JSON の imageUrl)を表示。回転ごとに再取得。
      const url = buildConvertPreviewUrl(file, src, rotate);
      if (!url) return;
      previewNote.textContent = '変換プレビューを生成中...';
      if (!previewWrap.contains(previewNote)) previewWrap.appendChild(previewNote);
      if (previewWrap.contains(preview)) previewWrap.removeChild(preview);
      fetch(url, { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .then((d) => {
          if (d && d.status === 'ok' && d.imageUrl) showPreviewImg(d.imageUrl);
          else previewNote.textContent = `プレビュー失敗: ${d?.message || 'unknown'}`;
        })
        .catch((e) => { previewNote.textContent = `プレビュー失敗: ${e.message}`; });
    } else {
      // 画像は GROWI 添付の原本を直接プレビュー(登録前なので添付から解決)。
      getAttachmentsForPage(src)
        .then((atts) => {
          const hit = atts.find((a) => attachmentName(a) === file);
          if (hit) showPreviewImg(attachmentUrl(hit));
          else previewNote.textContent = 'プレビュー画像が見つかりませんでした';
        })
        .catch((e) => { previewNote.textContent = `プレビュー取得失敗: ${e.message}`; });
    }
  };

  // 回転ボタン(CAD のみ)
  if (isCad) {
    const rotLabel = document.createElement('div');
    rotLabel.textContent = '回転（登録時に焼き込む向き）';
    Object.assign(rotLabel.style, { fontSize: '12px', color: '#333', marginBottom: '4px' });
    container.appendChild(rotLabel);

    const rotRow = document.createElement('div');
    Object.assign(rotRow.style, { display: 'flex', gap: '6px', marginBottom: '12px' });
    const rotBtns: { deg: number; el: HTMLButtonElement }[] = [];
    const refreshRot = (): void => {
      for (const b of rotBtns) {
        const sel = b.deg === rotate;
        Object.assign(b.el.style, {
          background: sel ? '#0d6efd' : '#fff', color: sel ? '#fff' : '#333',
          borderColor: sel ? '#0d6efd' : '#ccc',
        });
      }
    };
    for (const deg of ROTATE_OPTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${deg}°`;
      Object.assign(b.style, {
        flex: '1 1 0', padding: '6px 0', fontSize: '13px', cursor: 'pointer',
        border: '1px solid #ccc', borderRadius: '4px', background: '#fff',
      });
      b.addEventListener('click', () => {
        rotate = deg;
        refreshRot();
        nameInput.value = suggestName(deg);
        updatePreview();
      });
      rotRow.appendChild(b);
      rotBtns.push({ deg, el: b });
    }
    container.appendChild(rotRow);
    refreshRot();
  } else {
    // 画像は回転なし。向きの注意書きのみ。
    const imgNote = document.createElement('div');
    imgNote.textContent = '画像は回転せず原本のまま登録します（向きは画像編集ソフトで事前に補正してください）。';
    Object.assign(imgNote.style, { fontSize: '12px', color: '#666', marginBottom: '12px' });
    container.appendChild(imgNote);
  }

  // 登録名入力
  const nameLabel = document.createElement('div');
  nameLabel.textContent = '登録名（記法の file に指定する名前。既存と重複不可）';
  Object.assign(nameLabel.style, { fontSize: '12px', color: '#333', marginBottom: '4px' });
  container.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = suggestName(0);
  Object.assign(nameInput.style, {
    width: '100%', padding: '6px 8px', boxSizing: 'border-box', fontSize: '13px',
    marginBottom: '12px', fontFamily: 'monospace',
  });
  container.appendChild(nameInput);

  // 登録ボタン
  const registerBtn = document.createElement('button');
  registerBtn.type = 'button';
  registerBtn.textContent = isCad ? 'この向きで登録' : 'この画像を登録';
  Object.assign(registerBtn.style, {
    width: '100%', background: '#0d6efd', color: '#fff', border: 'none',
    borderRadius: '4px', padding: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
  });
  registerBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('登録名を入力してください', true); return; }
    registerBtn.disabled = true;
    registerBtn.textContent = '登録中...';
    registerAsset({ name, file, src, rotate: isCad ? rotate : 0 })
      .then((r) => {
        showToast(`登録しました: ${r.name}（記法で file="${r.name}" と指定）`);
        container.innerHTML = '';
        renderNewTab(container);
      })
      .catch((e) => {
        showToast(`登録に失敗しました: ${e.message}`, true);
        registerBtn.disabled = false;
        registerBtn.textContent = isCad ? 'この向きで登録' : 'この画像を登録';
      });
  });
  container.appendChild(registerBtn);

  updatePreview();
};

// ------------------------------------------------------------
// 登録済み一覧タブ(閲覧のみ・削除なし)
// ------------------------------------------------------------
const renderListTab = (container: HTMLElement): void => {
  const src = getDefaultStockPage();

  const info = document.createElement('div');
  info.innerHTML = '登録済みの図面です（記法の <code>file</code> に登録名を指定して使います）。'
    + '<br>向きを変えたい / CAD を修正したときは、各図面の<b>「別角度で再登録」</b>から別名で追加登録してください。';
  Object.assign(info.style, { fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: '1.6' });
  container.appendChild(info);

  // 検索ボックス(登録名・元CAD名で絞り込み)
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '登録名・元ファイル名で絞り込み...';
  Object.assign(search.style, {
    width: '100%', padding: '6px 8px', boxSizing: 'border-box', fontSize: '13px',
    marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px',
  });
  container.appendChild(search);

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '16px', textAlign: 'center' });
  container.appendChild(loading);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px',
  });
  container.appendChild(grid);

  fetchRegisteredAssets(src)
    .then((assets) => {
      loading.remove();
      if (assets.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '登録済みの図面はありません。「図面を登録」タブから登録できます。';
        Object.assign(empty.style, { color: '#666', padding: '16px', textAlign: 'center' });
        container.appendChild(empty);
        return;
      }
      const render = (filter: string): void => {
        grid.innerHTML = '';
        const kw = normalizeForSearch(filter.trim());
        const shown = assets.filter((a) => !kw
          || normalizeForSearch(a.name).includes(kw)
          || normalizeForSearch(a.srcFile || '').includes(kw));
        if (shown.length === 0) {
          const none = document.createElement('div');
          none.textContent = '該当する登録がありません。';
          Object.assign(none.style, { color: '#888', padding: '12px', gridColumn: '1 / -1', textAlign: 'center', fontSize: '12px' });
          grid.appendChild(none);
          return;
        }
        for (const asset of shown) grid.appendChild(buildAssetCard(asset, container));
      };
      render('');
      search.addEventListener('input', () => render(search.value));
    })
    .catch((e) => {
      loading.remove();
      const err = document.createElement('div');
      err.textContent = `登録一覧の取得に失敗しました: ${e.message}`;
      Object.assign(err.style, { color: '#b00020', padding: '16px', textAlign: 'center', fontSize: '13px' });
      container.appendChild(err);
    });
};

// 登録済みカード(閲覧＋再登録。削除は UI から廃止)。
const buildAssetCard = (asset: RegisteredAsset, container: HTMLElement): HTMLElement => {
  const cell = document.createElement('div');
  Object.assign(cell.style, {
    display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #ddd',
    borderRadius: '6px', padding: '8px', background: '#fafafa',
  });

  const thumb = document.createElement('img');
  thumb.src = asset.imageUrl;
  thumb.alt = asset.name;
  thumb.loading = 'lazy';
  Object.assign(thumb.style, {
    width: '100%', height: '110px', objectFit: 'contain', background: '#fff',
  });

  const name = document.createElement('div');
  name.textContent = asset.name;
  Object.assign(name.style, {
    fontSize: '12px', color: '#333', wordBreak: 'break-all', fontFamily: 'monospace',
    lineHeight: '1.3',
  });

  const meta = document.createElement('div');
  const isImage = asset.type === 'image';
  meta.textContent = isImage
    ? `画像 / 元: ${asset.srcFile}`
    : `CAD / 元: ${asset.srcFile} / 回転 ${asset.rotate}°`;
  Object.assign(meta.style, { fontSize: '11px', color: '#888' });

  // 再登録: この元ファイルを「図面を登録」タブの登録フォームに引き継いで開く。
  const reReg = document.createElement('button');
  reReg.type = 'button';
  reReg.textContent = isImage ? '別名で再登録' : '別角度で再登録';
  Object.assign(reReg.style, {
    background: '#eef4ff', color: '#0d6efd', border: '1px solid #b6d0ff', borderRadius: '4px',
    padding: '6px', cursor: 'pointer', fontSize: '12px',
  });
  reReg.addEventListener('click', () => {
    if (!asset.srcFile) {
      showToast('この登録には元 CAD 情報がないため再登録できません', true);
      return;
    }
    // 「図面を登録」タブへ切り替えて、そのフォームを開く。
    // openRegisterFormWith は renderNewTab が公開する。まずタブを描画してから呼ぶ。
    const t = asset.type === 'image' ? 'image' : 'cad';
    container.innerHTML = '';
    renderNewTab(container);
    if (openRegisterFormWith) openRegisterFormWith(asset.srcFile, t);
  });

  cell.appendChild(thumb);
  cell.appendChild(name);
  cell.appendChild(meta);
  cell.appendChild(reReg);
  return cell;
};

// ------------------------------------------------------------
// フローティングボタン
// ------------------------------------------------------------
const ensureFab = (): void => {
  // CAD 変換 API が無ければ登録できないのでボタンを出さない。
  const apiConfigured = !!getCadConvertApi();
  const existing = document.getElementById(BTN_ID);

  if (!apiConfigured) {
    if (existing) existing.remove();
    return;
  }

  // 現在ページのパス解決は非同期(ID ベース URL 環境では API 解決が必要)。
  // 未解決なら解決を促し、解決後の再評価で FAB を出す。
  refreshStockJudgement(() => ensureFab());
  const onStock = isOnStockPageCached();

  if (!onStock) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const fab = document.createElement('button');
  fab.id = BTN_ID;
  fab.type = 'button';
  fab.textContent = '🗺 地図アセットの登録';
  Object.assign(fab.style, {
    position: 'fixed', right: '24px', bottom: '76px', zIndex: '99999',
    background: '#20a37a', color: '#fff', border: 'none', borderRadius: '24px',
    padding: '12px 18px', fontSize: '14px', fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)', cursor: 'pointer',
  });
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      openRegisterModal();
    } catch (err) {
      console.error('[custom-map-register] failed to open modal', err);
    }
  });
  document.body.appendChild(fab);
};

// ------------------------------------------------------------
// activate / deactivate
// ------------------------------------------------------------
let observer: MutationObserver | undefined;
let intervalId: number | undefined;
let onHashChange: (() => void) | undefined;

export const activateRegister = (): void => {
  onHashChange = () => ensureFab();
  window.addEventListener('hashchange', onHashChange);
  try {
    observer = new MutationObserver(() => ensureFab());
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.warn('[custom-map-register] MutationObserver 未対応', e);
  }
  intervalId = window.setInterval(ensureFab, 1500);
  ensureFab();
  console.log('[custom-map-register] activated');
};

export const deactivateRegister = (): void => {
  if (onHashChange) { window.removeEventListener('hashchange', onHashChange); onHashChange = undefined; }
  if (observer) { observer.disconnect(); observer = undefined; }
  if (intervalId) { window.clearInterval(intervalId); intervalId = undefined; }
  const existing = document.getElementById(BTN_ID);
  if (existing) existing.remove();
};
