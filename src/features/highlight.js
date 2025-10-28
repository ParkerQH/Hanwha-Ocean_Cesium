/** 
 * HighlightManager
 * 문제 상태(ProblemStore)와 연동하여 하이라이트(빨간 기둥) 생성/정리
 * 키는 (bldg,id)만 저장.
 */
import * as Cesium from "cesium";
import { BaseManager } from "../core/BaseManager.js";
import { ringsFromFeature, removeEntities } from "../core/entityutils.js";
import { LAYERS, DEFAULTS } from "../core/constants.js";

export class HighlightManager extends BaseManager {
    constructor(deps, columnManager, problemStore) {
        super(deps);
        this.cm = columnManager;
        this.store = problemStore; // 외부 상태 주입(열림/해결/목록 등)
    }

    // 내부: 빨간 폴리곤 엔티티 생성(단일)
    _addRed(ring, raw, h=DEFAULTS.HIGHLIGHT_HEIGHT) {
        const ent = this.viewer.entities.add({
            polygon: {
                hierarchy: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
                extrudedHeight: h,
                material: Cesium.Color.RED,
                shadows: Cesium.ShadowMode.DISABLED,
            },
            show: this.cm.visible,
            layerTag: LAYERS.HIGHLIGHT,
        });
        ent.rawData = raw || null;
        return ent;
    }

    // 공통: Feature 하나에 대해 하이라이트 엔티티들 생성
    addForFeature(f, raw=null, h=DEFAULTS.HIGHLIGHT_HEIGHT) {
        const fp = f.properties ?? {};
        const meta = raw ?? {};
        const bldg_id = fp.bldg_id ?? meta.bldg_id;
        const column_id = meta.id ?? fp.id;
        // const bay = normalizeBay(meta.bay ?? fp.bay);

        const made = [];
        for (const ring of ringsFromFeature(f)) {
            made.push(this._addRed(ring, { bldg_id, column_id }, h));
        }
        // 같은 (bldg,id) 회색 OFF
        if (bldg_id != null && column_id != null) this.cm.setShow(bldg_id, column_id, false);

        this.requestRender();
        return made;
    }

    // 문제 오픈(스토어에 상태만 기록; 엔티티는 addForFeature에서 연결)
    report({ bldg_id, columnId }) {
        this.store.open(bldg_id, columnId);
    }

    // 문제 해결
    resolve({ bldg_id, columnId }) {
        const ok = this.store.resolve({
            viewer: this.viewer,
            bldg_id, columnId,
            onEmpty: ({ removedMeta=[] } = {}) => {
                // 남은 게 없으면 회색 복구(문제 + 매핑 모두)
                this.cm.setShow(bldg_id, columnId, true);

                // 연쇄로 같이 꺼져 있던 매핑 기둥들도 복구
                for (const rd of removedMeta) {
                    const bid = rd?.bldg_id ?? bldg_id;
                    const cid = rd?.id;
                    if (bid != null && cid != null) this.cm.setShow(bid, cid, true);
                }

                // 동일 (bldg,id) 하이라이트 제거
                const sweep = [];
                this.viewer.entities.values.forEach(e => {
                if (e.layerTag === LAYERS.HIGHLIGHT) {
                    const rd = e.rawData || {};
                    if (String(rd.bldg_id ?? "") === String(bldg_id) &&
                        String(rd.id ?? "") === String(columnId)) {
                    sweep.push(e);
                    }
                }
                });
                removeEntities(this.viewer, sweep);

                // 이 공장에 더 이상 열린 문제가 없으면 회색 기둥도 모두 제거
                const opens = this.store.openBuildings(); // Set<string>
                if (!opens.has(String(bldg_id))) {
                    this.cm.removeByBuilding?.(bldg_id);
                }
            }
        });
        this.requestRender();
        return ok;
    }

    // 조회 편의
    listOpen() { return this.store.listOpen(); }
    getOpenBuildings() { return this.store.openBuildings(); }

    // 단일 기둥 하이라이트
    async highlightSingle(bldg_id, columnId) {
        const f = await this.fetcher.getColumnById(bldg_id, columnId);
        if (!f) return;
        this.report({ bldg_id, columnId });
        const ents = this.addForFeature(f, { bldg_id, column_id: Number(columnId) });
        this.store.addEntities(bldg_id, columnId, ents);
    }
}
