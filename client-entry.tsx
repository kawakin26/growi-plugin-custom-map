import { activateViewer, deactivateViewer } from './src/viewer';

// ============================================================
// growi-plugin-custom-map エントリポイント
//
// 表示(viewer)機能を起動する。編集(editor)機能は次段で追加する。
// 各機能は独立した try-catch で起動し、片方が失敗しても他方に影響しない
// ようにする(リスク分離)。
// ============================================================

export const activate = (): void => {
  try {
    activateViewer();
  } catch (e) {
    console.error('[custom-map] viewer activate failed', e);
  }
};

export const deactivate = (): void => {
  try {
    deactivateViewer();
  } catch (e) {
    console.error('[custom-map] viewer deactivate failed', e);
  }
};

// ============================================================
// プラグインアクティベーターの登録
// ============================================================
const pluginDefinition = {
  activate,
  deactivate,
  activatePlugin: activate,
  deactivatePlugin: deactivate,
};

if (typeof window !== 'undefined') {
  const w = window as unknown as { pluginActivators?: Record<string, unknown> };
  w.pluginActivators = w.pluginActivators || {};
  w.pluginActivators['growi-plugin-custom-map'] = pluginDefinition;
}

export default pluginDefinition;
