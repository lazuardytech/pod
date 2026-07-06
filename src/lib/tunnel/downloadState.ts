interface DownloadState {
  downloading: boolean;
  progress: number;
}

declare global {
  var __podCloudflaredDownloadState: DownloadState | undefined;
}

function getGlobalState(): DownloadState {
  if (!globalThis.__podCloudflaredDownloadState) {
    globalThis.__podCloudflaredDownloadState = { downloading: false, progress: 0 };
  }
  return globalThis.__podCloudflaredDownloadState;
}

export function setDownloadState(patch: Partial<DownloadState> = {}) {
  Object.assign(getGlobalState(), patch);
}

export function resetDownloadState() {
  setDownloadState({ downloading: false, progress: 0 });
}

export function getDownloadStatus(): DownloadState {
  const state = getGlobalState();
  return { downloading: state.downloading, progress: state.progress };
}
