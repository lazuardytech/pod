const KEY = "__podCloudflaredDownloadState";

function getGlobalState() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { downloading: false, progress: 0 };
  }
  return globalThis[KEY];
}

export function setDownloadState(patch = {}) {
  Object.assign(getGlobalState(), patch);
}

export function resetDownloadState() {
  setDownloadState({ downloading: false, progress: 0 });
}

export function getDownloadStatus() {
  const state = getGlobalState();
  return { downloading: state.downloading, progress: state.progress };
}
