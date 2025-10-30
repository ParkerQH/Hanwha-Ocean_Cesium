/**
 * RailManager (rail_polygon 전용)
 * - bldg_id(+bay) 기준으로 GeoServer rail_polygon을 조회해서
 *   높이 11.0m ~ 11.2m(두께 0.2m)의 검은 레일을 올린다.
 * - 인덱스 재사용, 전역 가시성, 공장/전체 정리만 제공.
 */
import * as Cesium from "cesium";
import { BaseManager } from "../core/BaseManager.js";
import { removeEntities, closestPointOnLineLL, headingBetweenCarto, modelMatrixFromCartoHeadingScale, planarDistanceMeters } from "../core/entityutils.js";
import { LAYERS, DEFAULTS, WFS_TYPES, MODELS } from "../core/constants.js";
import { DataFetcher } from "../service/DataFetcher.js";


export class RailManager extends BaseManager {
  constructor(deps, opts = {}) {
    super(deps);

    // rail_line 전용 fetcher
    this.lfetcher = new DataFetcher({
      wfsBase: deps?.fetcher?.wfsBase,
      srs: deps?.fetcher?.srs,
      typeName: WFS_TYPES.RAIL_LINE || "HanWha_map:rail_line",
    });

    this.visible = true;
    this.index = new Map(); // "bldg::bay::line" -> Entity
    this._lines = new Map(); // "bldg::bay" -> [line1LL, line2LL] (크레인 배치용)
    this._crane = new Map(); // "ble" -> Model
    this._craneMid = new Map(); // "ble" -> 3D 모델 Middle Point

    this.baseH = Number(DEFAULTS.RAIL_BASE_HEIGHT ?? 11.0); // 높이
    this.thick = Number(DEFAULTS.RAIL_THICKNESS ?? 0.2);    // 두께
    this.widthM = Number(DEFAULTS.RAIL_WIDTH_M ?? 1.0);     // 폭
  }

  // 인덱스 키(중복 방지)
  _key(prop = {}) {
    const bldg = prop.bldg_id ?? "";
    const bay = prop.bay ?? "";
    const line = (prop.line ?? "") + "";
    return (bldg && bay !== "" && line !== "") ? `${bldg}::${bay}::${line}` : null;
  }

  // LineString 좌표배열 -> Corridor로 생성/재사용 
  _addOrReuseCorridor(lineLL, props) {
    if (!Array.isArray(lineLL) || lineLL.length < 2) return null;

    // props.line이 없는 경우 중복 방지를 위해 임시 라인키 보강
    const prop = { ...props };
    if (prop.line == null) prop.line = `${lineLL[0]?.[0] ?? 0},${lineLL[0]?.[1] ?? 0}::${lineLL.length}`;

    const key = this._key(prop);
    if (key) {
      const exist = this.index.get(key);
      if (exist && this.viewer.entities.contains(exist)) {
        exist.show = exist.show && this.visible;
        return exist;
      }
      if (exist && !this.viewer.entities.contains(exist)) this.index.delete(key);
    }

    const positions = lineLL.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
    const ent = this.viewer.entities.add({
      corridor: {
        positions,
        width: this.widthM,
        height: this.baseH,
        extrudedHeight: this.baseH + this.thick,
        material: Cesium.Color.MEDIUMBLUE,
        cornerType: Cesium.CornerType.MITERED,
        shadows: Cesium.ShadowMode.DISABLED,
      },
      show: this.visible,
      layerTag: LAYERS.RAIL,
      rawData: { bldg_id: prop.bldg_id },
    });

    if (key) this.index.set(key, ent);
    this.requestRender();
    return ent;
  }

  // 로드: pairs("bldg::bay") 또는 bldgIds
  async load({ pairs = [], bldgIds = [] } = {}) {
    let cql = null;
    if (pairs.length) {
      const items = pairs
        .map(v => {
          const [bldg, bay] = String(v).split("::");
          return bldg && bay ? `(bldg_id='${bldg}' AND bay='${bay}')` : null;
        })
        .filter(Boolean);
      if (!items.length) return 0;
        cql = `(${items.join(" OR ")})`;
      } else if (bldgIds.length) {
        const ids = [...new Set(bldgIds.map(String))];
        cql = `(${ids.map(bldg => `bldg_id='${bldg}'`).join(" OR ")})`;
      } else {
        return 0;
      }

    const json = await this.lfetcher.wfsGet({ cql });
    const features = json?.features ?? [];
    for (const feature of features) {
      const prop = feature.properties || {};
      const geom = feature.geometry;
      if (!geom) continue;

      const add = (coords) => this._addOrReuseCorridor(coords, prop);
      if (geom.type === "LineString") add(geom.coordinates);
      else if (geom.type === "MultiLineString") (geom.coordinates || []).forEach(add);
    }
    this.applyVisibility(this.visible);
    return features.length;
  }

  // rail_line 2개 캐시
  async getLines(bldg_id, bay) {
    const key = `${bldg_id}::${bay}`;
    if (this._lines.has(key)) return this._lines.get(key);
    let cql;
    if (bldg_id=="073"||bldg_id=="064"){
      cql = `(bldg_id='${bldg_id}')`;
    }
    else {
      cql = `(bldg_id='${bldg_id}' AND bay='${bay}')`;
    }
    const json = await this.lfetcher.wfsGet({ cql });
    const features = json?.features ?? [];
    const lines = [];
    for (const feature of features) {
      const geom = feature.geometry;
      if (geom?.type === "LineString") lines.push(geom.coordinates);
      else if (geom?.type === "MultiLineString") lines.push(geom.coordinates[0] || []);
    }
    const valid = lines.filter(a => a?.length >= 2);
    if (valid.length >= 2) {
      const pair = [valid[0], valid[1]];
      this._lines.set(key, pair);
      return pair;
    }
    return [];
  }

  // 센서 -> 라인 투영 기반 GLB 배치
  async placeCraneOn({ bldg_id, bay, bleId, sensorCarto }) {
    const key = `${bldg_id}::${bay}`;
    const lines = this._lines.get(key);
    if (!lines || lines.length < 2 || !sensorCarto) return null;

    // 1) 센서점 -> 각 라인의 수직 투영점
    const point1 = closestPointOnLineLL(sensorCarto, lines[0]);
    const point2 = closestPointOnLineLL(sensorCarto, lines[1]);

    // 1-1) 말풍선 배치를 위한 모델 중심 좌표
    const mid = new Cesium.Cartographic(
      (point1.longitude + point2.longitude) / 2,
      (point1.latitude + point2.latitude) / 2,
      (DEFAULTS.EXTRUDED_HEIGHT ?? 10) + 1.0
    )
    this._craneMid.set(bleId, mid);

    // 2) 오리진 = 중점(z=상수), 방향=a->b
    const origin = new Cesium.Cartographic(point1.longitude, point1.latitude, DEFAULTS.CRANE_HEIGHT);

    // 3) 방향/스케일
    const heading = Cesium.Math.toRadians(90) - headingBetweenCarto(point1, point2);

    // 4) X축 스케일 = (a-b 거리) / 모델 원본 X 길이
    const dist = Math.max(0, planarDistanceMeters(point1, point2)); // m
    const base = Number(DEFAULTS.CRANE_BASE_SCALE ?? 1);
    const native = Number(DEFAULTS.CRANE_NATIVE_SPAN_M ?? 1);
    const scaleX = base;
    const scaleY = base * (native > 0 ? (dist / native) : 1);
    const scaleZ = base;

    const modelMatrix = modelMatrixFromCartoHeadingScale(origin, heading, scaleX, scaleY, scaleZ);

    const crane_key = `${bleId}`
    let model = this._crane.get(crane_key);
    if (!model || model.isDestroyed?.()) {
      const created = Cesium.Model.fromGltfAsync
        ? await Cesium.Model.fromGltfAsync({ url: MODELS.OVERHEAD_CRANE_URI, modelMatrix, show: true })
        : Cesium.Model.fromGltf({ url: MODELS.OVERHEAD_CRANE_URI, modelMatrix, show: true });
      this.viewer.scene.primitives.add(created);
      model = created;
      this._crane.set(crane_key, model);
    } else {
      model.modelMatrix = modelMatrix;
      model.show = true;
    }
    this.requestRender();
    return model;
  }

  getCraneMid(bleId) {
    return this._craneMid.get(bleId) || null;
  }

  removeCrane(bleId) {
    const key = `${bleId}`;
    const model = this._crane.get(key);
    if (model && !model.isDestroyed?.()) {
      try { this.viewer.scene.primitives.remove(model); } catch {}
    }
    this._crane.delete(key);
    this._craneMid.delete(key);
    this.requestRender();
  }

  // 가시성
  applyVisibility(on) {
    this.visible = !!on;
    this.viewer.entities.values.forEach(ent => {
      if (ent.layerTag === LAYERS.RAIL) ent.show = ent.show && this.visible;
    });
    this.requestRender();
  }

  // 공장 단위 제거
  removeByBuilding(bldg_id) {
    const toRemove = [];
    this.viewer.entities.values.forEach(ent => {
      if (ent.layerTag !== LAYERS.RAIL) return;
      if (String(ent?.rawData?.bldg_id) === String(bldg_id)) toRemove.push(ent);
    });
    removeEntities(this.viewer, toRemove);

    for (const [key, entry] of Array.from(this.index.entries())) {
      if (String(entry?.rawData?.bldg_id) === String(bldg_id)) this.index.delete(key);
    }
    // 라인/모델 캐시도 정리
    for (const key of Array.from(this._lines.keys()))
      if (key.startsWith(`${bldg_id}::`)) this._lines.delete(key);
    for (const key of Array.from(this._crane.keys())) {
      if (key.startsWith(`${bldg_id}::`)) this.removeCrane(bldg_id, key.split("::")[1]);
    }
  }
}

