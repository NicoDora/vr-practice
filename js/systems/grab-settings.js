// 마우스, 컨트롤러, 핸드트래킹이 함께 쓰는 Pull/Push 설정 (단위: m)
// 값을 바꾸려면 이 파일의 default를 고치거나 <a-scene grab-settings="maxDistance: 8">처럼 지정한다.
AFRAME.registerSystem("grab-settings", {
  schema: {
    minDistance: { default: 0.5 }, // 카메라나 손에서 이보다 가까이 당길 수 없다.
    maxDistance: { default: 10 }, // 이보다 멀리 밀 수 없다.
  },
});
