import {
  getDefaultStockPage,
  getCadConvertApi,
  resolveCurrentPagePath,
  fetchUnregisteredCads,
  fetchRegisteredAssets,
  registerCadAsset,
  deleteCadAsset,
  buildConvertPreviewUrl,
  type RegisteredAsset,
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
  const { body } = createModalShell('図面の向き設定（CAD）');

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
  const tabNew = mkTab('新規登録');
  const tabDelete = mkTab('登録済み（削除）');

  const selectTab = (which: 'new' | 'delete'): void => {
    for (const t of [tabNew, tabDelete]) {
      t.style.borderBottomColor = 'transparent';
      t.style.color = '#555';
      t.style.fontWeight = 'normal';
    }
    const active = which === 'new' ? tabNew : tabDelete;
    active.style.borderBottomColor = '#0d6efd';
    active.style.color = '#0d6efd';
    active.style.fontWeight = 'bold';
    content.innerHTML = '';
    if (which === 'new') renderNewTab(content);
    else renderDeleteTab(content);
  };

  tabNew.addEventListener('click', () => selectTab('new'));
  tabDelete.addEventListener('click', () => selectTab('delete'));

  tabBar.appendChild(tabNew);
  tabBar.appendChild(tabDelete);
  body.appendChild(tabBar);
  body.appendChild(content);

  selectTab('new');
};

// ------------------------------------------------------------
// 新規登録タブ
// ------------------------------------------------------------
const renderNewTab = (container: HTMLElement): void => {
  const src = getDefaultStockPage();

  const info = document.createElement('div');
  info.textContent = `「${src}」内の未登録 CAD（.dxf / .jww）から選び、向きを指定して別名で登録します。`;
  Object.assign(info.style, { fontSize: '12px', color: '#666', marginBottom: '10px' });
  container.appendChild(info);

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '16px', textAlign: 'center' });
  container.appendChild(loading);

  fetchUnregisteredCads(src)
    .then((files) => {
      loading.remove();
      if (files.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '未登録の CAD ファイルはありません（すべて登録済み、またはページに CAD がありません）。';
        Object.assign(empty.style, { color: '#666', padding: '16px', textAlign: 'center' });
        container.appendChild(empty);
        return;
      }
      const list = document.createElement('div');
      Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
      for (const file of files) {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = file;
        Object.assign(row.style, {
          display: 'block', width: '100%', textAlign: 'left', fontSize: '13px',
          padding: '10px 12px', cursor: 'pointer', border: '1px solid #ddd',
          borderRadius: '6px', background: '#fafafa',
        });
        row.addEventListener('click', () => renderRegisterForm(container, file, src));
        list.appendChild(row);
      }
      container.appendChild(list);
    })
    .catch((e) => {
      loading.remove();
      const err = document.createElement('div');
      err.textContent = `未登録 CAD の取得に失敗しました: ${e.message}`;
      Object.assign(err.style, { color: '#b00020', padding: '16px', textAlign: 'center', fontSize: '13px' });
      container.appendChild(err);
    });
};

// 選んだ CAD の登録フォーム(回転プレビュー + 登録名入力)。
const renderRegisterForm = (container: HTMLElement, file: string, src: string): void => {
  container.innerHTML = '';

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← CAD 一覧に戻る';
  Object.assign(back.style, {
    background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px',
    padding: '6px 10px', cursor: 'pointer', fontSize: '12px', marginBottom: '10px',
  });
  back.addEventListener('click', () => { container.innerHTML = ''; renderNewTab(container); });
  container.appendChild(back);

  const title = document.createElement('div');
  title.textContent = `元 CAD: ${file}`;
  Object.assign(title.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' });
  container.appendChild(title);

  let rotate = 0;
  // 登録名の初期候補(元名 + 回転サフィックス)。ユーザーが編集可能。
  const suggestName = (r: number): string => {
    const dot = file.lastIndexOf('.');
    if (dot <= 0) return r ? `${file}_r${r}` : file;
    const base = file.slice(0, dot);
    const ext = file.slice(dot);
    return r ? `${base}_r${r}${ext}` : `${base}_reg${ext}`;
  };

  // プレビュー画像
  const previewWrap = document.createElement('div');
  Object.assign(previewWrap.style, {
    width: '100%', height: '320px', background: '#eee', borderRadius: '6px',
    display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    marginBottom: '10px',
  });
  const preview = document.createElement('img');
  Object.assign(preview.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
  const previewNote = document.createElement('div');
  previewNote.textContent = '変換プレビューを生成中...';
  Object.assign(previewNote.style, { color: '#888', fontSize: '12px' });
  previewWrap.appendChild(previewNote);
  container.appendChild(previewWrap);

  const updatePreview = (): void => {
    const url = buildConvertPreviewUrl(file, src, rotate);
    if (!url) return;
    previewNote.textContent = '変換プレビューを生成中...';
    if (!previewWrap.contains(previewNote)) previewWrap.appendChild(previewNote);
    if (previewWrap.contains(preview)) previewWrap.removeChild(preview);
    // /convert はJSONで imageUrl を返すので、取得してから img に反映。
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => {
        if (d && d.status === 'ok' && d.imageUrl) {
          preview.src = d.imageUrl;
          if (previewWrap.contains(previewNote)) previewWrap.removeChild(previewNote);
          previewWrap.appendChild(preview);
        } else {
          previewNote.textContent = `プレビュー失敗: ${d?.message || 'unknown'}`;
        }
      })
      .catch((e) => { previewNote.textContent = `プレビュー失敗: ${e.message}`; });
  };

  // 回転ボタン
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
  registerBtn.textContent = 'この向きで登録';
  Object.assign(registerBtn.style, {
    width: '100%', background: '#0d6efd', color: '#fff', border: 'none',
    borderRadius: '4px', padding: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
  });
  registerBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('登録名を入力してください', true); return; }
    registerBtn.disabled = true;
    registerBtn.textContent = '登録中...';
    registerCadAsset({ name, file, src, rotate })
      .then((r) => {
        showToast(`登録しました: ${r.name}（記法で file="${r.name}" と指定）`);
        container.innerHTML = '';
        renderNewTab(container);
      })
      .catch((e) => {
        showToast(`登録に失敗しました: ${e.message}`, true);
        registerBtn.disabled = false;
        registerBtn.textContent = 'この向きで登録';
      });
  });
  container.appendChild(registerBtn);

  refreshRot();
  updatePreview();
};

// ------------------------------------------------------------
// 削除タブ
// ------------------------------------------------------------
const renderDeleteTab = (container: HTMLElement): void => {
  const src = getDefaultStockPage();

  const info = document.createElement('div');
  info.textContent = '登録済みの図面です。削除すると記法からの参照ができなくなります（向きの変更はできないため、変えたい場合は新規登録で別名登録してください）。';
  Object.assign(info.style, { fontSize: '12px', color: '#666', marginBottom: '10px' });
  container.appendChild(info);

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '16px', textAlign: 'center' });
  container.appendChild(loading);

  fetchRegisteredAssets(src)
    .then((assets) => {
      loading.remove();
      if (assets.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '登録済みの図面はありません。';
        Object.assign(empty.style, { color: '#666', padding: '16px', textAlign: 'center' });
        container.appendChild(empty);
        return;
      }
      const grid = document.createElement('div');
      Object.assign(grid.style, {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px',
      });
      for (const asset of assets) {
        grid.appendChild(buildAssetCard(asset, container));
      }
      container.appendChild(grid);
    })
    .catch((e) => {
      loading.remove();
      const err = document.createElement('div');
      err.textContent = `登録一覧の取得に失敗しました: ${e.message}`;
      Object.assign(err.style, { color: '#b00020', padding: '16px', textAlign: 'center', fontSize: '13px' });
      container.appendChild(err);
    });
};

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
  meta.textContent = `元: ${asset.srcFile} / 回転 ${asset.rotate}°`;
  Object.assign(meta.style, { fontSize: '11px', color: '#888' });

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = '削除';
  Object.assign(del.style, {
    background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px',
    padding: '6px', cursor: 'pointer', fontSize: '12px',
  });
  del.addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`「${asset.name}」を削除しますか？`)) return;
    del.disabled = true;
    del.textContent = '削除中...';
    deleteCadAsset(asset.name)
      .then(() => {
        showToast(`削除しました: ${asset.name}`);
        container.innerHTML = '';
        renderDeleteTab(container);
      })
      .catch((e) => {
        showToast(`削除に失敗しました: ${e.message}`, true);
        del.disabled = false;
        del.textContent = '削除';
      });
  });

  cell.appendChild(thumb);
  cell.appendChild(name);
  cell.appendChild(meta);
  cell.appendChild(del);
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
  fab.textContent = '🧭 図面の向き設定';
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
