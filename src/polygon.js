import * as Cesium from 'cesium';
import * as turf from '@turf/turf';

// 문제(미해결) 상태 저장소
const problemStore = new Map(); // key -> { status: 'open'|'resolved', entities: Cesium.Entity[], meta }
let columnsVisible = true;      // 전체 기둥 & 강조 가시성 토글

function problemKey(bldg_id, bay, columnId) {
  return `${bldg_id}::${bay ?? ''}::${columnId}`;
}

// 문제가 되는 기둥
export function reportProblem(viewer, { bldg_id, columnId, bay }) {
  const key = problemKey(bldg_id, bay, columnId);
  const rec = problemStore.get(key);
  if (!rec) {
    problemStore.set(key, { status: 'open', entities: [], meta: { bldg_id, bay, columnId } });
  } else {
    rec.status = 'open';
  }
}

// 문제가 되는 기둥이 속한 공장
export function getOpenProblemBuildings() {
  const set = new Set();
  for (const rec of problemStore.values()) {
    if (rec.status === 'open' && rec.meta?.bldg_id) {
      set.add(String(rec.meta.bldg_id));
    }
  }
  return set;
}

// 해당 공장에 open 문제가 남아있는지 여부
function hasOpenProblemsInBuilding(bldgId) {
  const bid = String(bldgId);
  for (const rec of problemStore.values()) {
    if (rec.status === 'open' && String(rec.meta?.bldg_id) === bid) return true;
  }
  return false;
}

// 해당 공장의 전체 기둥 삭제
function removeColumnsByBuilding(viewer, bldgId) {
  const bid = String(bldgId);
  const toRemove = [];
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'columns') {
      const ebid = e.rawData?.bldg_id ?? e.rawData?.BLDG_ID ?? null;
      if (ebid && String(ebid) === bid) toRemove.push(e);
    }
  });
  toRemove.forEach(e => viewer.entities.remove(e));

  if (typeof columnIndex !== "undefined" && columnIndex?.size) {
    for (const [k, ent] of Array.from(columnIndex.entries())) {
      const ebid = ent?.rawData?.bldg_id ?? ent?.rawData?.BLDG_ID ?? null;
      if (ebid && String(ebid) === bid) columnIndex.delete(k);
    }
  }
}

export function resolveProblem(viewer, { bldg_id, columnId, bay }) {
  const key = problemKey(bldg_id, bay, columnId);
  const rec = problemStore.get(key);
  if (!rec) return false;

  // 1) 상태 변경 + 이 이슈의 빨간 강조 제거
  rec.status = 'resolved';
  if (Array.isArray(rec.entities) && rec.entities.length) {
    rec.entities.forEach(e => viewer.entities.remove(e));
    rec.entities = [];
  }

  // 2) 이 공장에 남아있는 open 문제가 하나도 없으면, 공장 기둥 전체 제거
  if (!hasOpenProblemsInBuilding(bldg_id)) {
    removeColumnsByBuilding(viewer, bldg_id);
  }

  if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
  return true;
}


export function listOpenProblems() {
  return Array.from(problemStore.values())
    .filter(r => r.status === 'open')
    .map(r => r.meta);
}

export function setColumnsVisibility(viewer, visible) {
  columnsVisible = !!visible;
  // columns / problemHighlight 공통 반영
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'columns' || e.layerTag === 'problemHighlight') {
      e.show = columnsVisible;
    }
  });
}

// 기둥 인덱스 (강조 -> 기둥 역참조)
const columnIndex = new Map(); // key -> entity

function columnKeyFromProps(p = {}) {
  const b = p.bldg_id ?? p.BLDG_ID ?? "";
  const bay = p.pre_bay ?? p.next_bay ?? p.BAY ?? "";
  const id = p.id ?? p.pre_id ?? p.next_id ?? p.column_id ?? p.COLUMN_ID ?? "";
  if (!b || !id) return null;
  return `${b}::${bay}::${id}`;
}

export function indexColumnEntity(entity) {
  const k = columnKeyFromProps(entity.rawData);
  if (k) columnIndex.set(k, entity);
}

export function lookupColumnRaw(meta = {}) {
  const b = meta.bldg_id ?? meta.BLDG_ID ?? "";
  const bay = meta.bay ?? meta.pre_bay ?? meta.next_bay ?? meta.BAY ?? "";
  const id = meta.column_id ?? meta.id ?? meta.pre_id ?? meta.next_id ?? "";
  const k = (b && id) ? `${b}::${bay}::${id}` : null;
  return (k && columnIndex.get(k)?.rawData) ? columnIndex.get(k).rawData : meta;
}

// 유틸 & 렌더 헬퍼
function toPolygonFeatures(f) {
  if (f.geometry.type === "Polygon") return [turf.polygon(f.geometry.coordinates)];
  if (f.geometry.type === "MultiPolygon") return f.geometry.coordinates.map((coords) => turf.polygon(coords));
  return [];
}

// 위로 자라는 extruded 폴리곤(회색 기둥/강조 공용)
function addAnimatedExtrudedPolygon(viewer, coords, targetHeight, opts = {}) {
  const {
    material = Cesium.Color.GRAY.withAlpha(0.7),
    outline = true,
    outlineColor = Cesium.Color.BLACK,
    duration = 0.8,
    delay = 0,
    easing = (t) => 1 - Math.pow(1 - t, 3),
    shadows = Cesium.ShadowMode.DISABLED,
    layerTag = 'columns',
    rawData = null, // 클릭시 보여줄 속성
  } = opts;

  const startTime = Cesium.JulianDate.addSeconds(
    viewer.clock.currentTime, delay, new Cesium.JulianDate()
  );

  let finalized = false;
  let entity;

  const extrudedHeightProp = new Cesium.CallbackProperty((time) => {
    if (finalized) return targetHeight;
    const elapsed = Cesium.JulianDate.secondsDifference(time, startTime);
    if (elapsed <= 0) return 0.01; // epsilon 시작 (z-fighting 완화)
    const t = Math.min(elapsed / duration, 1.0);
    const h = Math.max(0.01, targetHeight * easing(t));

    if (t >= 1 && !finalized) {
      finalized = true;
      // postRender에서 정적으로 스왑 (깜빡임 최소화)
      const once = () => {
        if (entity && entity.polygon) entity.polygon.extrudedHeight = targetHeight;
        viewer.scene.postRender.removeEventListener(once);
        if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
      };
      viewer.scene.postRender.addEventListener(once);
      return targetHeight;
    }
    return h;
  }, false);

  entity = viewer.entities.add({
    polygon: {
      hierarchy: coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      extrudedHeight: extrudedHeightProp,
      material,
      outline,
      outlineColor,
      shadows,
    },
  });
  entity.layerTag = layerTag;
  entity.show = columnsVisible;
  if (rawData) entity.rawData = rawData; // 태깅
  return entity;
}

//빨간 강조(폴리곤/멀티폴리곤 모든 링) -> 엔티티 배열 반환
function addRedExtruded(viewer, feature, height = 11) {
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((c) => c[0]);
  const made = [];
  rings.forEach((ring, idx) => {
    const ent = addAnimatedExtrudedPolygon(viewer, ring, height, {
      material: Cesium.Color.RED.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.RED,
      duration: 0.7,
      delay: idx * 0.05,
      layerTag: 'problemHighlight',
      rawData: feature.properties ?? null, // 강조도 태깅(메타)
    });
    made.push(ent);
  });
  return made;
}

//unresolved 문제에 대해 강조 생성 + registry 연결
function renderProblemHighlight(viewer, featureOrRing, { height = 11, rawData = null } = {}) {
  const made = Array.isArray(featureOrRing)
    ? addRedExtruded(
        viewer,
        { geometry: { type: "Polygon", coordinates: [featureOrRing] }, properties: rawData || null },
        height
      )
    : addRedExtruded(viewer, featureOrRing, height);

  const list = Array.isArray(made) ? made : [made];
  list.forEach(ent => { if (ent) ent.show = columnsVisible; });
  return list.filter(Boolean);
}

// 회색 기둥 로딩
export async function loadPolygonColumns(viewer, { pairs = [], bldgIds = [], bays = [] } = {}) {
  let wfsUrl =
    "/geoserver/HanWha_map/ows?" +
    "service=WFS&version=1.0.0&request=GetFeature" +
    "&typeName=HanWha_map:polygon_data" +
    "&outputFormat=application/json&srsName=EPSG:4326";

  const filters = [];

  if (pairs.length) {
    const orParts = pairs.map(v => {
      const [bid, bay] = String(v).split("::");
      if (!bid || !bay) return null;
      return `((bldg_id='${bid}') AND (pre_bay='${bay}' OR next_bay='${bay}'))`;
    }).filter(Boolean);
    if (orParts.length) filters.push("(" + orParts.join(" OR ") + ")");
  } else {
    if (bldgIds.length) filters.push("(" + bldgIds.map((id) => `bldg_id='${id}'`).join(" OR ") + ")");
    if (bays.length) {
      const bayList = bays.flatMap((b) => [`pre_bay='${b}'`, `next_bay='${b}'`]);
      filters.push("(" + bayList.join(" OR ") + ")");
    }
  }

  if (filters.length) wfsUrl += "&CQL_FILTER=" + encodeURIComponent(filters.join(" AND "));

  const res = await fetch(wfsUrl);
  const data = await res.json();

  // 회색 기둥 다시 렌더 (rawData 태깅 + 인덱싱)
  data.features.forEach((f) => {
    const { type } = f.geometry;
    const props = f.properties;

    // 키가 이미 있으면 새로 만들지 않음
    const maybeReuse = () => {
      const key = columnKeyFromProps(props);
      if (!key) return null;

      const ent = columnIndex.get(key);
      if (ent && viewer.entities.contains(ent)) {
        ent.show = columnsVisible;
        return ent;
      }
      // 인덱스가 죽은 엔티티를 가리키면 정리
      if (ent && !viewer.entities.contains(ent)) {
        columnIndex.delete(key);
      }
      return null;
    };


    const addPoly = (coords, idx = 0) => {
      // 먼저 재사용 시도
      const reused = maybeReuse();
      if (reused) return reused;

      // 없으면 새로 생성
      const ent = addAnimatedExtrudedPolygon(viewer, coords, 10, {
        material: Cesium.Color.GRAY.withAlpha(0.7),
        outline: true,
        outlineColor: Cesium.Color.BLACK,
        duration: 0.8,
        delay: idx * 0.015,
        layerTag: 'columns',
        rawData: props,
      });
      indexColumnEntity(ent);
      return ent;
    };

    if (type === "Polygon") addPoly(f.geometry.coordinates[0], 0);
    else if (type === "MultiPolygon") f.geometry.coordinates.forEach((p, i) => addPoly(p[0], i));
  });

  // 이번 조회 범위에 포함된 '미해결' 문제 자동 강조 (이미 있으면 show 동기화)
  data.features.forEach((f) => {
    const props = f.properties || {};
    const colId = props.id ?? props.pre_id ?? props.next_id;   // 실제 스키마에 맞게 조정
    const bay   = props.pre_bay ?? props.next_bay ?? null;
    const bldg  = props.bldg_id ?? null;
    if (!bldg || !colId) return;

    const key = problemKey(bldg, bay, colId);
    const rec = problemStore.get(key);
    if (rec && rec.status === 'open') {
      if (rec.entities.length === 0 && columnsVisible) {
        rec.entities = renderProblemHighlight(viewer, f, { height: 11 });
      } else {
        rec.entities.forEach(e => e.show = columnsVisible);
      }
    }
  });

  // 가시성 일괄 반영
  setColumnsVisibility(viewer, columnsVisible);
}

// 문제 강조(신고) 트리거
export async function highlightMappedColumnsAll(viewer, bldg_id, inputColumnId, inputBay) {
  // 1) 회색 기둥 (현재 건물만)
  await loadPolygonColumns(viewer, { bldgIds: [bldg_id] });

  // 2) 대상 폴리곤 조회
  const wfsUrl = `/geoserver/HanWha_map/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=HanWha_map:polygon_data&outputFormat=application/json&srsName=EPSG:4326&CQL_FILTER=${encodeURIComponent(
    `bldg_id='${bldg_id}'`
  )}`;
  const res = await fetch(wfsUrl);
  const data = await res.json();

  const isMatched = (props, bay, id) =>
    (props.pre_bay === bay && props.id === id) ||
    (props.next_bay === bay && props.id == id) ||
    (props.pre_bay === bay && props.pre_id == id) ||
    (props.next_bay === bay && props.next_id == id);

  const matched = [];
  for (const f of data.features) {
    if (isMatched(f.properties, inputBay, inputColumnId)) matched.push(f);
    if (matched.length >= 2) break;
  }
  if (!matched.length) {
    console.warn("강조 대상 폴리곤 없음");
    return;
  }

  // 3) 모든 면을 풀어 FeatureCollection 구성
  const polys = matched.flatMap(toPolygonFeatures);
  const fc = turf.featureCollection(polys);

  // 4) 두 폴리곤 중심 방위각으로 회전 좌표계에서 bbox(OBB) 산출
  let angle = 0;
  if (polys.length >= 2) {
    const c1 = turf.centroid(polys[0]);
    const c2 = turf.centroid(polys[1]);
    angle = turf.bearing(c1, c2);
  }
  const pivot = turf.center(fc).geometry.coordinates;

  const rotatedFC = turf.transformRotate(fc, -angle, { pivot });
  const obbAxisAligned = turf.bboxPolygon(turf.bbox(rotatedFC));
  const obb = turf.transformRotate(obbAxisAligned, angle, { pivot });

  // 5) buffer
  const buffered = turf.buffer(obb, 0.5, { units: "meters" });

  // 6) 상태를 open으로 기록
  reportProblem(viewer, { bldg_id, columnId: inputColumnId, bay: inputBay });
  const key = problemKey(bldg_id, inputBay, inputColumnId);
  const rec = problemStore.get(key);
  if (!rec) return;

  // 7) columnsVisible일 때만 즉시 강조 생성 (꺼져 있으면 상태만 유지)
  if (columnsVisible && rec.entities.length === 0) {
    // 강조 rawData는 최소 메타로 구성
    const meta = { bldg_id, bay: inputBay, column_id: inputColumnId };
    rec.entities = renderProblemHighlight(viewer, buffered, { height: 11, rawData: meta });
  }
}
