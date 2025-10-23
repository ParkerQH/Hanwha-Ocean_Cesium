// Feature Manager들의 공통 베이스
// 의존성(viewer, fetcher) 주입
export class BaseManager {
    constructor({ viewer, fetcher }) {
        this.viewer = viewer;
        this.fetcher = fetcher;
    }

    // requestRenderMode 다시 그리기
    requestRender() {
        const s = this.viewer?.scene;
        if (s?.requestRenderMode) s.requestRender();
    }
}