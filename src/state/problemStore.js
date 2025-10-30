// 문제 상태 저장소("bldg::id")
import { removeEntity } from "../core/entityutils.js";

export class ProblemStore {
    constructor() { this.map = new Map(); }
    _key(bldg_id, columnId) { return `${bldg_id}::${columnId}`; }

    // 문제 오픈(없으면 생성, 있으면 status만 open으로)
    open(bldg_id, columnId) {
        const key = this._key(bldg_id, columnId);
        const r = this.map.get(key);
        if (!r) this.map.set(key, { status: "open", entities: [], meta: { bldg_id, columnId } });
        else r.status = "open";
    }

    // 문제 해결
    resolve({ viewer, bldg_id, columnId, onEmpty }) {
        const key = this._key(bldg_id, columnId);
        const problemEnt = this.map.get(key);
        if (!problemEnt || problemEnt.status !== "open") return false;

        const removedMeta = []; // 제거되는 강조

        for (const ent of problemEnt.entities || []) {
        if (ent?.rawData) removedMeta.push(ent.rawData);
            removeEntity(viewer, ent);
        }
        problemEnt.entities = [];
        problemEnt.status = "resolved";
        
        if (typeof onEmpty === "function") 
            onEmpty({ removedMeta });

        return true;
    }

    // 강조 엔티티를 문제 레코드에 추가
    addEntities(bldg_id, columnId, ents=[]) {
        const problemEnt = this.map.get(this._key(bldg_id, columnId));
        if (problemEnt) problemEnt.entities = (problemEnt.entities || []).concat(ents);
    }

    // 열려있는 문제 목록/건물 집합
    listOpen() { return [...this.map.values()].filter(problemEnt => problemEnt.status === "open").map(problemEnt => problemEnt.meta); }
    openBuildings() {
        const setup = new Set();
        for (const problemEnt of this.map.values()) if (problemEnt.status === "open" && problemEnt.meta?.bldg_id) setup.add(String(problemEnt.meta.bldg_id));
        return setup;
    }
}
