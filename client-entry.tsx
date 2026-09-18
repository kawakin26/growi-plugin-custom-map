import { activateViewer, deactivateViewer } from './src/viewer';
import { activateEditor, deactivateEditor } from './src/editor';
import { activateRegister, deactivateRegister } from './src/register';

// ============================================================
// growi-plugin-custom-map エントリポイント
//
// 表示(viewer)機能と 編集(editor)機能を起動する。
// 各機能は独立した try-catch で起動し、片方が失敗しても他方に影響しない
// ようにする(リスク分離)。例えば編集機能はエディタ DOM に依存するため
// GROWI のアップデートで壊れる可能性があるが、その場合でも表示機能は動く。
// ============================================================

export const activate = (): void => {
  try {
    activateViewer();
  } catch (e) {
    console.error('[custom-map] viewer activate failed', e);
  }
  try {
    activateEditor();
  } catch (e) {
    console.error('[custom-map] editor activate failed', e);
  }
  try {
    activateRegister();
  } catch (e) {
    console.error('[custom-map] register activate failed', e);
  }
};

export const deactivate = (): void => {
  try {
    deactivateViewer();
  } catch (e) {
    console.error('[custom-map] viewer deactivate failed', e);
  }
  try {
    deactivateEditor();
  } catch (e) {
    console.error('[custom-map] editor deactivate failed', e);
  }
  try {
    deactivateRegister();
  } catch (e) {
    console.error('[custom-map] register deactivate failed', e);
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
