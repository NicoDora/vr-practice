// 카메라, 컨트롤러, 손을 담은 rig 전체를 WASD/방향키로 이동시킨다.
// wasd-controls를 rig에 붙이면 rig 자신의 회전(항상 정면)을 기준으로 움직여서
// 카메라가 바라보는 방향으로 가지 않으므로, 카메라의 좌우 회전(yaw)을 기준으로 직접 이동한다.
AFRAME.registerComponent("rig-movement", {
  schema: {
    speed: { default: 2 }, // 초당 이동 거리 (m)
  },

  init: function () {
    var pressedKeys = {};

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.pressedKeys = pressedKeys;

    // 한글 입력 상태에서도 동작하도록 event.code를 사용
    this.onKeyDown = function (event) {
      pressedKeys[event.code] = true;
    };
    this.onKeyUp = function (event) {
      pressedKeys[event.code] = false;
    };
    this.onBlur = function () {
      for (var code in pressedKeys) pressedKeys[code] = false;
    };

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  },

  isPressed: function (codeA, codeB) {
    return !!(this.pressedKeys[codeA] || this.pressedKeys[codeB]);
  },

  tick: function (time, timeDelta) {
    var camera = this.el.sceneEl.camera;
    if (!camera || !timeDelta) return;

    var forwardInput =
      (this.isPressed("KeyW", "ArrowUp") ? 1 : 0) -
      (this.isPressed("KeyS", "ArrowDown") ? 1 : 0);
    var rightInput =
      (this.isPressed("KeyD", "ArrowRight") ? 1 : 0) -
      (this.isPressed("KeyA", "ArrowLeft") ? 1 : 0);
    if (!forwardInput && !rightInput) return;

    // 카메라가 보는 방향을 바닥(XZ) 평면에 투영한다.
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) return;
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);

    this.move
      .copy(this.forward)
      .multiplyScalar(forwardInput)
      .addScaledVector(this.right, rightInput);
    if (this.move.lengthSq() > 1) this.move.normalize(); // 대각선이 더 빠르지 않도록
    this.move.multiplyScalar(this.data.speed * (timeDelta / 1000));

    // rig는 scene 바로 아래에 있다고 가정하고 월드 이동량을 그대로 더한다.
    this.el.object3D.position.add(this.move);
  },

  remove: function () {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  },
});
