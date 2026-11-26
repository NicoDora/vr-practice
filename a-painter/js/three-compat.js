/* global THREE */
// A-Painter 원본 코드는 예전 three.js 이름을 쓰는데, A-Frame 1.3에 들어 있는 three.js(r144)에는 없다.
// 원본 코드를 고치지 않고 예전 이름을 연결해 둔다. (build.js보다 먼저 불러와야 함)

// THREE.Math → THREE.MathUtils
// ui.js 밝기·굵기 슬라이더, paint-controls.js 굵기 조절에서 쓴다. 없으면 오류로 렌더링이 멈춘다.
if (!THREE.Math && THREE.MathUtils) {
  THREE.Math = THREE.MathUtils;
}

// THREE.VertexColors → true
// 예전에는 상수였지만 지금은 material.vertexColors가 true/false 값이다.
// line, stamp 브러시가 이 이름으로 정점 색을 켜는데, 없으면 정점 색이 꺼져서 모든 선이 하얗게 그려진다.
if (THREE.VertexColors === undefined) {
  THREE.VertexColors = true;
}
