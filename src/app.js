import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import * as turf from '@turf/turf';
import buildingData from './buildings.json';

import { loadPolygonColumns, 
    highlightMappedColumnsAll, 
    setColumnsVisibility,
    resolveProblem,
    listOpenProblems, 
    lookupColumnRaw,
    getOpenProblemBuildings,
} from "./polygon.js";

// app.js
// import {
//   loadPointColumns,           // 로더
//   highlightMappedColumnsAll,  // 신고/강조 트리거
//   setColumnsVisibility,       // 가시성 토글
//   resolveProblem,             // 문제 해제
//   reportProblem,              // 문제 등록(상태만)
//   listOpenProblems,           // (옵션) 목록 확인
// } from './point.js';


// Cesium token
function getCesiumToken() {
    try {
        if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_CESIUM_TOKEN) {
          return import.meta.env.VITE_CESIUM_TOKEN;
        }
    } catch (_) {}
    return window.CESIUM_TOKEN || "";
}
Cesium.Ion.defaultAccessToken = getCesiumToken();

// Viewer
const viewer = new Cesium.Viewer("cesiumContainer", {
    geocoder: false,              // 검색창
    homeButton: false,            // 집 모양 버튼
    sceneModePicker: false,       // 2D/3D 모든 변환
    baseLayerPicker: false,       // 베이스 맴 선택
    navigationHelpButton: false,  // 도움말 버튼
    timeline: false,              // 하단 타임라인 버튼
    animation: false,             // 애니메이션 컨롤러
    fullscreenButton: false,      // 전체 화면
    infoBox: false,               // 픽셀 정보 박스 제거
    selectionIndicator: false,    // 클릭 테두리 제거
});
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.pickTranslucentDepth = true;
viewer.clock.shouldAnimate = true;           // 박스 성장 애니메이션용
viewer.scene.requestRenderMode = true; 

// 폴리곤 데이터 WMS
// const polygondata = new Cesium.WebMapServiceImageryProvider({
//     url: "/geoserver/HanWha_map/wms",
//     layers: "HanWha_map:polygon_data",
//     parameters: {
//         service: "WMS",
//         version: "1.1.1",
//         request: "GetMap",
//         format: "image/png",
//         transparent: true
//     },
// })
// viewer.imageryLayers.addImageryProvider(polygondata);

// 베이스맵 한화 오션
const basemap = new Cesium.WebMapServiceImageryProvider({
    url: "/geoserver/HanWha_map/wms",
    layers: "HanWha_map:ortho_v1",
    parameters: {
        service: "WMS",
        version: "1.1.1",
        request: "GetMap",
        format: "image/png",
        transparent: true,
    },
});
viewer.imageryLayers.addImageryProvider(basemap);

// 초기 카메라
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(128.6999, 34.8645, 250.0), // 위치(3공장 기준)
  orientation: {
    heading: Cesium.Math.toRadians(38),     // 시계방향, 0 = 북
    pitch: Cesium.Math.toRadians(-35.0),    // 위/아래 각도, 0 = 수평, -90
    roll: 0,
  },
});

const buildingSelect = document.getElementById("buildingSelect");
const baySelect = document.getElementById("baySelect");
const searchBtn = document.getElementById("searchBtn");
const resetBtn  = document.getElementById("resetBtn");
const infoBody = document.getElementById("infoBody");

const inpBldg    = document.getElementById("inpBldg");
const inpColId   = document.getElementById("inpColId");
const inpBay     = document.getElementById("inpBay");
const btnReport  = document.getElementById("btnReport");
const btnResolve = document.getElementById("btnResolve");


// 기둥 드롭다운 초기화
buildingData.forEach((b) => {
    const option = document.createElement("option");
    option.value = b.bldg_id;
    option.textContent = b.name;
    buildingSelect.appendChild(option);
});

buildingSelect.addEventListener("change", () => {
  const selectedBldgIds = Array.from(buildingSelect.options)
    .filter(o => o.selected && o.value)
    .map(o => o.value);

  baySelect.innerHTML = '<option value="" disabled>BAY 선택</option>';

  if (selectedBldgIds.length === 0) {
    baySelect.disabled = true;
    return;
  }

  const options = [];
  selectedBldgIds.forEach((bldgId) => {
    const b = buildingData.find(x => x.bldg_id === bldgId);
    if (!b?.bays?.length) return;
    b.bays.forEach((bay) => {
      options.push({
        value: `${bldgId}::${bay}`,
        label: `${b.name}_${bay}`,
        sortKey: `${b.name}_${bay}`,
      });
    });
  });

  options.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'ko', { numeric: true }));
  options.forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    baySelect.appendChild(opt);
  });

  baySelect.disabled = options.length === 0;
});


// 검색 버튼 -> 회색 기둥
searchBtn.addEventListener("click", () => {
  const selectedPairs = Array.from(baySelect.options)
    .filter(o => o.selected && o.value)
    .map(o => o.value);

  const selectedBldgIds = Array.from(buildingSelect.options)
    .filter(o => o.selected && o.value)
    .map(o => o.value);

  if (selectedPairs.length > 0) {
    loadPolygonColumns(viewer, { pairs: selectedPairs });
  } else {
    loadPolygonColumns(viewer, { bldgIds: selectedBldgIds });
  }
});

// 초기화 버튼 -> 회색 기둥 없애지
resetBtn.addEventListener("click", () => {
  const protect = getOpenProblemBuildings();

  const toRemove = [];
  viewer.entities.values.forEach(e => {
    if (e.layerTag === 'columns') {
      const bid =
        e.rawData?.bldg_id ??
        e.rawData?.BLDG_ID ??
        null;
      // 'open' 문제가 있는 공장은 보존
      if (!bid || !protect.has(String(bid))) {
        toRemove.push(e);
      }
    }
  });
  toRemove.forEach(e => viewer.entities.remove(e));

  if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
});

// 클릭 시 속성 콘솔 출력
const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction(function (movement) {
  if (viewer.scene.requestRenderMode) viewer.scene.requestRender(); // 최신 프레임 보장

  // 1) 겹침 고려: drillPick으로 모두 가져오기
  const hits = viewer.scene.drillPick(movement.position, 16);

  // 2) columns(회색 기둥) 우선
  const hitColumns = hits.find(h => h.id?.layerTag === 'columns')?.id ?? null;
  const hitHighlight = hits.find(h => h.id?.layerTag === 'problemHighlight')?.id ?? null;

  // 3) 둘 다 없으면 1회 pick 폴백
  const hitEntity =
    hitColumns ||
    hitHighlight ||
    (viewer.scene.pick(movement.position)?.id ?? null);

  if (hitEntity) {
    // 강조만 잡혔으면 meta로 원본 기둥 rawData를 역참조
    let data = hitEntity.rawData ?? {};
    if (hitEntity.layerTag === 'problemHighlight') {
      data = lookupColumnRaw(data); // meta(bldg_id/bay/column_id) -> 원본 기둥 rawData
    }

    console.log("=== 선택 기둥 정보 ===", data);
    try {
      const pretty = JSON.stringify(data, null, 2);
      infoBody.textContent = pretty && pretty !== "{}" ? pretty : "(rawData 없음)";
    } catch (_) {
      infoBody.textContent = "(rawData 없음)";
    }
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

btnReport.addEventListener("click", () => {
  const bldg = inpBldg.value; // 문자열
  const col  = +inpColId.value; // 숫자 변환
  const bay  = inpBay.value.toUpperCase(); // 문자열
  highlightMappedColumnsAll(viewer, bldg, col, bay);
});


btnResolve.addEventListener("click", () => {
  const bldg = inpBldg.value; // 문자열
  const col  = +inpColId.value; // 숫자 변환
  const bay  = inpBay.value.toUpperCase();  // 문자열
  resolveProblem(viewer, { bldg_id: bldg, columnId: col, bay });
});

window.reloadColumns = (bldgIds = [], bays = []) =>
  loadPolygonColumns(viewer, { bldgIds, bays });

window.toggleColumns = (on) =>
  setColumnsVisibility(viewer, !!on);

window.highlightMappedColumnsAll = (bldg_id, inputColumnId, inputBay) =>
  highlightMappedColumnsAll(viewer, bldg_id, inputColumnId, inputBay);

window.resolveProblem = (bldg_id, columnId, bay) =>
  resolveProblem(viewer, { bldg_id, columnId, bay });

window.listOpenProblems = () => listOpenProblems();