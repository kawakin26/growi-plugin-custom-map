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
