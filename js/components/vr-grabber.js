AFRAME.registerComponent("vr-grabber", {
  init: function () {
    var el = this.el;
    var sceneEl = el.sceneEl;

    // Pull/Push 설정 (mouse-grabbable.js와 같은 값, 단위: m)
    var minDistance = 0.5;
    var maxDistance = 10;
    var stickSpeed = 2; // 썸스틱을 끝까지 밀었을 때 초당 이동 거리
    var stickDeadzone = 0.2; // 썸스틱이 살짝 기울어진 정도는 무시

    var heldEl = null;
    var originalParent = null;
    var stickY = 0;

    var rayOrigin = new THREE.Vector3();
    var rayDirection = new THREE.Vector3();
    var offsetFromOrigin = new THREE.Vector3();

    function release() {
      if (!heldEl) return;

      // 월드 위치와 회전을 유지한 채 원래 부모로 돌려놓는다.
      originalParent.attach(heldEl.object3D);
      console.log("vr release", heldEl.id);
      heldEl.removeState("grabbed");
      heldEl = null;
      originalParent = null;
    }

    this.onGripDown = function () {
      if (heldEl) return;

      var raycaster = el.components.raycaster;
      if (!raycaster) return;

      // 레이저에 맞은 오브젝트 중 가장 가까운, 아직 아무도 잡지 않은 것을 잡는다.
      var targets = raycaster.intersectedEls;
      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        if (!target.classList.contains("grabbable") || target.is("grabbed"))
          continue;

        heldEl = target;
        originalParent = target.object3D.parent;

        // 손의 자식으로 옮기면 이후에는 컨트롤러의 위치와 회전을 자동으로 따라간다.
        // attach는 월드 위치를 유지하므로 잡는 순간 오브젝트가 튀지 않는다.
        el.object3D.attach(target.object3D);
        console.log("vr grab", target.id);
        target.addState("grabbed");
        return;
      }
    };

    this.onGripUp = function () {
      release();
    };

    this.onThumbstickMoved = function (event) {
      stickY = event.detail.y;
    };

    // laser-controls는 연결이 끊겨도 레이 선만 숨기고 판정은 계속한다.
    // 그래서 멈춘 위치의 레이가 오브젝트를 계속 가리키지 않도록 raycaster를 직접 켜고 끈다.
    // (raycaster를 끄면 cursor가 mouseleave를 보내 호버도 풀린다)
    function setRayEnabled(enabled) {
      el.setAttribute("raycaster", "enabled", enabled);
    }

    this.onControllerConnected = function () {
      setRayEnabled(true);
    };

    // 컨트롤러 연결이 끊기거나 VR에서 나가면 들고 있던 오브젝트를 놓는다.
    this.onForceRelease = function () {
      stickY = 0;
      release();
      setRayEnabled(false);
    };

    // 썸스틱 위아래로 레이저 방향을 따라 오브젝트를 밀거나 당긴다.
    this.updateStickPullPush = function (timeDelta) {
      if (!heldEl || Math.abs(stickY) < stickDeadzone) return;

      var raycaster = el.components.raycaster;
      if (!raycaster) return;

      // 오브젝트가 손의 자식이므로 모든 계산을 손의 로컬 좌표계에서 한다.
      // raycaster의 origin/direction도 손 로컬 기준 값(laser-controls가 기기별로 설정)
      rayOrigin.copy(raycaster.data.origin);
      rayDirection.copy(raycaster.data.direction).normalize();

      var position = heldEl.object3D.position;
      offsetFromOrigin.copy(position).sub(rayOrigin);
      var currentDistance = offsetFromOrigin.dot(rayDirection);

      // 썸스틱을 앞으로 밀면 y가 음수 → 멀어짐(Push)
      var nextDistance = THREE.MathUtils.clamp(
        currentDistance - stickY * stickSpeed * (timeDelta / 1000),
        minDistance,
        maxDistance,
      );
      position.addScaledVector(rayDirection, nextDistance - currentDistance);
    };

    this.release = release;

    el.addEventListener("gripdown", this.onGripDown);
    el.addEventListener("gripup", this.onGripUp);
    el.addEventListener("thumbstickmoved", this.onThumbstickMoved);
    el.addEventListener("controllerconnected", this.onControllerConnected);
    el.addEventListener("controllerdisconnected", this.onForceRelease);
    sceneEl.addEventListener("exit-vr", this.onForceRelease);
  },

  tick: function (time, timeDelta) {
    this.updateStickPullPush(timeDelta);
  },

  remove: function () {
    this.release();
    this.el.removeEventListener("gripdown", this.onGripDown);
    this.el.removeEventListener("gripup", this.onGripUp);
    this.el.removeEventListener("thumbstickmoved", this.onThumbstickMoved);
    this.el.removeEventListener(
      "controllerconnected",
      this.onControllerConnected,
    );
    this.el.removeEventListener(
      "controllerdisconnected",
      this.onForceRelease,
    );
    this.el.sceneEl.removeEventListener("exit-vr", this.onForceRelease);
  },
});
