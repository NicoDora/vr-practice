AFRAME.registerComponent("hand-grabber", {
  init: function () {
    var el = this.el;
    var sceneEl = el.sceneEl;

    // Pull/Push 설정 (mouse-grabbable.js, vr-grabber.js와 같은 값, 단위: m)
    var minDistance = 0.5;
    var maxDistance = 10;
    var pushGain = 4; // 멀리 잡은 상태에서 손을 앞뒤로 움직인 거리의 몇 배만큼 오브젝트가 움직일지
    var nearGrabMargin = 0.02; // 가까이 잡기 판정 시 바운딩 박스에 더할 여유
    var shoulderOffsetSide = 0.15; // 머리 기준 추정 어깨 위치 (손 쪽 옆으로)
    var shoulderOffsetDown = 0.15; // 머리 기준 추정 어깨 위치 (아래로)
    var lostTrackingTimeout = 300; // 손 추적을 이 시간(ms) 이상 잃으면 놓는다.

    // WebXR 손 관절 번호 (hand-tracking-controls의 jointPoses 순서)
    var WRIST_INDEX = 0;
    var THUMB_TIP_INDEX = 4;
    var INDEX_PROXIMAL_INDEX = 6;
    var INDEX_TIP_INDEX = 9;

    var heldEl = null;
    var isNearGrab = false;
    var originalParent = null;
    var grabDistance = 0;
    var rayActive = true;
    var lostTrackingTime = 0;

    var jointMatrix = new THREE.Matrix4();
    var handMatrixInverse = new THREE.Matrix4();
    var thumbTipPosition = new THREE.Vector3();
    var pinchPosition = new THREE.Vector3(); // 손 엔티티(rig) 기준 좌표
    var lastPinchPosition = new THREE.Vector3();
    var nearPinchPosition = new THREE.Vector3();
    var headPosition = new THREE.Vector3();
    var headForward = new THREE.Vector3();
    var shoulderPosition = new THREE.Vector3();
    var rayOrigin = new THREE.Vector3(); // 월드 좌표
    var rayDirection = new THREE.Vector3(); // 월드 좌표
    var localRayOrigin = new THREE.Vector3();
    var localRayDirection = new THREE.Vector3();
    var grabOffset = new THREE.Vector3();
    var targetWorldPosition = new THREE.Vector3();
    var pinchDelta = new THREE.Vector3();
    var targetBox = new THREE.Box3();
    // 가까이 잡은 오브젝트를 붙여 둘 손목 위치. hand-tracking-controls의 wristObject3D는
    // rig 이동을 반영하지 않아서, rig까지 반영한 월드 위치로 직접 갱신한다.
    var grabAnchor = new THREE.Object3D();
    sceneEl.object3D.add(grabAnchor);
    this.grabAnchor = grabAnchor;

    var raycasterData = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    };

    function getHandControls() {
      return el.components["hand-tracking-controls"];
    }

    // 손이 실제로 추적되고 있는지 (컨트롤러를 쥐고 있거나 손이 안 보이면 false)
    function isTracking() {
      var handControls = getHandControls();
      var trackedControls = el.components["tracked-controls"];
      return !!(
        handControls &&
        handControls.hasPoses &&
        trackedControls &&
        trackedControls.controller
      );
    }

    // 관절 좌표는 손 엔티티 기준(= rig 기준)이다. rig가 움직였을 수 있으니 월드 행렬을 최신으로 맞춘다.
    function updateHandMatrix() {
      el.object3D.updateWorldMatrix(true, false);
    }

    function getJointLocalPosition(index, out) {
      jointMatrix.fromArray(getHandControls().jointPoses, index * 16);
      return out.setFromMatrixPosition(jointMatrix);
    }

    function getJointWorldPosition(index, out) {
      return getJointLocalPosition(index, out).applyMatrix4(el.object3D.matrixWorld);
    }

    // Pull/Push 계산은 rig 이동에 영향받지 않도록 손 엔티티 기준 좌표로 한다.
    function updatePinchPosition() {
      getJointLocalPosition(THUMB_TIP_INDEX, thumbTipPosition);
      getJointLocalPosition(INDEX_TIP_INDEX, pinchPosition);
      pinchPosition.add(thumbTipPosition).multiplyScalar(0.5);
    }

    function updateGrabAnchor() {
      jointMatrix.fromArray(getHandControls().jointPoses, WRIST_INDEX * 16);
      jointMatrix.premultiply(el.object3D.matrixWorld);
      jointMatrix.decompose(
        grabAnchor.position,
        grabAnchor.quaternion,
        grabAnchor.scale,
      );
      grabAnchor.updateMatrixWorld(true);
    }

    // 레이는 "추정 어깨 → 검지 첫 마디" 방향으로 쏜다.
    // 손목 각도와 상관없이 팔 방향을 따라가서 Quest 시스템 UI처럼 흔들림이 적다.
    function updateRay() {
      var camera = sceneEl.camera;
      camera.getWorldPosition(headPosition);
      camera.getWorldDirection(headForward);
      headForward.y = 0;
      headForward.normalize();

      // 머리의 좌우 회전만 반영한 오른쪽 방향으로 어깨를 옮긴다.
      var side = getHandControls().data.hand === "left" ? -1 : 1;
      shoulderPosition.set(
        headPosition.x - headForward.z * shoulderOffsetSide * side,
        headPosition.y - shoulderOffsetDown,
        headPosition.z + headForward.x * shoulderOffsetSide * side,
      );

      getJointWorldPosition(INDEX_PROXIMAL_INDEX, rayOrigin);
      rayDirection.copy(rayOrigin).sub(shoulderPosition).normalize();

      // raycaster의 origin/direction은 엔티티 기준 값이라 다시 로컬로 바꿔서 넣는다.
      handMatrixInverse.copy(el.object3D.matrixWorld).invert();
      localRayOrigin.copy(rayOrigin).applyMatrix4(handMatrixInverse);
      localRayDirection.copy(rayDirection).transformDirection(handMatrixInverse);

      raycasterData.origin.x = localRayOrigin.x;
      raycasterData.origin.y = localRayOrigin.y;
      raycasterData.origin.z = localRayOrigin.z;
      raycasterData.direction.x = localRayDirection.x;
      raycasterData.direction.y = localRayDirection.y;
      raycasterData.direction.z = localRayDirection.z;
      el.setAttribute("raycaster", raycasterData);
    }

    // 손을 잃으면 레이를 숨기고 호버를 해제한다. (raycaster를 끄면 cursor가 mouseleave를 보낸다)
    function setRayActive(active) {
      if (rayActive === active) return;
      rayActive = active;
      el.setAttribute("raycaster", { enabled: active, showLine: active });
    }

    function release() {
      if (!heldEl) return;

      if (isNearGrab) originalParent.attach(heldEl.object3D);
      console.log("hand release", heldEl.id);
      heldEl.removeState("grabbed");
      heldEl = null;
      isNearGrab = false;
      originalParent = null;
    }

    // 1) 손이 직접 닿은 오브젝트 → 손목에 붙여서 위치와 회전을 따라가게 한다.
    function tryNearGrab(localPosition) {
      var position = nearPinchPosition
        .copy(localPosition)
        .applyMatrix4(el.object3D.matrixWorld);
      var targets = sceneEl.querySelectorAll(".grabbable");
      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        if (target.is("grabbed")) continue;

        targetBox.setFromObject(target.object3D).expandByScalar(nearGrabMargin);
        if (!targetBox.containsPoint(position)) continue;

        heldEl = target;
        isNearGrab = true;
        originalParent = target.object3D.parent;
        updateGrabAnchor();
        grabAnchor.attach(target.object3D);
        return true;
      }
      return false;
    }

    // 2) 레이로 가리킨 오브젝트 → 손에 붙이지 않고 레이를 따라 움직이게 한다.
    // 손에 붙이면 손목을 조금만 돌려도 멀리 있는 오브젝트가 크게 휘둘리기 때문
    function tryFarGrab() {
      var raycaster = el.components.raycaster;
      if (!raycaster || !rayActive) return false;

      var intersections = raycaster.intersections;
      for (var i = 0; i < intersections.length; i++) {
        var target = intersections[i].object.el;
        if (!target.classList.contains("grabbable") || target.is("grabbed"))
          continue;

        heldEl = target;
        isNearGrab = false;
        grabDistance = intersections[i].distance;
        target.object3D.getWorldPosition(grabOffset);
        grabOffset.sub(intersections[i].point);
        updatePinchPosition();
        lastPinchPosition.copy(pinchPosition);
        return true;
      }
      return false;
    }

    this.onPinchStarted = function (event) {
      if (heldEl || !isTracking()) return;

      updateHandMatrix();
      if (tryNearGrab(event.detail.position) || tryFarGrab()) {
        console.log("hand grab", heldEl.id, isNearGrab ? "(near)" : "(far)");
        heldEl.addState("grabbed");
      }
    };

    this.onPinchEnded = function () {
      release();
    };

    // 손 입력이 끊기거나 VR에서 나가면 들고 있던 오브젝트를 놓는다.
    this.onForceRelease = function () {
      release();
      setRayActive(false);
    };

    // 멀리 잡은 오브젝트를 레이 위에 유지하고, 손을 앞뒤로 움직인 만큼 증폭해 Pull/Push 한다.
    function updateFarGrab() {
      updatePinchPosition();
      pinchDelta.copy(pinchPosition).sub(lastPinchPosition);
      lastPinchPosition.copy(pinchPosition);

      // 레이 시작점도 손과 함께 움직이므로, 나머지 (pushGain - 1)배만 더하면 총 pushGain배가 된다.
      var handDelta = pinchDelta.dot(localRayDirection);
      grabDistance = THREE.MathUtils.clamp(
        grabDistance + handDelta * (pushGain - 1),
        minDistance,
        maxDistance,
      );

      targetWorldPosition
        .copy(rayOrigin)
        .addScaledVector(rayDirection, grabDistance)
        .add(grabOffset);

      // 부모 요소가 있는 경우에도 올바른 로컬 좌표가 되도록 변환
      var parent = heldEl.object3D.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        parent.worldToLocal(targetWorldPosition);
      }
      heldEl.object3D.position.copy(targetWorldPosition);
    }

    this.updateHand = function (timeDelta) {
      if (!isTracking() || !sceneEl.camera) {
        setRayActive(false);
        lostTrackingTime += timeDelta;
        // 손을 잃으면 pinchended가 오지 않을 수 있어 일정 시간 뒤 직접 놓는다.
        if (heldEl && lostTrackingTime > lostTrackingTimeout) release();
        return;
      }

      lostTrackingTime = 0;
      setRayActive(true);
      updateHandMatrix();
      updateRay();
      if (heldEl && isNearGrab) updateGrabAnchor();
      if (heldEl && !isNearGrab) updateFarGrab();
    };

    this.release = release;

    el.addEventListener("pinchstarted", this.onPinchStarted);
    el.addEventListener("pinchended", this.onPinchEnded);
    el.addEventListener("controllerdisconnected", this.onForceRelease);
    sceneEl.addEventListener("exit-vr", this.onForceRelease);
  },

  tick: function (time, timeDelta) {
    this.updateHand(timeDelta);
  },

  remove: function () {
    this.release();
    this.grabAnchor.removeFromParent();
    this.el.removeEventListener("pinchstarted", this.onPinchStarted);
    this.el.removeEventListener("pinchended", this.onPinchEnded);
    this.el.removeEventListener("controllerdisconnected", this.onForceRelease);
    this.el.sceneEl.removeEventListener("exit-vr", this.onForceRelease);
  },
});
