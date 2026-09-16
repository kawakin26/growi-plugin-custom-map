declare const growiFacade: any;

// ツリーを自前で深さ優先走査する(外部 unist-util-visit をバンドルしないことで、
// GROWI 本体の micromark/unified 環境とのバージョン不整合を避ける)。
const walk = (node: any, cb: (node: any) => void): void => {
  if (node == null) return;
  cb(node);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walk(child, cb);
  }
};

// desc(注意書き)付きマーカーのピンを点滅させる CSS を一度だけ注入する。
// JS で制御せず CSS アニメーションに任せるためリソース負荷は最小。
const ensureBlinkStyle = (): void => {
  const id = 'growi-custom-map-blink-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
@keyframes growi-custom-map-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.growi-custom-map-pin-blink {
  animation: growi-custom-map-blink 1.2s ease-in-out infinite;
}`;
  document.head.appendChild(style);
};

// ==========================================
// 型定義
// ==========================================
interface MarkerData {
  x: number;        // 画像に対する横位置(%)
  y: number;        // 画像に対する縦位置(%)
  label: string;    // ラベルテキスト
  photo: string;    // 右クリック/ロングタップで表示する写真のファイル名
  photoSrc: string; // 写真を探す参照ページのパス(未指定なら現在ページ→地図の解決先)
  desc: string;     // 説明文/注意書き('|' で改行)。設定時はピンが点滅する
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

// CAD 変換 API のエンドポイント。window.GROWI_CUSTOM_MAP_CONFIG.cadConvertApi で設定。
// 未設定なら CAD 変換機能はオフ(従来の画像添付運用のみで動作する)。
const getCadConvertApi = (): string => {
  const cfg = (window as any).GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.cadConvertApi === 'string' ? cfg.cadConvertApi.trim() : '';
  return v;
};

// 拡張子から CAD ファイルかどうかを判定する
const CAD_EXTENSIONS = ['.dxf', '.jww'];
const isCadFile = (fileName: string): boolean => {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return CAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
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

// CAD 変換 API に問い合わせて、変換済み画像 URL を得る。
// API 側はキャッシュ前提(CAD が更新されていなければ変換済み画像を返す)。
// 失敗時や未設定時は null を返し、呼び出し側で通常の添付解決にフォールバックする。
const resolveCadImageUrl = async (mapData: MapData): Promise<string | null> => {
  const api = getCadConvertApi();
  if (!api) return null; // API 未設定 → CAD 機能オフ

  // CAD の元ファイルがどのページにあるかの候補(地図と同じ解決先)
  const src = mapData.src || getDefaultStockPage();
  try {
    const sep = api.includes('?') ? '&' : '?';
    const url = `${api}${sep}file=${encodeURIComponent(mapData.file)}&src=${encodeURIComponent(src)}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`cad convert api failed: ${res.status}`);
    const data = await res.json();
    const imageUrl = data?.imageUrl || data?.url;
    if (data?.status && data.status !== 'ok') {
      throw new Error(`cad convert api status: ${data.status}`);
    }
    return typeof imageUrl === 'string' && imageUrl ? imageUrl : null;
  } catch (e) {
    console.warn('[custom-map] CAD conversion unavailable, falling back to attachment', e);
    return null;
  }
};

// 地図画像の URL を解決する。
// CAD ファイル(.dxf/.jww)かつ変換 API が有効なら変換画像を優先。
// それ以外・失敗時は通常の添付解決 → 静的パスの順にフォールバック。
const resolveMapImageUrl = async (mapData: MapData): Promise<string> => {
  if (isCadFile(mapData.file)) {
    const cadUrl = await resolveCadImageUrl(mapData);
    if (cadUrl) return cadUrl;
    // API が無い/失敗した場合でも、同名の変換済み画像が添付されていれば拾える可能性は低いが、
    // 最終的には静的パスへフォールバックして「壊れない」動作にする。
  }
  const attachmentUrl = await resolveAttachmentUrl(mapData.file, getMapCandidatePages(mapData));
  return attachmentUrl || `/images/maps/${mapData.file}`;
};

// ==========================================
// モーダルの生成と各種インタラクション
// ==========================================
const openMapModal = async (mapData: MapData): Promise<void> => {
  // 既存モーダルの除去
  const oldModal = document.getElementById('growi-custom-map-modal');
  if (oldModal) oldModal.remove();

  // 地図画像 URL を解決(CAD なら変換 API を優先、無ければ通常の添付解決にフォールバック)
  const imageUrl = await resolveMapImageUrl(mapData);

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
  // 逆スケール対象のマーカー inner 群(マーカー生成時に push する)。
  const markerInners: HTMLElement[] = [];

  const applyTransform = (): void => {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    // マーカー/ラベルは stage の拡大に追従させず、常に一定サイズで見せる。
    // stage の scale を打ち消す逆スケールを各 inner に適用する。
    const inv = view.scale ? 1 / view.scale : 1;
    for (const inner of markerInners) {
      inner.style.transform = `translate(-50%, -50%) scale(${inv})`;
    }
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
  // 逆スケール対象の inner を集め、applyTransform で一括更新する。
  mapData.markers.forEach((marker) => {
    const inner = createMarker(stage, marker, mapData);
    markerInners.push(inner);
  });

  // ─── パン(1本指/マウス) と ピンチズーム(2本指) ───
  // アクティブなポインタを管理し、1 本ならパン、2 本ならピンチズームにする。
  const pointers = new Map<number, { x: number; y: number }>();
  // パン用
  let panStartTx = 0;
  let panStartTy = 0;
  let panStartX = 0;
  let panStartY = 0;
  // ピンチ用(2 本指の初期距離・中点・そのときの view)
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartTx = 0;
  let pinchStartTy = 0;
  let pinchCenter = { x: 0, y: 0 };

  const vpPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const beginPinch = (): void => {
    const pts = Array.from(pointers.values());
    const [a, b] = pts;
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinchStartScale = view.scale;
    pinchStartTx = view.tx;
    pinchStartTy = view.ty;
    const midClientX = (a.x + b.x) / 2;
    const midClientY = (a.y + b.y) / 2;
    pinchCenter = vpPoint(midClientX, midClientY);
  };

  viewport.addEventListener('pointerdown', (e: PointerEvent) => {
    // マーカー等の操作はパン/ズームにしない
    if ((e.target as HTMLElement).closest('[data-map-marker]')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 1) {
      // パン開始
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartTx = view.tx;
      panStartTy = view.ty;
      viewport.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      // ピンチ開始(パンより優先)
      beginPinch();
    }
  });

  viewport.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      // ─── ピンチズーム ───
      const pts = Array.from(pointers.values());
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const factor = dist / pinchStartDist;
      const newScale = clamp(pinchStartScale * factor, 0.02, 40);
      // 中点(ピンチ開始時のビューポート座標)を固定点にしてズーム
      const ratio = newScale / pinchStartScale;
      view.tx = pinchCenter.x - (pinchCenter.x - pinchStartTx) * ratio;
      view.ty = pinchCenter.y - (pinchCenter.y - pinchStartTy) * ratio;
      view.scale = newScale;
      applyTransform();
    } else if (pointers.size === 1) {
      // ─── パン ───
      view.tx = panStartTx + (e.clientX - panStartX);
      view.ty = panStartTy + (e.clientY - panStartY);
      applyTransform();
    }
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 1) {
      // ピンチ→1 本残ったらパンに切り替え(残ったポインタ基準で再初期化)
      const [p] = Array.from(pointers.values());
      panStartX = p.x;
      panStartY = p.y;
      panStartTx = view.tx;
      panStartTy = view.ty;
      viewport.style.cursor = 'grabbing';
    } else if (pointers.size === 0) {
      viewport.style.cursor = 'grab';
    }
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

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
const createMarker = (
  stage: HTMLElement,
  marker: MarkerData,
  mapData: MapData,
): HTMLElement => {
  const color = marker.color || '#ff3b30';
  const restoreSec = mapData.restore;

  // マーカーのラッパー（画像座標系に対して % で配置）。
  // ここは位置決めのみ担当し、拡大縮小の逆補正は内側 inner で行う。
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-map-marker', 'true');
  Object.assign(wrapper.style, {
    position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`, zIndex: '5',
  });

  // ─── 逆スケール用インナー ───
  // stage 全体に scale(view.scale) がかかるため、マーカー/ラベルを常に一定サイズで
  // 見せるには inner に scale(1/view.scale) を掛けて相殺する。
  // 中心合わせ(translate(-50%,-50%))も inner 側で行い、原点をマーカー位置に保つ。
  const inner = document.createElement('div');
  inner.setAttribute('data-marker-inner', 'true');
  Object.assign(inner.style, {
    position: 'relative',
    transformOrigin: 'center center',
    transform: 'translate(-50%, -50%)',
  });

  const hasDesc = !!(marker.desc && marker.desc.trim());

  // ─── ピン本体 ─── (初期サイズは従来の 1/3: 18px → 6px)
  const pin = document.createElement('div');
  Object.assign(pin.style, {
    position: 'relative', width: '6px', height: '6px', backgroundColor: color,
    border: '1px solid #fff', borderRadius: '50%',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)', cursor: 'pointer',
    transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
  });
  // 説明文/注意書きがあるマーカーは点滅させて存在を示す
  if (hasDesc) {
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
  }

  // ─── ラベル ─── (ピン縮小に合わせてオフセットを詰める)
  const labelEl = document.createElement('div');
  labelEl.innerText = marker.label || '';
  Object.assign(labelEl.style, {
    position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: color, color: '#fff', padding: '4px 8px', borderRadius: '4px',
    fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'pointer', userSelect: 'none', transition: 'opacity 0.15s ease',
  });

  // 最小化状態の管理
  let minimized = false;
  let restoreTimer: number | undefined;

  const minimize = (): void => {
    minimized = true;
    // 最小化中はラベルを隠す。ピンは見えるサイズを保ったまま点滅させ、
    // 「隠れている状態」を示す(点で消えて再クリックできなくなるのを防ぐ)。
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
    Object.assign(pin.style, { width: '6px', height: '6px', borderWidth: '1px', opacity: '1' });
    if (marker.label) labelEl.style.display = 'none';

    // 指定秒後に自動復帰
    if (restoreTimer) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restore, (restoreSec || 15) * 1000);
  };

  const restore = (): void => {
    minimized = false;
    Object.assign(pin.style, { width: '6px', height: '6px', borderWidth: '1px', opacity: '1' });
    // 通常表示に戻す。点滅は説明文付きマーカーのみ(元の仕様)。
    if (hasDesc) pin.classList.add('growi-custom-map-pin-blink');
    else pin.classList.remove('growi-custom-map-pin-blink');
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

  // 右クリック/ロングタップ: 写真と説明文をポップアップ表示する。
  // 写真も説明文も無ければ何もしない。
  const showDetail = (): void => {
    if (!marker.photo && !hasDesc) return;
    if (!marker.photo) {
      // 写真なし・説明文のみ
      openDetailPopup('', marker.label, marker.desc);
      return;
    }
    // 写真の候補ページ(photoSrc → 現在ページ → 地図の解決先)から URL を解決
    resolveAttachmentUrl(marker.photo, getPhotoCandidatePages(mapData, marker))
      .then((url) => {
        openDetailPopup(url || `/images/maps/${marker.photo}`, marker.label, marker.desc);
      })
      .catch((err) => {
        console.error('[custom-map] failed to resolve photo', marker.photo, err);
        openDetailPopup(`/images/maps/${marker.photo}`, marker.label, marker.desc);
      });
  };

  // ─── 左クリック/右クリック・ロングタップの共通ハンドラを各要素に付与 ───
  const attachInteractions = (elForActions: HTMLElement): void => {
    // 右クリックメニューは抑止して写真表示に割り当て
    elForActions.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDetail();
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
          showDetail();
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
    inner.appendChild(labelEl);
  }

  inner.appendChild(pin);
  wrapper.appendChild(inner);
  stage.appendChild(wrapper);

  // 逆スケール更新用に inner を返す(呼び出し側が view.scale に応じて更新する)。
  return inner;
};

// ==========================================
// マーカー詳細のポップアップ
//   photoUrl: 解決済み写真 URL(空文字なら写真なし)
//   caption : ラベル(見出しとして表示)
//   desc    : 説明文/注意書き('|' で改行)
// ==========================================
const openDetailPopup = (photoUrl: string, caption: string, desc: string): void => {
  const old = document.getElementById('growi-custom-map-photo');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'growi-custom-map-photo';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: '10000',
  });

  // 写真がある場合のみ画像を表示
  if (photoUrl) {
    const photo = document.createElement('img');
    photo.src = photoUrl;
    photo.alt = caption || '';
    Object.assign(photo.style, {
      maxWidth: '85vw', maxHeight: '75vh', borderRadius: '6px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
    });
    overlay.appendChild(photo);
  }

  // 見出し(ラベル)
  if (caption) {
    const cap = document.createElement('div');
    cap.innerText = caption;
    Object.assign(cap.style, {
      color: '#fff', marginTop: '12px', fontSize: '16px', fontWeight: 'bold',
      textAlign: 'center',
    });
    overlay.appendChild(cap);
  }

  // 説明文/注意書き('|' を改行として表示)
  if (desc && desc.trim()) {
    const descEl = document.createElement('div');
    descEl.innerText = desc.split('|').join('\n');
    Object.assign(descEl.style, {
      color: '#fff', marginTop: '10px', fontSize: '14px', lineHeight: '1.6',
      textAlign: 'center', whiteSpace: 'pre-wrap', maxWidth: '85vw',
      background: 'rgba(255,255,255,0.08)', padding: '10px 16px', borderRadius: '6px',
    });
    overlay.appendChild(descEl);
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
    desc: attrs.desc || '',
    color: attrs.color || '#ff3b30',
  };
};

// ノード配下の text ノードを連結して取り出す(自前再帰。visit の副作用を避ける)。
// スペースを勝手に挿入すると desc="a|b" のような値が壊れるため、
// text ノードの value をそのまま連結する。
// また、markdown が半角スペースを含む属性値を分割することがあるため、
// inlineCode(``) など text 以外の値も拾って連結する。
const extractTextFromNode = (node: any): string => {
  if (node == null) return '';
  if (typeof node.value === 'string' && (node.type === 'text' || node.type === 'inlineCode')) {
    return node.value;
  }
  let text = '';
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    text += extractTextFromNode(child);
  }
  return text;
};

// ノード配下の listItem を自前再帰で集める
const collectListItems = (node: any, out: any[]): void => {
  if (node == null) return;
  if (node.type === 'listItem') out.push(node);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    collectListItems(child, out);
  }
};

const buildMapData = (node: any): MapData => {
  const attributes = node.attributes || {};
  const markers: MarkerData[] = [];

  // 子ノードのうち listItem を走査してマーカー化
  const listItems: any[] = [];
  collectListItems(node, listItems);
  for (const listItem of listItems) {
    const line = extractTextFromNode(listItem).trim();
    const marker = parseMarkerLine(line);
    if (marker) markers.push(marker);
  }

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
    // remark-directive は GROWI 本体が既に登録しているため、ここでは追加しない。
    // (自前バンドルすると micromark 拡張が二重になり this.setData エラーになる)

    options.remarkPlugins.push(() => (tree: any) => {
      walk(tree, (node: any) => {
        if (node.type === 'containerDirective' && node.name === 'custom-map') {
          const mapData = buildMapData(node);

          // マーカー抽出後、子ノードを空にして 1 つの div にする。
          // node.data を丸ごと再代入すると remark-directive の内部処理
          // (this.setData 前提) と衝突するため、既存 data を保持して代入する。
          node.children = [];
          const data = node.data || (node.data = {});
          data.hName = 'div';
          data.hProperties = {
            'data-plugin': 'custom-map',
            'data-link': (node.attributes || {}).link || 'マップを開く',
            'data-map': JSON.stringify(mapData),
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
