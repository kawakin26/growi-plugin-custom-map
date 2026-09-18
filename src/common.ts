// ============================================================
// 共通ユーティリティ(表示 viewer と 編集 editor で共有)
// ============================================================

// 規定のストック用ページ。window.GROWI_CUSTOM_MAP_CONFIG.defaultSrc で上書き可能。
const DEFAULT_STOCK_PAGE = '/media-library';

export const getDefaultStockPage = (): string => {
  const cfg = (window as unknown as { GROWI_CUSTOM_MAP_CONFIG?: { defaultSrc?: string } })
    .GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.defaultSrc === 'string' ? cfg.defaultSrc.trim() : '';
  return v || DEFAULT_STOCK_PAGE;
};

// CAD 変換 API のエンドポイント。window.GROWI_CUSTOM_MAP_CONFIG.cadConvertApi で設定。
// 未設定なら CAD 変換機能はオフ。
export const getCadConvertApi = (): string => {
  const cfg = (window as unknown as { GROWI_CUSTOM_MAP_CONFIG?: { cadConvertApi?: string } })
    .GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.cadConvertApi === 'string' ? cfg.cadConvertApi.trim() : '';
  return v;
};

// ============================================================
// アセット登録 API(方式Q)クライアント。
// cadConvertApi は変換エンドポイント(/convert)を指すので、その末尾を /assets に
// 置き換えてアセット管理エンドポイントの URL を組み立てる。
// ============================================================

// 変換 API のベースから /assets エンドポイントの URL を導出する。
// 例: https://gw/cad/convert -> https://gw/cad/assets
const getAssetsApiBase = (): string => {
  const api = getCadConvertApi();
  if (!api) return '';
  // 末尾の /convert(クエリ以降は無視)を /assets に置換。
  const [path] = api.split('?');
  if (/\/convert$/.test(path)) return path.replace(/\/convert$/, '/assets');
  // /convert で終わっていない場合は、末尾に /assets を足す(フォールバック)。
  return `${path.replace(/\/$/, '')}/assets`;
};

// 登録アセット1件
export interface RegisteredAsset {
  name: string;
  key: string;
  type: string;
  srcFile: string;
  src: string;
  rotate: number;
  createdAt: string;
  imageUrl: string;
}

// 未登録の CAD ファイル名一覧を取得する(新規登録タブ用)。
export const fetchUnregisteredCads = async (src: string): Promise<string[]> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const url = `${base}/unregistered?src=${encodeURIComponent(src)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`fetch unregistered failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.files) ? (data.files as string[]) : [];
};

// 登録済みアセット一覧を取得する(削除タブ用)。src 省略で全件。
export const fetchRegisteredAssets = async (src?: string): Promise<RegisteredAsset[]> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const url = src ? `${base}?src=${encodeURIComponent(src)}` : base;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`fetch assets failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.assets) ? (data.assets as RegisteredAsset[]) : [];
};

// CAD を別名で登録する。成功時は登録結果(imageUrl 等)を返す。
export const registerCadAsset = async (params: {
  name: string; file: string; src: string; rotate: number;
}): Promise<{ imageUrl: string; name: string; rotate: number }> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data as Record<string, unknown>).message) || `register failed: ${res.status}`;
    throw new Error(String(msg));
  }
  return data as { imageUrl: string; name: string; rotate: number };
};

// 登録アセットを削除する。
export const deleteCadAsset = async (name: string): Promise<void> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const url = `${base}?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data && (data as Record<string, unknown>).message) || `delete failed: ${res.status}`;
    throw new Error(String(msg));
  }
};

// 変換 API のプレビュー用 URL を組み立てる(登録前に回転結果を確認する)。
// 方式1(file+src+rotate)で /convert を呼ぶ URL を返す。
export const buildConvertPreviewUrl = (file: string, src: string, rotate: number): string => {
  const api = getCadConvertApi();
  if (!api) return '';
  const sep = api.includes('?') ? '&' : '?';
  return `${api}${sep}file=${encodeURIComponent(file)}&src=${encodeURIComponent(src)}&rotate=${rotate}`;
};

// 添付ファイル(必要な項目のみ)
export interface Attachment {
  _id: string;
  originalName?: string;
  fileName?: string;
}

// GROWI の apiv3 GET ヘルパ
export const apiv3Get = async (
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const query = new URLSearchParams(params).toString();
  const url = `/_api/v3${endpoint}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`apiv3 GET failed: ${url} (${res.status})`);
  return res.json() as Promise<Record<string, unknown>>;
};

// ページパスから、そのページ ID を取得する
export const getPageIdByPath = async (pagePath: string): Promise<string | null> => {
  try {
    const data = await apiv3Get('/page', { path: pagePath });
    const d = data as Record<string, unknown>;
    const page = (d.page || (d.data as Record<string, unknown>)?.page || d) as
      | Record<string, unknown>
      | undefined;
    const id = page?._id || page?.id;
    return typeof id === 'string' ? id : null;
  } catch (e) {
    console.error('[custom-map] failed to resolve page id by path', pagePath, e);
    return null;
  }
};

// 添付一覧を「ページパス単位」でキャッシュする
const attachmentCache = new Map<string, Promise<Attachment[]>>();

// ページパスに紐づく添付一覧を取得(キャッシュ付き)
export const getAttachmentsForPage = (pagePath: string): Promise<Attachment[]> => {
  const cached = attachmentCache.get(pagePath);
  if (cached) return cached;

  const promise = (async (): Promise<Attachment[]> => {
    const pageId = await getPageIdByPath(pagePath);
    if (!pageId) return [];
    try {
      const data = await apiv3Get('/attachment/list', { pageId });
      const d = data as Record<string, unknown>;
      const list = (d.paginateResult as Record<string, unknown>)?.docs
        || d.docs
        || d.attachments
        || [];
      return Array.isArray(list) ? (list as Attachment[]) : [];
    } catch (e) {
      console.error('[custom-map] failed to fetch attachment list', pagePath, e);
      return [];
    }
  })();

  attachmentCache.set(pagePath, promise);
  return promise;
};

// 現在表示中ページの添付一覧(GROWI_CONTEXT から同期取得できる分)
const getCurrentPageAttachments = (): Attachment[] => {
  try {
    return (window as unknown as { GROWI_CONTEXT?: { page?: { attachments?: Attachment[] } } })
      .GROWI_CONTEXT?.page?.attachments || [];
  } catch {
    return [];
  }
};

const findAttachmentUrl = (attachments: Attachment[], fileName: string): string | null => {
  const found = attachments.find(
    (att) => att.originalName === fileName || att.fileName === fileName,
  );
  return found ? `/attachment/${found._id}` : null;
};

// ファイル名を、指定した候補ページ(パス)の順で探して URL を返す。見つからなければ null。
export const resolveAttachmentUrl = async (
  fileName: string,
  candidatePages: string[],
): Promise<string | null> => {
  if (!fileName) return null;

  const currentPath = (window as unknown as { GROWI_CONTEXT?: { page?: { path?: string } } })
    .GROWI_CONTEXT?.page?.path;
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

// 添付の URL と表示名(editor で使用)
export const attachmentUrl = (att: Attachment): string => `/attachment/${att._id}`;
export const attachmentName = (att: Attachment): string => att.originalName || att.fileName || att._id;

// 数値ユーティリティ
export const toNumber = (value: string | null | undefined, fallback: number): number => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// 背景色(#rgb / #rrggbb / rgb(...) 等)に対して読みやすい文字色(黒/白)を返す。
// 輝度が高い(明るい)背景なら黒、暗い背景なら白。淡色ラベルでも読めるようにする。
export const textColorForBg = (bg: string): string => {
  const rgb = parseColorToRgb(bg);
  if (!rgb) return '#ffffff'; // 解釈できないときは従来どおり白
  const { r, g, b } = rgb;
  // 相対輝度(sRGB 近似)。0(暗)〜255(明)。
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#000000' : '#ffffff';
};

// 色文字列を RGB に解釈する。#rgb / #rrggbb / rgb(r,g,b) に対応。
const parseColorToRgb = (color: string): { r: number; g: number; b: number } | null => {
  if (!color) return null;
  const c = color.trim().toLowerCase();

  // #rrggbb または #rgb
  const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((ch) => ch + ch).join('');
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }

  return null;
};
