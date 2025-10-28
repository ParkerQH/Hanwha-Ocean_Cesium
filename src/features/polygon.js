/** 
 * ColumnManager
 * 회색 기둥 로딩/인덱싱/가시성/삭제 담당
 * 인덱스 키 "bldg::id"
 */
import * as Cesium from "cesium";
import { BaseManager } from "../core/BaseManager.js";
import { ringsFromFeature, removeEntities } from "../core/entityutils.js";
import { LAYERS, DEFAULTS } from "../core/constants.js";

export class ColumnManager extends BaseManager {
    constructor(deps) {
        super(deps);
        this.visible = true;
        this.index = new Map(); // "bldg::id" -> Entity
    }    

    // props로부터 인덱스 키 생성
    _key(props = {}) {
        const b = props.bldg_id ?? "";
        const id = props.id;
        return (b && (id !== undefined && id !== null)) ? `${b}::${id}` : null;
    }

    // 회색 폴리곤 엔티티 생성/재사용
    _addOrReusePolygon(ring, props) {
        const key = this._key(props);

        if (key) {
            const exist = this.index.get(key);
            if (exist && this.viewer.entities.contains(exist)) { 
                exist.show = exist.show && this.visible; 
                return exist; 
            }
            if (exist && !this.viewer.entities.contains(exist)) 
                this.index.delete(key); 
        }

        const ent = this.viewer.entities.add({
            polygon: {
                hierarchy: ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
                extrudedHeight: DEFAULTS.EXTRUDED_HEIGHT,
                material: Cesium.Color.MEDIUMBLUE,
                shadows: Cesium.ShadowMode.DISABLED,
            },
            show: this.visible,
            layerTag: LAYERS.COLUMN,
        });
        // ent.rawData = props || null;    // 선택 기둥 전테 정보 보기 용도
        ent.rawData = { bldg_id: props.bldg_id, column_id: props.id };

        if (key) this.index.set(key, ent);
        this.requestRender();
        
        return ent;
    }

    // (공장/BAY/페어) 조건으로 회색 기둥 로딩
    async load({ bldgIds=[] } = {}) {
        const feats = await this.fetcher.fetchColumns({ bldgIds });
        for (const f of feats) {
            const p = f.properties || {};
            for (const r of ringsFromFeature(f)) this._addOrReusePolygon(r, p);
        }
        this.applyVisibility(this.visible);
    }

    // 전역 가시성(회색/강조 동시 적용)
    applyVisibility(on) {
        this.visible = !!on;
        this.viewer.entities.values.forEach(e => {
            if (e.layerTag === LAYERS.COLUMN) { 
                e.show = e.show && this.visible;
            } else if (e.layerTag === LAYERS.HIGHLIGHT) {
                e.show = this.visible;
            }
        });
        this.requestRender();
    }

    // 특정 (bldg,id) 회색 기둥 show 토글
    setShow(bldg_id, columnId, show) {
        const key = `${bldg_id}::${columnId}`;
        const ent = this.index.get(key);
        if (ent && this.viewer.entities.contains(ent)) {
            ent.show = !!show && this.visible;
            return;
        }
    }

    // 공장 단위 엔티티/인덱스 정리
    removeByBuilding(bldgId) {
        const bid = String(bldgId);
        const remove = [];
        this.viewer.entities.values.forEach(e => {
        if (e.layerTag === LAYERS.COLUMN) {
            const eb = String(e.rawData?.bldg_id ?? "");
            if (eb === bid) remove.push(e);
        }
        });
        removeEntities(this.viewer, remove);

        for (const [k, ent] of Array.from(this.index.entries())) {
            const eb = String(ent?.rawData?.bldg_id ?? "");
            if (eb === bid) this.index.delete(k);
        }
    }
}
