AFRAME.registerComponent("hand-grabber", {
  // 멀리 잡은 오브젝트의 Pull/Push 배율 설정
  // 배율 = 속도 계수 × 거리 계수
  //   속도 계수: 손이 느리면 minSpeedGain, 빠르면 maxSpeedGain까지 부드럽게 증가 (PRISM)
  //   거리 계수: 어깨~물체가 가까우면 1배, 멀면 maxDistanceGain까지 부드럽게 증가 (Go-Go)
  // 실행 중에 바꾸려면 DevTools에서
  //   document.querySelectorAll("[hand-grabber]").forEach(e => e.setAttribute("hand-grabber", "maxSpeedGain", 4))
  schema: {
    gainMode: { default: "adaptive", oneOf: ["adaptive", "fixed"] }, // fixed: 비교 측정용 고정 배율
    fixedGain: { default: 4 }, // gainMode가 fixed일 때 쓰는 배율

    minSpeedGain: { default: 1 }, // 손이 slowSpeed 이하로 느릴 때의 속도 계수
    maxSpeedGain: { default: 3 }, // 손이 fastSpeed 이상으로 빠를 때의 속도 계수
    slowSpeed: { default: 0.05 }, // m/s, 이보다 느리면 정밀 조작으로 본다.
    fastSpeed: { default: 0.5 }, // m/s, 이보다 빠르면 최대로 가속한다.
    speedSmoothing: { default: 0.1 }, // s, 손 속도 저역통과 필터의 시간 상수 (클수록 부드럽지만 늦게 반응)

    maxDistanceGain: { default: 2 }, // 어깨~물체가 farDistance 이상일 때의 거리 계수
    nearDistance: { default: 1 }, // m, 이보다 가까우면 거리 계수 1배
    farDistance: { default: 6 }, // m, 이보다 멀면 거리 계수 최대

    debug: { default: false }, // true면 손 속도와 배율을 콘솔에 찍는다.
  },

  init: function () {
    var component = this;
    var el = this.el;
    var sceneEl = el.sceneEl;

    // 거리 제한은 세 입력 방식이 함께 쓰므로 grab-settings 시스템에서 가져온다.
    // (씬 속성을 바꾸면 data 객체가 새로 만들어지므로 매번 system.data에서 읽는다)
    var settings = sceneEl.systems["grab-settings"];

    // 잡기 설정 (단위: m)
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
    var smoothedSpeed = 0; // 레이 방향 손 속도 (m/s), 떨림을 걸러낸 값
    var debugLogTime = 0;

    // 현재 배율 상태. DevTools에서 document.querySelector("[hand-grabber]").components["hand-grabber"].gainState로 볼 수 있다.
    var gainState = { speed: 0, shoulderDistance: 0, speedGain: 1, distanceGain: 1, gain: 1 };
    this.gainState = gainState;

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
        smoothedSpeed = 0; // 잡는 순간은 정밀 조작부터 시작한다.
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

    // 레이 방향 손 속도를 저역통과 필터(지수이동평균)로 걸러서 갱신한다.
    // 핸드트래킹 떨림이 그대로 들어가면 배율이 프레임마다 튀기 때문
    function updateHandSpeed(handDelta, timeDelta) {
      if (!(timeDelta > 0)) return;
      var seconds = timeDelta / 1000;
      var speed = Math.abs(handDelta) / seconds;
      // 프레임 간격이 달라도 같은 정도로 걸러지도록 시간 상수로 가중치를 구한다.
      var alpha = 1 - Math.exp(-seconds / Math.max(component.data.speedSmoothing, 1e-4));
      smoothedSpeed += (speed - smoothedSpeed) * alpha;
    }

    // 배율 = 속도 계수 × 거리 계수. 계단 없이 smoothstep으로 이어서 물체가 튀지 않게 한다.
    function computeGain() {
      var data = component.data;
      // 레이는 어깨에서 rayOrigin을 지나므로 두 거리를 더하면 어깨~물체 거리가 된다.
      var shoulderDistance = shoulderPosition.distanceTo(rayOrigin) + grabDistance;
      var speedT = THREE.MathUtils.smoothstep(smoothedSpeed, data.slowSpeed, data.fastSpeed);
      var distanceT = THREE.MathUtils.smoothstep(shoulderDistance, data.nearDistance, data.farDistance);

      gainState.speed = smoothedSpeed;
      gainState.shoulderDistance = shoulderDistance;
      gainState.speedGain = THREE.MathUtils.lerp(data.minSpeedGain, data.maxSpeedGain, speedT);
      gainState.distanceGain = THREE.MathUtils.lerp(1, data.maxDistanceGain, distanceT);
      gainState.gain =
        data.gainMode === "fixed"
          ? data.fixedGain
          : gainState.speedGain * gainState.distanceGain;
      return gainState.gain;
    }

    function logGain(timeDelta) {
      if (!component.data.debug) return;
      debugLogTime += timeDelta;
      if (debugLogTime < 200) return; // 콘솔이 넘치지 않게 0.2초마다
      debugLogTime = 0;
      console.log(
        "hand gain",
        getHandControls().data.hand,
        "speed", gainState.speed.toFixed(3),
        "dist", gainState.shoulderDistance.toFixed(2),
        "speedGain", gainState.speedGain.toFixed(2),
        "distGain", gainState.distanceGain.toFixed(2),
        "gain", gainState.gain.toFixed(2),
      );
    }

    // 멀리 잡은 오브젝트를 레이 위에 유지하고, 손을 앞뒤로 움직인 만큼 증폭해 Pull/Push 한다.
    function updateFarGrab(timeDelta) {
      updatePinchPosition();
      pinchDelta.copy(pinchPosition).sub(lastPinchPosition);
      lastPinchPosition.copy(pinchPosition);

      var handDelta = pinchDelta.dot(localRayDirection);
      updateHandSpeed(handDelta, timeDelta);
      var gain = computeGain();
      logGain(timeDelta);

      // 레이 시작점도 손과 함께 움직이므로, 나머지 (gain - 1)배만 더하면 총 gain배가 된다.
      grabDistance = THREE.MathUtils.clamp(
        grabDistance + handDelta * (gain - 1),
        settings.data.minDistance,
        settings.data.maxDistance,
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
      if (heldEl && !isNearGrab) updateFarGrab(timeDelta);
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
