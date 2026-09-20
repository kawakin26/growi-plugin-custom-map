declare const growiFacade: any;

import {
  getDefaultStockPage,
  getCadConvertApi,
  resolveAttachmentUrl,
  resolveRegisteredAssetUrl,
  toNumber,
  clamp,
  textColorForBg,
} from './common';

// ============================================================
// 表示(viewer)機能: 記法 :::custom-map を地図モーダルとして表示する。
// (元 client-entry.tsx の表示ロジックを、中身を変えずに移設)
// ============================================================

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
// 1 マーカーに紐づく参考写真 1 枚。photo は添付ファイル名、desc はその写真のコメント。
interface PhotoData {
  photo: string;
  desc: string;
}

interface MarkerData {
  x: number;
  y: number;
  label: string;
  photo: string; // 後方互換(旧記法の単一 photo)。新記法では photos を使う
  photoSrc: string;
  desc: string; // マーカー全体の説明/注意
  color: string;
  photos: PhotoData[]; // 参考写真(0 枚以上)
}

interface MapData {
  file: string;
  src: string;
  cx: number;
  cy: number;
  scale: number;
  restore: number;
  rotate: number;
  markers: MarkerData[];
  currentPagePath: string;
}

// 回転角を 0/90/180/270 のいずれかに正規化する(負値や 360 超も丸める)。
const normalizeRotate = (deg: number): number => {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return n;
};

// 拡張子から CAD ファイルかどうかを判定する
const CAD_EXTENSIONS = ['.dxf', '.jww'];
const isCadFile = (fileName: string): boolean => {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return CAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

// ==========================================
// 描画された HTML 要素をボタンに変換するメインロジック
// ==========================================
const initMapPopups = (): void => {
  const elements = document.querySelectorAll(
    'div[data-plugin="custom-map"]:not([data-processed="true"])',
  );

  elements.forEach((el: Element) => {
    const htmlEl = el as HTMLElement;
    htmlEl.setAttribute('data-processed', 'true');

    let mapData: MapData;
    try {
      mapData = JSON.parse(htmlEl.getAttribute('data-map') || '{}');
    } catch (e) {
      console.error('Failed to parse custom-map data', e);
      return;
    }
    if (!mapData.file) return;

    if (!mapData.currentPagePath) {
      mapData.currentPagePath = (window as any).GROWI_CONTEXT?.page?.path || '';
    }

    const buttonText = htmlEl.getAttribute('data-link') || 'マップを開く';
    htmlEl.innerText = '';

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

// 地図画像の候補ページ(探索順)を返す
const getMapCandidatePages = (mapData: MapData): string[] => {
  const pages: string[] = [];
  if (mapData.src) pages.push(mapData.src);
  pages.push(getDefaultStockPage());
  return Array.from(new Set(pages));
};

// マーカー写真の候補ページ(探索順)を返す。
// 設計方針: 参考写真は「その地図記法を書いたページ」の添付として保存する運用。
// よって現在表示中ページを最優先にし、media-library 等の地図ストックページは
// 探索しない(そこは一般閲覧者に 403 になり得るうえ、写真の置き場所ではない)。
// 後方互換で photoSrc(写真の格納ページ明示指定)があれば先に見る。
const getPhotoCandidatePages = (mapData: MapData, marker: MarkerData): string[] => {
  const pages: string[] = [];
  if (marker.photoSrc) pages.push(marker.photoSrc);
  if (mapData.currentPagePath) pages.push(mapData.currentPagePath);
  return Array.from(new Set(pages.filter(Boolean)));
};

// CAD 変換 API に問い合わせて、変換済み画像 URL を得る。
const resolveCadImageUrl = async (mapData: MapData): Promise<string | null> => {
  const api = getCadConvertApi();
  if (!api) return null;

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

// 地図画像の URL を解決する。解決順:
//   1. 登録アセット(方式Q。CAD 焼き込み SVG / 画像原本)を API 配信で最優先
//      → ストックページ秘匿でも表示でき、閲覧者権限に依存しない
//   2. 未登録の CAD は従来どおりその場変換
//   3. 従来の添付解決(後方互換。旧記法で直接添付を参照していたページ向け)
// いずれでも見つからなければ null(呼び出し側で「ファイルが存在しない」旨を表示)。
// 設計方針: 今後の地図参照は登録アセット(登録名)経由が前提。media-library の
// 生ファイル直参照は書き間違いと同等に扱い、不在メッセージで気づけるようにする。
const resolveMapImageUrl = async (mapData: MapData): Promise<string | null> => {
  // 1. 登録アセット優先(file が登録名なら CAD・画像とも API 配信 URL を返す)
  const registeredUrl = await resolveRegisteredAssetUrl(mapData.file, getMapCandidatePages(mapData));
  if (registeredUrl) return registeredUrl;

  // 2. 未登録の CAD はその場変換(従来動作)
  if (isCadFile(mapData.file)) {
    const cadUrl = await resolveCadImageUrl(mapData);
    if (cadUrl) return cadUrl;
  }

  // 3. 従来の添付解決(後方互換)。見つからなければ null。
  const attachmentUrl = await resolveAttachmentUrl(mapData.file, getMapCandidatePages(mapData));
  return attachmentUrl || null;
};

// ==========================================
// モーダルの生成と各種インタラクション
// ==========================================
const openMapModal = async (mapData: MapData): Promise<void> => {
  const oldModal = document.getElementById('growi-custom-map-modal');
  if (oldModal) oldModal.remove();

  const imageUrl = await resolveMapImageUrl(mapData);

  const modal = document.createElement('div');
  modal.id = 'growi-custom-map-modal';
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: '9999',
  });

  const content = document.createElement('div');
  Object.assign(content.style, {
    position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
    maxWidth: '90vw', maxHeight: '90vh', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
  });
  content.addEventListener('click', (ae) => ae.stopPropagation());

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

  // 平面図が解決できない(登録アセット・CAD 変換・添付のいずれにも無い)場合は、
  // 地図を描画せず「ファイルが存在しない」旨を表示する。設計方針により、
  // media-library の生ファイル直参照や記法の書き間違いはここで検知される。
  if (!imageUrl) {
    const notFound = document.createElement('div');
    Object.assign(notFound.style, {
      width: 'min(80vw, 640px)', padding: '8px 4px', textAlign: 'center', color: '#333',
    });
    const title = document.createElement('div');
    title.textContent = '地図ファイルが見つかりません';
    Object.assign(title.style, { fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' });
    const detail = document.createElement('div');
    detail.innerHTML = `指定された地図 <code style="font-family:monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px;">${mapData.file}</code> が見つかりませんでした。`
      + '<br>登録名が正しいか確認してください。登録済みの地図は、編集画面の「🗺 地図を作成」から選べます。'
      + '<br>未登録の図面は、MAP 編集者に登録を依頼してください。';
    Object.assign(detail.style, { fontSize: '13px', color: '#666', lineHeight: '1.7' });
    notFound.appendChild(title);
    notFound.appendChild(detail);
    content.appendChild(closeBtn);
    content.appendChild(notFound);
    modal.appendChild(content);
    modal.addEventListener('click', () => modal.remove());
    document.body.appendChild(modal);
    return;
  }

  const viewport = document.createElement('div');
  Object.assign(viewport.style, {
    position: 'relative', overflow: 'hidden',
    width: 'min(80vw, 900px)', height: 'min(75vh, 675px)',
    cursor: 'grab', touchAction: 'none', backgroundColor: '#f0f0f0',
    borderRadius: '4px',
  });

  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'absolute', top: '0', left: '0',
    transformOrigin: '0 0', willChange: 'transform',
  });

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = mapData.file;
  Object.assign(img.style, { display: 'block', userSelect: 'none', pointerEvents: 'none' });
  img.draggable = false;
  stage.appendChild(img);

  const rotate = mapData.rotate || 0;
  const rad = (rotate * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  // 元画像座標(px,py)を rotate + scale した後の相対オフセットを返す。
  // transform は translate(tx,ty) rotate(rot) scale(s) の順で適用される前提。
  const rotScale = (px: number, py: number, s: number): { x: number; y: number } => {
    const sx = px * s;
    const sy = py * s;
    return {
      x: sx * cosR - sy * sinR,
      y: sx * sinR + sy * cosR,
    };
  };

  const view = { scale: mapData.scale || 1, tx: 0, ty: 0 };
  let naturalW = 0;
  let naturalH = 0;
  const markerInners: HTMLElement[] = [];

  const applyTransform = (): void => {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) rotate(${rotate}deg) scale(${view.scale})`;
    // マーカーの中身は回転を打ち消して常に正立させる。stage の rotate を相殺するため
    // rotate(-rot) を掛け、さらに拡大の逆数でサイズを一定に保つ。
    const inv = view.scale ? 1 / view.scale : 1;
    for (const inner of markerInners) {
      inner.style.transform = `translate(-50%, -50%) rotate(${-rotate}deg) scale(${inv})`;
    }
  };

  img.addEventListener('load', () => {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    stage.style.width = `${naturalW}px`;
    stage.style.height = `${naturalH}px`;

    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    // 90/270 度回転では見かけの幅・高さが入れ替わるので、それを考慮して fit を計算。
    const swap = rotate === 90 || rotate === 270;
    const dispW = swap ? naturalH : naturalW;
    const dispH = swap ? naturalW : naturalH;
    const fitScale = Math.min(vpW / dispW, vpH / dispH);
    const baseScale = fitScale * (mapData.scale || 1);
    view.scale = baseScale;

    // 元画像上の中心点を、回転・スケール後に viewport 中央へ合わせる。
    const centerX = (mapData.cx / 100) * naturalW;
    const centerY = (mapData.cy / 100) * naturalH;
    const off = rotScale(centerX, centerY, view.scale);
    view.tx = vpW / 2 - off.x;
    view.ty = vpH / 2 - off.y;

    applyTransform();
  });

  mapData.markers.forEach((marker) => {
    const inner = createMarker(stage, marker, mapData);
    markerInners.push(inner);
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let panStartTx = 0;
  let panStartTy = 0;
  let panStartX = 0;
  let panStartY = 0;
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
    if ((e.target as HTMLElement).closest('[data-map-marker]')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 1) {
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartTx = view.tx;
      panStartTy = view.ty;
      viewport.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      beginPinch();
    }
  });

  viewport.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const factor = dist / pinchStartDist;
      const newScale = clamp(pinchStartScale * factor, 0.02, 40);
      const ratio = newScale / pinchStartScale;
      view.tx = pinchCenter.x - (pinchCenter.x - pinchStartTx) * ratio;
      view.ty = pinchCenter.y - (pinchCenter.y - pinchStartTy) * ratio;
      view.scale = newScale;
      applyTransform();
    } else if (pointers.size === 1) {
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

  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = clamp(view.scale * factor, 0.02, 40);
    const ratio = newScale / view.scale;

    view.tx = px - (px - view.tx) * ratio;
    view.ty = py - (py - view.ty) * ratio;
    view.scale = newScale;
    applyTransform();
  }, { passive: false });

  viewport.appendChild(stage);
  content.appendChild(closeBtn);
  content.appendChild(viewport);
  modal.appendChild(content);
  modal.addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
};

// ==========================================
// マーカー(ピン + ラベル)の生成
// ==========================================
const createMarker = (
  stage: HTMLElement,
  marker: MarkerData,
  mapData: MapData,
): HTMLElement => {
  const color = marker.color || '#ff3b30';
  const restoreSec = mapData.restore;

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-map-marker', 'true');
  Object.assign(wrapper.style, {
    position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`, zIndex: '5',
  });

  const inner = document.createElement('div');
  inner.setAttribute('data-marker-inner', 'true');
  Object.assign(inner.style, {
    position: 'relative',
    transformOrigin: 'center center',
    transform: 'translate(-50%, -50%)',
  });

  // タップで詳細(写真ギャラリー/説明)が見られる合図として点滅させる。
  // 写真が 1 枚でもあれば、または説明があれば「詳細あり」とする。
  const hasDetail = !!((marker.desc && marker.desc.trim()) || (marker.photos && marker.photos.length > 0));

  const pin = document.createElement('div');
  Object.assign(pin.style, {
    position: 'relative', width: '12px', height: '12px', backgroundColor: color,
    border: '2px solid #fff', borderRadius: '50%',
    boxShadow: '0 1px 3px rgba(0,0,0,0.4)', cursor: 'pointer',
    transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
  });
  if (hasDetail) {
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
  }

  const labelEl = document.createElement('div');
  labelEl.innerText = marker.label || '';
  Object.assign(labelEl.style, {
    position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: color, color: textColorForBg(color), padding: '4px 8px', borderRadius: '4px',
    fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'pointer', userSelect: 'none', transition: 'opacity 0.15s ease',
  });

  let minimized = false;
  let restoreTimer: number | undefined;

  const minimize = (): void => {
    minimized = true;
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
    Object.assign(pin.style, { width: '12px', height: '12px', borderWidth: '2px', opacity: '1' });
    if (marker.label) labelEl.style.display = 'none';

    if (restoreTimer) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restore, (restoreSec || 15) * 1000);
  };

  const restore = (): void => {
    minimized = false;
    Object.assign(pin.style, { width: '12px', height: '12px', borderWidth: '2px', opacity: '1' });
    if (hasDetail) pin.classList.add('growi-custom-map-pin-blink');
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

  const showDetail = (): void => {
    const photos = marker.photos || [];
    if (photos.length === 0 && !hasDetail) return;
    if (photos.length === 0) {
      // 写真なし、説明のみ。
      openDetailPopup([], marker.label, marker.desc);
      return;
    }
    const candidates = getPhotoCandidatePages(mapData, marker);
    // 各写真の添付 URL を解決する(解決不可なら旧フォールバック /images/maps/)。
    Promise.all(photos.map((p) => resolveAttachmentUrl(p.photo, candidates)
      .then((url) => ({ url: url || `/images/maps/${p.photo}`, desc: p.desc }))
      .catch((err) => {
        console.error('[custom-map] failed to resolve photo', p.photo, err);
        return { url: `/images/maps/${p.photo}`, desc: p.desc };
      })))
      .then((items) => {
        openDetailPopup(items, marker.label, marker.desc);
      });
  };

  const attachInteractions = (elForActions: HTMLElement): void => {
    elForActions.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDetail();
    });

    let longPressTimer: number | undefined;
    let longPressed = false;
    let downPos = { x: 0, y: 0 };
    const MOVE_THRESHOLD = 10;

    elForActions.addEventListener('pointerdown', (e: PointerEvent) => {
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
      if (longPressed) {
        longPressed = false;
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      toggleMinimize();
    });

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

  return inner;
};

// ==========================================
// マーカー詳細のポップアップ
// ==========================================
// マーカー詳細ポップアップ。複数写真をギャラリー表示し、各写真の下にその写真の
// コメントを表示する。最後にマーカー全体の説明(markerDesc)を表示する。
// photos が空でも markerDesc があれば説明のみ表示する。
const openDetailPopup = (
  photos: { url: string; desc: string }[],
  caption: string,
  markerDesc: string,
): void => {
  const old = document.getElementById('growi-custom-map-photo');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'growi-custom-map-photo';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: '10000',
  });

  // 写真が多いときのためスクロール可能な内側コンテナに収める。
  const scroll = document.createElement('div');
  Object.assign(scroll.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
    maxHeight: '92vh', overflowY: 'auto', padding: '16px', boxSizing: 'border-box',
  });
  // 内側クリックでは閉じない(オーバーレイ余白クリックで閉じる)。
  scroll.addEventListener('click', (e) => e.stopPropagation());

  if (caption) {
    const cap = document.createElement('div');
    cap.innerText = caption;
    Object.assign(cap.style, {
      color: '#fff', fontSize: '16px', fontWeight: 'bold', textAlign: 'center',
    });
    scroll.appendChild(cap);
  }

  // 各写真 + その写真のコメント。
  const single = photos.length === 1;
  for (const p of photos) {
    const figure = document.createElement('div');
    Object.assign(figure.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
    });
    if (p.url) {
      const photo = document.createElement('img');
      photo.src = p.url;
      photo.alt = p.desc || caption || '';
      Object.assign(photo.style, {
        maxWidth: '85vw', maxHeight: single ? '70vh' : '55vh', borderRadius: '6px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)', objectFit: 'contain',
      });
      figure.appendChild(photo);
    }
    if (p.desc && p.desc.trim()) {
      const cap = document.createElement('div');
      cap.innerText = p.desc.split('|').join('\n');
      Object.assign(cap.style, {
        color: '#fff', fontSize: '13px', lineHeight: '1.6', textAlign: 'center',
        whiteSpace: 'pre-wrap', maxWidth: '85vw',
        background: 'rgba(255,255,255,0.10)', padding: '6px 12px', borderRadius: '6px',
      });
      figure.appendChild(cap);
    }
    scroll.appendChild(figure);
  }

  // マーカー全体の説明/注意。
  if (markerDesc && markerDesc.trim()) {
    const descEl = document.createElement('div');
    descEl.innerText = markerDesc.split('|').join('\n');
    Object.assign(descEl.style, {
      color: '#fff', fontSize: '14px', lineHeight: '1.6', textAlign: 'center',
      whiteSpace: 'pre-wrap', maxWidth: '85vw',
      background: 'rgba(255,255,255,0.08)', padding: '10px 16px', borderRadius: '6px',
    });
    scroll.appendChild(descEl);
  }

  overlay.appendChild(scroll);
  overlay.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); overlay.remove(); });
  document.body.appendChild(overlay);
};

// ==========================================
// remark の定義(記法 → data 属性付き div)
// ==========================================
// editor 側 attrStr のエスケープ("→\")に対応するため、\" \' を許容して拾う。
const KV_REGEX = /(\w+)\s*=\s*(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+))/g;

// エスケープされた \" \' を元に戻す(editor 側 attrStr の逆)。
const unescapeAttr = (s: string): string => s.replace(/\\(["'])/g, '$1');

const parseAttrs = (text: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  KV_REGEX.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = KV_REGEX.exec(text)) !== null) {
    const key = m[1];
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = unescapeAttr(raw);
  }
  return attrs;
};

// マーカー行を MarkerData に変換。photos は空で返し、子リストは呼び出し側で足す。
// 後方互換: 同じ行に photo= があれば写真 1 枚として photos に取り込む。
const parseMarkerLine = (text: string): MarkerData | null => {
  const attrs = parseAttrs(text);
  if (attrs.x == null && attrs.y == null) return null;
  const photos: PhotoData[] = [];
  if (attrs.photo) photos.push({ photo: attrs.photo, desc: attrs.desc || '' });
  return {
    x: toNumber(attrs.x, 50),
    y: toNumber(attrs.y, 50),
    label: attrs.label || '',
    photo: attrs.photo || '',
    photoSrc: attrs.photoSrc || attrs.photosrc || '',
    desc: attrs.desc || '',
    color: attrs.color || '#ff3b30',
    photos,
  };
};

// 写真の子リスト行を PhotoData に変換。photo が無ければ null。
const parsePhotoLine = (text: string): PhotoData | null => {
  const attrs = parseAttrs(text);
  if (!attrs.photo) return null;
  return { photo: attrs.photo, desc: attrs.desc || '' };
};

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

// custom-map ブロック直下の「最初の list」を探して、そのトップレベル listItem 群を返す。
// これらがマーカー行。各 listItem 内にネストした list があればそれが写真(子)。
// 従来の「全 listItem を平坦収集」だと写真行までマーカー扱いになるため、階層を保つ。
const findTopLevelListItems = (node: any): any[] => {
  let list: any = null;
  const findList = (n: any): void => {
    if (list || n == null) return;
    if (n.type === 'list') { list = n; return; }
    const children = Array.isArray(n.children) ? n.children : [];
    for (const c of children) { findList(c); if (list) return; }
  };
  findList(node);
  if (!list) return [];
  return (Array.isArray(list.children) ? list.children : []).filter(
    (c: any) => c && c.type === 'listItem',
  );
};

// listItem の「直下 paragraph」だけのテキストを取る(ネストした子リストは含めない)。
// マーカー行の属性はこの直下テキストにある。
const directItemText = (listItem: any): string => {
  const children = Array.isArray(listItem.children) ? listItem.children : [];
  let text = '';
  for (const c of children) {
    if (c && c.type === 'list') continue; // 子リスト(写真)は除外
    text += extractTextFromNode(c);
  }
  return text.trim();
};

// listItem 内のネストした list の listItem 群(=写真行)を返す。
const nestedPhotoItems = (listItem: any): any[] => {
  const children = Array.isArray(listItem.children) ? listItem.children : [];
  const out: any[] = [];
  for (const c of children) {
    if (c && c.type === 'list') {
      for (const li of (Array.isArray(c.children) ? c.children : [])) {
        if (li && li.type === 'listItem') out.push(li);
      }
    }
  }
  return out;
};

const buildMapData = (node: any): MapData => {
  const attributes = node.attributes || {};
  const markers: MarkerData[] = [];

  const listItems = findTopLevelListItems(node);
  for (const listItem of listItems) {
    const line = directItemText(listItem);
    const marker = parseMarkerLine(line);
    if (!marker) continue;
    // ネストした子リスト行を写真として取り込む。子リストがあれば新方式なので、
    // 旧記法互換で入れた「同一行 photo」の photos は子リスト側で上書きする。
    const photoItems = nestedPhotoItems(listItem);
    if (photoItems.length > 0) {
      const photos: PhotoData[] = [];
      for (const pi of photoItems) {
        const photo = parsePhotoLine(directItemText(pi));
        if (photo) photos.push(photo);
      }
      marker.photos = photos;
    }
    markers.push(marker);
  }

  return {
    file: attributes.file || '',
    src: attributes.src || '',
    cx: toNumber(attributes.cx, 50),
    cy: toNumber(attributes.cy, 50),
    scale: toNumber(attributes.scale, 1),
    restore: toNumber(attributes.restore, 15),
    rotate: normalizeRotate(toNumber(attributes.rotate, 0)),
    markers,
    currentPagePath: '',
  };
};

// 画面更新の監視インターバル(deactivate で止められるよう保持)
let popupIntervalId: number | undefined;

export const activateViewer = (): void => {
  // レンダリング後の div をボタン化する定期監視
  if (popupIntervalId == null && typeof window !== 'undefined') {
    popupIntervalId = window.setInterval(initMapPopups, 1000);
  }

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

    options.remarkPlugins.push(() => (tree: any) => {
      walk(tree, (node: any) => {
        if (node.type === 'containerDirective' && node.name === 'custom-map') {
          const mapData = buildMapData(node);
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

export const deactivateViewer = (): void => {
  if (popupIntervalId != null) {
    window.clearInterval(popupIntervalId);
    popupIntervalId = undefined;
  }
};
