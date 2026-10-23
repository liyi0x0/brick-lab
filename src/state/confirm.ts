import { create } from 'zustand';

export interface ConfirmRequest {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** 提供时显示输入框（用于重命名） */
  input?: string;
  resolve: (v: string | boolean | null) => void;
}

/** 应用内确认框的状态（打开时全局快捷键与其它对话框都应让路） */
export const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

export function isConfirmOpen() {
  return useConfirmStore.getState().req !== null;
}

function ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    // 同一时间只保留一个请求，旧请求视为取消
    const prev = useConfirmStore.getState().req;
    prev?.resolve(prev.input !== undefined ? null : false);
    useConfirmStore.setState({ req: { ...req, resolve } });
  });
}

/** 应用内确认框（替代 window.confirm，外观统一且在受限环境中可用） */
export async function askConfirm(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}) {
  return (await ask({ message, ...opts })) === true;
}

/** 应用内输入框（替代 window.prompt），取消返回 null */
export async function askText(message: string, initial: string): Promise<string | null> {
  const v = await ask({ message, input: initial });
  return typeof v === 'string' ? v : null;
}
