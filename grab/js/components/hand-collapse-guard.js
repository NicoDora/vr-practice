// 손이 카메라 시야를 벗어나면 Quest가 "추적 중"이라고 하면서 모든 관절을 한 점에 모아 보낼 때가 있다.
// 그러면 손 모델이 엉뚱한 곳(머리 근처)에 나타나 앞을 가리고, 엄지·검지가 붙어 있어 핀치로도 인식된다.
// 손목~검지 끝이 minHandSize보다 짧으면 추적이 끊긴 것으로 처리한다. (실제 손은 약 15cm)
// hasPoses를 false로 바꾸면 hand-tracking-controls가 손 모델을 숨기고 핀치 판정도 건너뛴다.
// hand-grabber, gain-wrist-gauge도 hasPoses를 보므로 함께 멈춘다.
AFRAME.registerComponent("hand-collapse-guard", {
  dependencies: ["hand-tracking-controls"],

  schema: {
    minHandSize: { default: 0.05 }, // m
  },

  init: function () {
    var self = this;
    var WRIST_INDEX = 0;
    var INDEX_TIP_INDEX = 9;
    var jointMatrix = new THREE.Matrix4();
    var wrist = new THREE.Vector3();
    var indexTip = new THREE.Vector3();

    var handControls = this.el.components["hand-tracking-controls"];
    var originalUpdateHandModel = handControls.updateHandModel;
    // tick 안에서 관절을 읽은 직후, 손 모델·핀치 판정보다 먼저 불린다.
    handControls.updateHandModel = function () {
      if (this.hasPoses) {
        wrist.setFromMatrixPosition(jointMatrix.fromArray(this.jointPoses, WRIST_INDEX * 16));
        indexTip.setFromMatrixPosition(jointMatrix.fromArray(this.jointPoses, INDEX_TIP_INDEX * 16));
        if (wrist.distanceTo(indexTip) < self.data.minHandSize) this.hasPoses = false;
      }
      return originalUpdateHandModel.apply(this, arguments);
    };
  },
});
