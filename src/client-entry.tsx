import { visit } from 'unist-util-visit';
import remarkDirective from 'remark-directive';

declare const growiFacade: any;

// ==========================================
// 型定義
// ==========================================
interface MarkerData {
  x: number;        // 画像に対する横位置(%)
  y: number;        // 画像に対する縦位置(%)
  label: string;    // ラベルテキスト
  photo: string;    // 右クリック/ロングタップで表示する写真のファイル名
  photoSrc: string; // 写真を探す参照ページのパス(未指定なら現在ページ→地図の解決先)
  color: string;    // ピンの色
}

interface MapData {
  file: string;     // 平面図のオリジナルファイル名
  src: string;      // 地図画像を探す参照ページのパス(未指定なら規定ページ)
  cx: number;       // 初期表示の中心 X(%)
  cy: number;       // 初期表示の中心 Y(%)
  scale: number;    // 初期倍率
  restore: number;  // 最小化からの自動復帰時間(秒)
  markers: MarkerData[];
  currentPagePath: string; // この記法が書かれたページのパス(写真の既定解決先)
}

// ==========================================
// 1. 添付ファイルの URL 解決
// ==========================================

// 規定のストック用ページ。window.GROWI_CUSTOM_MAP_CONFIG.defaultSrc で上書き可能。
const DEFAULT_STOCK_PAGE = '/media-library';

const getDefaultStockPage = (): string => {
  const cfg = (window as any).GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.defaultSrc === 'string' ? cfg.defaultSrc.trim() : '';
  return v || DEFAULT_STOCK_PAGE;
};

// 添付一覧を「ページパス単位」でキャッシュする(同一ページの複数マーカーで API を使い回す)
const attachmentCache = new Map<string, Promise<any[]>>();

// GROWI の apiv3 GET ヘルパ(growiFacade 経由が使えればそれを、なければ fetch)
const apiv3Get = async (endpoint: string, params: Record<string, string>): Promise<any> => {
  const query = new URLSearchParams(params).toString();
  const url = `/_api/v3${endpoint}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`apiv3 GET failed: ${url} (${res.status})`);
  return res.json();
};

// ページパスから、そのページ ID を取得する
const getPageIdByPath = async (pagePath: string): Promise<string | null> => {
  try {
    const data = await apiv3Get('/page', { path: pagePath });
    const page = data?.page || data?.data?.page || data;
    const id = page?._id || page?.id;
    return typeof id === 'string' ? id : null;
  } catch (e) {
    console.error('[custom-map] failed to resolve page id by path', pagePath, e);
    return null;
  }
};

// ページパスに紐づく添付一覧を取得(キャッシュ付き)
const getAttachmentsForPage = (pagePath: string): Promise<any[]> => {
  const cached = attachmentCache.get(pagePath);
  if (cached) return cached;

  const promise = (async (): Promise<any[]> => {
    const pageId = await getPageIdByPath(pagePath);
    if (!pageId) return [];
    try {
      const data = await apiv3Get('/attachment/list', { pageId });
      const list = data?.paginateResult?.docs || data?.docs || data?.attachments || [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('[custom-map] failed to fetch attachment list', pagePath, e);
      return [];
    }
  })();

  attachmentCache.set(pagePath, promise);
  return promise;
};

// 現在表示中ページの添付一覧(GROWI_CONTEXT から同期取得できる分)
const getCurrentPageAttachments = (): any[] => {
  try {
    return (window as any).GROWI_CONTEXT?.page?.attachments || [];
  } catch {
    return [];
  }
};

const findAttachmentUrl = (attachments: any[], fileName: string): string | null => {
  const found = attachments.find(
    (att: any) => att.originalName === fileName || att.fileName === fileName,
  );
  return found ? `/attachment/${found._id}` : null;
};

// ファイル名を、指定した候補ページ(パス)の順で探して URL を返す。
// 見つからなければ null。
const resolveAttachmentUrl = async (
  fileName: string,
  candidatePages: string[],
): Promise<string | null> => {
  if (!fileName) return null;

  // まず現在ページの同期コンテキストを試す(候補に現在ページが含まれる場合の高速パス)
  const currentPath = (window as any).GROWI_CONTEXT?.page?.path;
  if (currentPath && candidatePages.includes(currentPath)) {
    const hit = findAttachmentUrl(getCurrentPageAttachments(), fileName);
    if (hit) return hit;
  }

  for (const pagePath of candidatePages) {
    if (!pagePath) continue;
    // eslint-disable-next-line no-await-in-loop
    const attachments = await getAttachmentsForPage(pagePath);
    const hit = findAttachmentUrl(attachments, fileName);
    if (hit) return hit;
  }
  return null;
};

// ==========================================
// ユーティリティ
// ==========================================
const toNumber = (value: string | null | undefined, fallback: number): number => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// ==========================================
// 2. 描画された HTML 要素をボタンに変換するメインロジック
// ==========================================
const initMapPopups = (): void => {
  const elements = document.querySelectorAll(
    'div[data-plugin="custom-map"]:not([data-processed="true"])',
  );

  elements.forEach((el: Element) => {
    const htmlEl = el as HTMLElement;
    htmlEl.setAttribute('data-processed', 'true'); // 二重処理防止

    // ─── データ属性から地図設定とマーカー配列を復元 ───
    let mapData: MapData;
    try {
      mapData = JSON.parse(htmlEl.getAttribute('data-map') || '{}');
    } catch (e) {
      console.error('Failed to parse custom-map data', e);
      return;
    }
    if (!mapData.file) return;

    // 現在表示中ページのパスを補完(写真の既定解決先に使う)
    if (!mapData.currentPagePath) {
      mapData.currentPagePath = (window as any).GROWI_CONTEXT?.page?.path || '';
    }

    const buttonText = htmlEl.getAttribute('data-link') || 'マップを開く';
    htmlEl.innerText = '';

    // ─── 起動ボタン ───
    const button = document.createElement('button');
    button.className = 'btn btn-outline-primary m-1';
    button.type = 'button';
    button.innerText = buttonText;
    htmlEl.appendChild(button);

    button.addEventListener('click', (e) => {
      e.preventDefault();
      openMapModal(mapData).catch((err) => console.error('[custom-map] failed to open modal', err));
    });
  });
};

// ==========================================
// 地図画像の候補ページ(探索順)を返す
//   src 指定があればそのページ → 規定ストックページ
// ==========================================
const getMapCandidatePages = (mapData: MapData): string[] => {
  const pages: string[] = [];
  if (mapData.src) pages.push(mapData.src);
  pages.push(getDefaultStockPage());
  return Array.from(new Set(pages));
};

// マーカー写真の候補ページ(探索順)を返す
//   photoSrc 指定があればそのページ → 記法を書いた現在ページ → 地図の解決先
// ==========================================
const getPhotoCandidatePages = (mapData: MapData, marker: MarkerData): string[] => {
  const pages: string[] = [];
  if (marker.photoSrc) pages.push(marker.photoSrc);
  if (mapData.currentPagePath) pages.push(mapData.currentPagePath);
  pages.push(...getMapCandidatePages(mapData));
  return Array.from(new Set(pages.filter(Boolean)));
};

// ==========================================
// モーダルの生成と各種インタラクション
// ==========================================
const openMapModal = async (mapData: MapData): Promise<void> => {
  // 既存モーダルの除去
  const oldModal = document.getElementById('growi-custom-map-modal');
  if (oldModal) oldModal.remove();

  // 地図画像 URL を候補ページから解決(見つからなければフォールバック)
  const imageUrl = (await resolveAttachmentUrl(mapData.file, getMapCandidatePages(mapData)))
    || `/images/maps/${mapData.file}`;

  // ─── モーダル外枠 ───
  const modal = document.createElement('div');
  modal.id = 'growi-custom-map-modal';
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: '9999',
  });

  // ─── コンテンツカード ───
  const content = document.createElement('div');
  Object.assign(content.style, {
    position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
    maxWidth: '90vw', maxHeight: '90vh', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
  });
  content.addEventListener('click', (ae) => ae.stopPropagation());

  // ─── 閉じるボタン ───
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff',
    border: 'none', borderRadius: '50%', width: '30px', height: '30px', fontSize: '20px',
    cursor: 'pointer', zIndex: '10', display: 'flex',
    justifyContent: 'center', alignItems: 'center',
  });
  closeBtn.addEventListener('click', () => modal.remove());

  // ─── ビューポート（クロップ表示用の窓）───
  const viewport = document.createElement('div');
  Object.assign(viewport.style, {
    position: 'relative', overflow: 'hidden',
    width: 'min(80vw, 900px)', height: 'min(75vh, 675px)',
    cursor: 'grab', touchAction: 'none', backgroundColor: '#f0f0f0',
    borderRadius: '4px',
  });

  // ─── ズーム/パン対象となる内側レイヤー ───
  // 画像とマーカーを同じ座標系に載せ、transform でまとめて拡大縮小・移動する
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'absolute', top: '0', left: '0',
    transformOrigin: '0 0', willChange: 'transform',
  });

  // ─── 平面図画像 ───
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = mapData.file;
  Object.assign(img.style, { display: 'block', userSelect: 'none', pointerEvents: 'none' });
  img.draggable = false;
  stage.appendChild(img);

  // ─── ビュー状態（transform） ───
  const view = { scale: mapData.scale || 1, tx: 0, ty: 0 };
  let naturalW = 0;
  let naturalH = 0;

  const applyTransform = (): void => {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  };

  // 画像ロード後に、指定された中心座標が窓の中央に来るよう初期化
  img.addEventListener('load', () => {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    stage.style.width = `${naturalW}px`;
    stage.style.height = `${naturalH}px`;

    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    // 倍率が未指定(=1)の場合でも、画像全体が窓に収まる倍率を基準にしてから scale を掛ける
    const fitScale = Math.min(vpW / naturalW, vpH / naturalH);
    const baseScale = fitScale * (mapData.scale || 1);
    view.scale = baseScale;

    // 中心座標(cx%, cy%)が窓の中央に来るよう平行移動量を計算
    const centerX = (mapData.cx / 100) * naturalW;
    const centerY = (mapData.cy / 100) * naturalH;
    view.tx = vpW / 2 - centerX * view.scale;
    view.ty = vpH / 2 - centerY * view.scale;

    applyTransform();
  });

  // ─── マーカー生成 ───
  mapData.markers.forEach((marker) => {
    createMarker(stage, marker, mapData);
  });

  // ─── ドラッグでパン ───
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  viewport.addEventListener('pointerdown', (e: PointerEvent) => {
    // マーカー等の操作はパンにしない
    if ((e.target as HTMLElement).closest('[data-map-marker]')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = view.tx;
    startTy = view.ty;
    viewport.style.cursor = 'grabbing';
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    view.tx = startTx + (e.clientX - startX);
    view.ty = startTy + (e.clientY - startY);
    applyTransform();
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    viewport.style.cursor = 'grab';
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // ─── ホイールでズーム（カーソル位置を中心に） ───
  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = clamp(view.scale * factor, 0.02, 40);
    const ratio = newScale / view.scale;

    // カーソル位置を固定点としてズーム
    view.tx = px - (px - view.tx) * ratio;
    view.ty = py - (py - view.ty) * ratio;
    view.scale = newScale;
    applyTransform();
  }, { passive: false });

  // ─── 組み立て ───
  viewport.appendChild(stage);
  content.appendChild(closeBtn);
  content.appendChild(viewport);
  modal.appendChild(content);
  modal.addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
};

// ==========================================
// マーカー(ピン + ラベル)の生成
//   左クリック/タップ  : 最小化・再表示のトグル
//   右クリック/ロングタップ : 参照写真のポップアップ
// ==========================================
const createMarker = (stage: HTMLElement, marker: MarkerData, mapData: MapData): void => {
  const color = marker.color || '#ff3b30';
  const restoreSec = mapData.restore;

  // マーカーのラッパー（画像座標系に対して % で配置）
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-map-marker', 'true');
  Object.assign(wrapper.style, {
    position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`,
    transform: 'translate(-50%, -50%)', zIndex: '5',
  });

  // ─── ピン本体 ───
  const pin = document.createElement('div');
  Object.assign(pin.style, {
    position: 'relative', width: '18px', height: '18px', backgroundColor: color,
    border: '2px solid #fff', borderRadius: '50%',
    boxShadow: '0 2px 5px rgba(0,0,0,0.4)', cursor: 'pointer',
    transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
  });

  // ─── ラベル ───
  const labelEl = document.createElement('div');
  labelEl.innerText = marker.label || '';
  Object.assign(labelEl.style, {
    position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: color, color: '#fff', padding: '4px 8px', borderRadius: '4px',
    fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'pointer', userSelect: 'none', transition: 'opacity 0.15s ease',
  });

  // 最小化状態の管理
  let minimized = false;
  let restoreTimer: number | undefined;

  const minimize = (): void => {
    minimized = true;
    // ピンを小さな点に
    Object.assign(pin.style, { width: '6px', height: '6px', borderWidth: '1px', opacity: '0.6' });
    if (marker.label) labelEl.style.display = 'none';

    // 指定秒後に自動復帰
    if (restoreTimer) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restore, (restoreSec || 15) * 1000);
  };

  const restore = (): void => {
    minimized = false;
    Object.assign(pin.style, { width: '18px', height: '18px', borderWidth: '2px', opacity: '1' });
    if (marker.label) labelEl.style.display = '';
    if (restoreTimer) {
      window.clearTimeout(restoreTimer);
      restoreTimer = undefined;
    }
  };

  const toggleMinimize = (): void => {
    if (minimized) restore();
    else minimize();
  };

  const showPhoto = (): void => {
    if (!marker.photo) return;
    // 写真の候補ページ(photoSrc → 現在ページ → 地図の解決先)から URL を解決
    resolveAttachmentUrl(marker.photo, getPhotoCandidatePages(mapData, marker))
      .then((url) => {
        openPhotoPopup(url || `/images/maps/${marker.photo}`, marker.label);
      })
      .catch((err) => {
        console.error('[custom-map] failed to resolve photo', marker.photo, err);
        openPhotoPopup(`/images/maps/${marker.photo}`, marker.label);
      });
  };

  // ─── 左クリック/右クリック・ロングタップの共通ハンドラを各要素に付与 ───
  const attachInteractions = (elForActions: HTMLElement): void => {
    // 右クリックメニューは抑止して写真表示に割り当て
    elForActions.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPhoto();
    });

    // ロングタップ判定用の状態
    let longPressTimer: number | undefined;
    let longPressed = false;
    let downPos = { x: 0, y: 0 };
    const MOVE_THRESHOLD = 10; // px。これ以上動いたらパン扱いにしてキャンセル

    elForActions.addEventListener('pointerdown', (e: PointerEvent) => {
      // パン処理へ伝播させない
      e.stopPropagation();
      longPressed = false;
      downPos = { x: e.clientX, y: e.clientY };

      if (e.pointerType === 'touch') {
        if (longPressTimer) window.clearTimeout(longPressTimer);
        longPressTimer = window.setTimeout(() => {
          longPressed = true;
          showPhoto();
        }, 500);
      }
    });

    elForActions.addEventListener('pointermove', (e: PointerEvent) => {
      if (longPressTimer == null) return;
      const dx = Math.abs(e.clientX - downPos.x);
      const dy = Math.abs(e.clientY - downPos.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    });

    elForActions.addEventListener('pointerup', (e: PointerEvent) => {
      e.stopPropagation();
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
      // ロングタップ済みなら写真表示済みなのでトグルしない
      if (longPressed) {
        longPressed = false;
        return;
      }
      // マウス右クリックは contextmenu 側で処理するのでここでは無視
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 左クリック/短いタップ → トグル
      toggleMinimize();
    });

    // クリックのデフォルト伝播を止める
    elForActions.addEventListener('click', (e) => e.stopPropagation());
  };

  attachInteractions(pin);

  if (marker.label) {
    attachInteractions(labelEl);
    wrapper.appendChild(labelEl);
  }

  wrapper.appendChild(pin);
  stage.appendChild(wrapper);
};

// ==========================================
// マーカー写真のポップアップ (photoUrl は解決済み URL)
// ==========================================
const openPhotoPopup = (photoUrl: string, caption: string): void => {
  const old = document.getElementById('growi-custom-map-photo');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'growi-custom-map-photo';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: '10000',
  });

  const photo = document.createElement('img');
  photo.src = photoUrl;
  photo.alt = caption || '';
  Object.assign(photo.style, {
    maxWidth: '85vw', maxHeight: '80vh', borderRadius: '6px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
  });

  overlay.appendChild(photo);

  if (caption) {
    const cap = document.createElement('div');
    cap.innerText = caption;
    Object.assign(cap.style, {
      color: '#fff', marginTop: '12px', fontSize: '14px', textAlign: 'center',
    });
    overlay.appendChild(cap);
  }

  overlay.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); overlay.remove(); });
  document.body.appendChild(overlay);
};

// 画面の更新（ページ遷移やレンダリング）を監視して定期実行
if (typeof window !== 'undefined') {
  setInterval(initMapPopups, 1000);
}

// ==========================================
// 3. GROWI へのプラグイン登録と remark の定義
// ==========================================

// containerDirective 配下の子ノード(箇条書き)から各マーカーの属性を抽出する。
// 記法:
//   :::custom-map{file="..." cx="50" cy="40" scale="2" link="..." restore="15"}
//   - x=30 y=40 label="受付" photo="reception.jpg" color="#ff0000"
//   - x=70 y=55 label="会議室A" photo="room_a.jpg"
//   :::
const KV_REGEX = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

const parseMarkerLine = (text: string): MarkerData | null => {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  KV_REGEX.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = KV_REGEX.exec(text)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = val;
  }
  if (attrs.x == null && attrs.y == null) return null;
  return {
    x: toNumber(attrs.x, 50),
    y: toNumber(attrs.y, 50),
    label: attrs.label || '',
    photo: attrs.photo || '',
    photoSrc: attrs.photoSrc || attrs.photosrc || '',
    color: attrs.color || '#ff3b30',
  };
};

// ノード配下の text ノードを連結して取り出す
const extractTextFromNode = (node: any): string => {
  let text = '';
  visit(node, 'text', (textNode: any) => {
    text += `${textNode.value} `;
  });
  return text;
};

const buildMapData = (node: any): MapData => {
  const attributes = node.attributes || {};
  const markers: MarkerData[] = [];

  // 子ノードのうち listItem を走査してマーカー化
  visit(node, 'listItem', (listItem: any) => {
    const line = extractTextFromNode(listItem).trim();
    const marker = parseMarkerLine(line);
    if (marker) markers.push(marker);
  });

  return {
    file: attributes.file || '',
    src: attributes.src || '',
    cx: toNumber(attributes.cx, 50),
    cy: toNumber(attributes.cy, 50),
    scale: toNumber(attributes.scale, 1),
    restore: toNumber(attributes.restore, 15),
    markers,
    currentPagePath: '', // クライアント側で GROWI_CONTEXT から補完する
  };
};

export const activate = (): void => {
  if (
    typeof growiFacade === 'undefined'
    || growiFacade == null
    || growiFacade.markdownRenderer == null
  ) {
    return;
  }

  const { optionsGenerators } = growiFacade.markdownRenderer;
  const original = optionsGenerators.customGenerateViewOptions;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = original
      ? original(...args)
      : optionsGenerators.generateViewOptions(...args);

    options.remarkPlugins = options.remarkPlugins || [];
    if (!options.remarkPlugins.includes(remarkDirective)) {
      options.remarkPlugins.push(remarkDirective);
    }

    options.remarkPlugins.push(() => (tree: any) => {
      visit(tree, (node: any) => {
        if (node.type === 'containerDirective' && node.name === 'custom-map') {
          const mapData = buildMapData(node);

          // 子ノードを空にして、div 一つに置き換える
          node.children = [];
          node.data = {
            hName: 'div',
            hProperties: {
              'data-plugin': 'custom-map',
              'data-link': (node.attributes || {}).link || 'マップを開く',
              'data-map': JSON.stringify(mapData),
            },
          };
        }
      });
    });

    return options;
  };
};

export const deactivate = (): void => {
  // クリーンアップ処理
};

// ==========================================
// 4. プラグインアクティベーターの定義
// ==========================================
const pluginDefinition = {
  activate,
  deactivate,
  activatePlugin: activate,
  deactivatePlugin: deactivate,
};

if (typeof window !== 'undefined') {
  const windowAsAny = window as any;
  windowAsAny.pluginActivators = windowAsAny.pluginActivators || {};
  windowAsAny.pluginActivators['growi-plugin-custom-map'] = pluginDefinition;
}

export default pluginDefinition;
